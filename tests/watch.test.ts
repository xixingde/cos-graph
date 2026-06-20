/** Tests for src/watch.ts. Ported from graphify/watch.py. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  queuePending,
  drainPending,
  mergeChangedPaths,
  checkShrink,
  nodeCommunityMap,
  canonicalGraphForCompare,
  canonicalTopologyForCompare,
  checkUpdate,
  reportRootLabel,
  isRelativeTo,
  changedPathCandidates,
  relativizeSourceFiles,
  reportForCompare,
} from "../src/watch.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-watch-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── queuePending / drainPending ─────────────────────────────────────────

describe("queuePending / drainPending", () => {
  it("queues and drains paths", () => {
    queuePending(tmpDir, ["/a.ts", "/b.ts"]);
    const drained = drainPending(tmpDir);
    expect(drained).toEqual(["/a.ts", "/b.ts"]);
  });

  it("drains empty when no pending file", () => {
    expect(drainPending(tmpDir)).toEqual([]);
  });

  it("deduplicates paths on drain", () => {
    queuePending(tmpDir, ["/a.ts"]);
    queuePending(tmpDir, ["/a.ts", "/b.ts"]);
    const drained = drainPending(tmpDir);
    expect(drained).toEqual(["/a.ts", "/b.ts"]);
  });

  it("file is deleted after drain", () => {
    queuePending(tmpDir, ["/a.ts"]);
    drainPending(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, ".pending_changes"))).toBe(false);
  });

  it("skips empty/whitespace lines", () => {
    fs.writeFileSync(path.join(tmpDir, ".pending_changes"), "  \n/a.ts\n\n/b.ts\n  ", "utf-8");
    const drained = drainPending(tmpDir);
    expect(drained).toEqual(["/a.ts", "/b.ts"]);
  });
});

// ── mergeChangedPaths ────────────────────────────────────────────────────

describe("mergeChangedPaths", () => {
  it("merges and deduplicates", () => {
    expect(mergeChangedPaths(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("handles undefined sources", () => {
    expect(mergeChangedPaths(["a"], undefined, ["b"])).toEqual(["a", "b"]);
  });

  it("returns empty for no sources", () => {
    expect(mergeChangedPaths()).toEqual([]);
  });
});

// ── checkShrink ─────────────────────────────────────────────────────────

describe("checkShrink", () => {
  it("allows when force is true", () => {
    expect(checkShrink(true, { nodes: Array(100) }, { nodes: Array(50) })).toBe(true);
  });

  it("allows when no existing data", () => {
    expect(checkShrink(false, null, { nodes: Array(50) })).toBe(true);
  });

  it("allows when had explicit deletions", () => {
    expect(checkShrink(false, { nodes: Array(100) }, { nodes: Array(50) }, undefined, {
      hadExplicitDeletions: true,
    })).toBe(true);
  });

  it("allows when new graph is same size or larger", () => {
    expect(checkShrink(false, { nodes: Array(100) }, { nodes: Array(100) })).toBe(true);
    expect(checkShrink(false, { nodes: Array(100) }, { nodes: Array(200) })).toBe(true);
  });

  it("refuses when new graph is smaller", () => {
    expect(checkShrink(false, { nodes: Array(100) }, { nodes: Array(50) })).toBe(false);
  });

  it("deletes tmp file on refuse", () => {
    const tmpFile = path.join(tmpDir, "tmp.json");
    fs.writeFileSync(tmpFile, "test", "utf-8");
    checkShrink(false, { nodes: Array(100) }, { nodes: Array(50) }, tmpFile);
    expect(fs.existsSync(tmpFile)).toBe(false);
  });
});

// ── nodeCommunityMap ────────────────────────────────────────────────────

describe("nodeCommunityMap", () => {
  it("maps node IDs to community IDs", () => {
    const data = {
      nodes: [
        { id: "n1", community: 0 },
        { id: "n2", community: 1 },
        { id: "n3" },
      ],
    };
    const map = nodeCommunityMap(data);
    expect(map).toEqual({ n1: 0, n2: 1 });
  });

  it("skips invalid community values", () => {
    const data = {
      nodes: [
        { id: "n1", community: "abc" },
        { id: "n2", community: null },
      ],
    };
    const map = nodeCommunityMap(data);
    expect(map.n1).toBeNaN();
    expect("n2" in map).toBe(false);
  });
});

// ── canonicalGraphForCompare ────────────────────────────────────────────

describe("canonicalGraphForCompare", () => {
  it("removes built_at_commit and sorts node/edge lists", () => {
    const data = {
      built_at_commit: "abc123",
      nodes: [{ id: "b" }, { id: "a" }],
      edges: [{ source: "y" }, { source: "x" }],
    };
    const canonical = canonicalGraphForCompare(data);
    expect((canonical as any).built_at_commit).toBeUndefined();
    expect(canonical.nodes[0].id).toBe("a");
    expect(canonical.edges[0].source).toBe("x");
  });
});

// ── canonicalTopologyForCompare ─────────────────────────────────────────

describe("canonicalTopologyForCompare", () => {
  it("removes community and norm_label from nodes", () => {
    const data = {
      built_at_commit: "abc",
      nodes: [{ id: "n1", community: 0, norm_label: "foo", label: "bar" }],
      edges: [],
    };
    const canonical = canonicalTopologyForCompare(data);
    expect((canonical as any).built_at_commit).toBeUndefined();
    const node = canonical.nodes[0] as Record<string, unknown>;
    expect(node.community).toBeUndefined();
    expect(node.norm_label).toBeUndefined();
    expect(node.label).toBe("bar");
  });

  it("normalizes _src/_tgt in edges", () => {
    const data = {
      nodes: [],
      edges: [{ _src: "a", _tgt: "b", source: "old_s", target: "old_t" }],
    };
    const canonical = canonicalTopologyForCompare(data);
    const edge = canonical.edges[0] as Record<string, unknown>;
    expect(edge.source).toBe("a");
    expect(edge.target).toBe("b");
    expect(edge._src).toBeUndefined();
    expect(edge._tgt).toBeUndefined();
  });
});

// ── reportRootLabel ─────────────────────────────────────────────────────

describe("reportRootLabel", () => {
  it("returns basename for absolute paths", () => {
    expect(reportRootLabel("/home/user/myproject")).toBe("myproject");
  });

  it("returns CWD basename for '.'", () => {
    expect(reportRootLabel(".")).toBe(path.basename(process.cwd()));
  });

  it("returns the path itself for relative paths", () => {
    expect(reportRootLabel("src")).toBe("src");
  });
});

// ── isRelativeTo ────────────────────────────────────────────────────────

describe("isRelativeTo", () => {
  it("returns true for subpaths", () => {
    expect(isRelativeTo("/home/user/project/src/app.ts", "/home/user/project")).toBe(true);
  });

  it("returns false for unrelated paths", () => {
    expect(isRelativeTo("/other/path/file.ts", "/home/user/project")).toBe(false);
  });
});

// ── changedPathCandidates ───────────────────────────────────────────────

describe("changedPathCandidates", () => {
  it("returns resolved absolute path for absolute input", () => {
    const result = changedPathCandidates("/abs/file.ts", "/change", "/watch");
    expect(result).toEqual([path.resolve("/abs/file.ts")]);
  });

  it("returns candidates relative to both roots for relative input", () => {
    const result = changedPathCandidates("src/file.ts", "/project", "/watch");
    expect(result.length).toBe(2);
    expect(result[0]).toBe(path.resolve("/project", "src/file.ts"));
    expect(result[1]).toBe(path.resolve("/watch", "src/file.ts"));
  });

  it("deduplicates when roots are the same", () => {
    const result = changedPathCandidates("file.ts", "/project", "/project");
    expect(result.length).toBe(1);
  });
});

// ── relativizeSourceFiles ───────────────────────────────────────────────

describe("relativizeSourceFiles", () => {
  it("converts absolute source_file to relative", () => {
    const root = "/home/user/project";
    const payload = {
      nodes: [{ id: "n1", source_file: "/home/user/project/src/app.ts" }],
      edges: [],
      hyperedges: [],
    };
    relativizeSourceFiles(payload, root);
    expect(payload.nodes[0].source_file).toBe("src/app.ts");
  });

  it("skips relative source_file", () => {
    const payload = {
      nodes: [{ id: "n1", source_file: "src/app.ts" }],
      edges: [],
      hyperedges: [],
    };
    relativizeSourceFiles(payload, "/home/user/project");
    expect(payload.nodes[0].source_file).toBe("src/app.ts");
  });
});

// ── reportForCompare ────────────────────────────────────────────────────

describe("reportForCompare", () => {
  it("removes commit hash lines", () => {
    const report = "- Built from commit: `abc123`\n\n## Summary\n\nSome text.";
    const result = reportForCompare(report);
    expect(result).not.toContain("Built from commit");
    expect(result).toContain("## Summary");
  });
});

// ── checkUpdate ─────────────────────────────────────────────────────────

describe("checkUpdate", () => {
  it("returns true always (cron-safe)", () => {
    expect(checkUpdate(tmpDir)).toBe(true);
  });
});
