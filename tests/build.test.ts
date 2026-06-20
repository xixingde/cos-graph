import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

import {
  buildFromJson,
  build,
  buildMerge,
  edgeData,
  edgeDatas,
  dedupeEdges,
  dedupeNodes,
  normalizeId,
  normSourceFile,
  deduplicateByLabel,
  prefixGraphForGlobal,
  pruneRepoFromGraph,
} from "../src/build.js";

const FIXTURES = path.resolve(__dirname, "fixtures");

function loadExtraction(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES, "extraction.json"), "utf-8")
  );
}

// ---------------------------------------------------------------------------
// dedupeEdges
// ---------------------------------------------------------------------------

describe("dedupeEdges", () => {
  it("collapses exact parallel edges by (source, target, relation)", () => {
    const edges = [
      { source: "a", target: "b", relation: "calls", source_location: "L1" },
      { source: "a", target: "b", relation: "calls", source_location: "L9" },
      { source: "a", target: "b", relation: "imports" },
      { source: "b", target: "c", relation: "calls" },
    ];
    const out = dedupeEdges(edges);
    const keys = out.map((e) => `${e.source}\0${e.target}\0${e.relation}`);
    expect(keys).toEqual([
      "a\0b\0calls",
      "a\0b\0imports",
      "b\0c\0calls",
    ]);
    // first occurrence wins (keeps L1, not L9)
    expect(out[0].source_location).toBe("L1");
  });

  it("is idempotent", () => {
    const edges = [
      { source: "a", target: "b", relation: "calls" },
      { source: "a", target: "b", relation: "calls" },
    ];
    const once = dedupeEdges(edges);
    const twice = dedupeEdges([...once, ...edges]);
    expect(once.length).toBe(1);
    expect(twice.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// dedupeNodes
// ---------------------------------------------------------------------------

describe("dedupeNodes", () => {
  it("collapses by id, last-writer-wins on attributes", () => {
    const nodes = [
      { id: "foundation", label: "Foundation", type: "module", source_file: "A.swift" },
      { id: "akit", label: "AKit", file_type: "code" },
      { id: "foundation", label: "Foundation", type: "module", source_file: "B.swift" },
    ];
    const out = dedupeNodes(nodes);
    const ids = out.map((n) => n.id as string);
    expect(ids).toEqual(["foundation", "akit"]);
    // last writer wins on attributes
    const foundNode = out.find((n) => n.id === "foundation");
    expect(foundNode!.source_file).toBe("B.swift");
  });
});

// ---------------------------------------------------------------------------
// buildFromJson
// ---------------------------------------------------------------------------

describe("buildFromJson", () => {
  it("has correct node count from extraction fixture", () => {
    const G = buildFromJson(loadExtraction());
    expect(G.order).toBe(4);
  });

  it("has correct edge count from extraction fixture", () => {
    const G = buildFromJson(loadExtraction());
    expect(G.size).toBe(4);
  });

  it("nodes have label", () => {
    const G = buildFromJson(loadExtraction());
    const attrs = G.getNodeAttributes("n_transformer");
    expect(attrs["label"]).toBe("Transformer");
  });

  it("edges have confidence", () => {
    const G = buildFromJson(loadExtraction());
    const data = edgeData(G, "n_attention", "n_concept_attn");
    expect(data["confidence"]).toBe("INFERRED");
  });

  it("ambiguous edge is preserved", () => {
    const G = buildFromJson(loadExtraction());
    const data = edgeData(G, "n_layernorm", "n_concept_attn");
    expect(data["confidence"]).toBe("AMBIGUOUS");
  });

  it("canonicalizes legacy node 'source' to 'source_file'", () => {
    const ext = {
      nodes: [{ id: "n1", label: "A", file_type: "code", source: "a.py" }],
      edges: [],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    const attrs = G.getNodeAttributes("n1");
    expect("source_file" in attrs).toBe(true);
    expect(attrs["source_file"]).toBe("a.py");
    expect("source" in attrs).toBe(false);
  });

  it("accepts legacy edge 'from'/'to' keys", () => {
    const ext = {
      nodes: [
        { id: "n1", label: "A", file_type: "code", source_file: "a.py" },
        { id: "n2", label: "B", file_type: "code", source_file: "b.py" },
      ],
      edges: [
        {
          from: "n1",
          to: "n2",
          relation: "calls",
          confidence: "EXTRACTED",
          source_file: "a.py",
          weight: 1.0,
        },
      ],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    expect(G.size).toBe(1);
  });

  it("normalizes Windows backslash source_file paths", () => {
    const extraction = {
      nodes: [
        { id: "n1", label: "A", file_type: "code", source_file: "src\\middleware\\auth.py" },
        { id: "n2", label: "B", file_type: "code", source_file: "src/middleware/auth.py" },
      ],
      edges: [],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(extraction);
    const sources = new Set<string>();
    G.forEachNode((_nid: string, attrs: Record<string, unknown>) => {
      if (attrs["source_file"]) sources.add(attrs["source_file"] as string);
    });
    expect(sources).toEqual(new Set(["src/middleware/auth.py"]));
  });

  it("backfills missing source_file on edges from source node (#1279)", () => {
    const extraction = {
      nodes: [
        { id: "n1", label: "A", file_type: "concept", source_file: "docs/a.md" },
        { id: "n2", label: "B", file_type: "concept", source_file: "docs/b.md" },
      ],
      edges: [
        { source: "n1", target: "n2", relation: "relates_to", confidence: "INFERRED" },
      ],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(extraction);
    const sf = edgeData(G, "n1", "n2")["source_file"];
    expect(sf).toBe("docs/a.md");
  });

  it("defaults null/empty file_type to 'concept' (#660)", () => {
    const ext = {
      nodes: [
        { id: "n1", label: "Stub", file_type: null, source_file: "a.py" },
        { id: "n2", label: "Real", file_type: "code", source_file: "b.py" },
      ],
      edges: [],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    const attrs1 = G.getNodeAttributes("n1");
    expect(attrs1["file_type"]).toBe("concept");
    const attrs2 = G.getNodeAttributes("n2");
    expect(attrs2["file_type"]).toBe("code");
  });

  it("defaults missing file_type to 'concept'", () => {
    const ext = {
      nodes: [{ id: "n1", label: "Bare", source_file: "a.py" }],
      edges: [],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    const attrs = G.getNodeAttributes("n1");
    expect(attrs["file_type"]).toBe("concept");
  });

  it("coerces unknown file_type to 'concept' via synonym mapper (#840)", () => {
    const ext = {
      nodes: [
        { id: "n1", label: "Bad", file_type: "weird_type", source_file: "a.py" },
      ],
      edges: [],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    expect(G.getNodeAttributes("n1")["file_type"]).toBe("concept");
  });

  it("maps file_type synonyms correctly", () => {
    const ext = {
      nodes: [
        { id: "n1", label: "MD", file_type: "markdown", source_file: "a.md" },
        { id: "n2", label: "Tool", file_type: "tool", source_file: "b.py" },
        { id: "n3", label: "Pat", file_type: "pattern", source_file: "c.md" },
      ],
      edges: [],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    expect(G.getNodeAttributes("n1")["file_type"]).toBe("document");
    expect(G.getNodeAttributes("n2")["file_type"]).toBe("code");
    expect(G.getNodeAttributes("n3")["file_type"]).toBe("concept");
  });

  it("merges ghost nodes with unique AST canonical (#1145)", () => {
    const ext = {
      nodes: [
        {
          id: "ast_render", label: "render", file_type: "code",
          source_file: "src/app/index.ts", source_location: "L10", _origin: "ast",
        },
        {
          id: "ghost_render", label: "render", file_type: "code",
          source_file: "src/app/index.ts",
        },
        {
          id: "caller", label: "main", file_type: "code",
          source_file: "src/main.ts", source_location: "L1", _origin: "ast",
        },
      ],
      edges: [
        {
          source: "caller", target: "ghost_render", relation: "calls",
          confidence: "EXTRACTED", source_file: "src/main.ts", weight: 1.0,
        },
      ],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    expect(G.hasNode("ghost_render")).toBe(false);
    expect(G.hasEdge("caller", "ast_render")).toBe(true);
  });

  it("skips ghost merge on basename collision (#1257)", () => {
    const ext = {
      nodes: [
        {
          id: "a_render", label: "render", file_type: "code",
          source_file: "src/a/index.ts", source_location: "L10", _origin: "ast",
        },
        {
          id: "b_render", label: "render", file_type: "code",
          source_file: "src/b/index.ts", source_location: "L20", _origin: "ast",
        },
        {
          id: "ghost_render", label: "render", file_type: "code",
          source_file: "src/a/index.ts",
        },
        {
          id: "caller", label: "main", file_type: "code",
          source_file: "src/main.ts", source_location: "L1", _origin: "ast",
        },
      ],
      edges: [
        {
          source: "caller", target: "ghost_render", relation: "calls",
          confidence: "EXTRACTED", source_file: "src/main.ts", weight: 1.0,
        },
      ],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    expect(G.hasNode("ghost_render")).toBe(true);
    expect(G.order).toBe(4);
    expect(G.hasEdge("caller", "ghost_render")).toBe(true);
    expect(G.hasEdge("caller", "a_render")).toBe(false);
    expect(G.hasEdge("caller", "b_render")).toBe(false);
  });

  it("preserves first direction on bidirectional pair (#1061)", () => {
    const extraction = {
      nodes: [
        { id: "a_handler", label: "a", file_type: "code", source_file: "a.ts" },
        { id: "z_emitter", label: "z", file_type: "code", source_file: "z.ts" },
      ],
      edges: [
        {
          source: "a_handler", target: "z_emitter", relation: "calls",
          confidence: "EXTRACTED", source_file: "a.ts",
        },
        {
          source: "z_emitter", target: "a_handler", relation: "calls",
          confidence: "EXTRACTED", source_file: "z.ts",
        },
      ],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(extraction);
    expect(G.size).toBe(1);
    const data = edgeData(G, "a_handler", "z_emitter");
    expect(data["_src"]).toBe("a_handler");
    expect(data["_tgt"]).toBe("z_emitter");
  });

  it("relativizes absolute source_file when root is provided (#932)", () => {
    const root = path.resolve("/tmp/myproject");
    const absPath = root + "/docs/overview.md";
    const extraction = {
      nodes: [
        { id: "overview_intro", label: "Intro", source_file: absPath, file_type: "document" },
      ],
      edges: [
        {
          source: "overview_intro", target: "overview_intro",
          relation: "self", confidence: "EXTRACTED", confidence_score: 1.0,
          source_file: absPath,
        },
      ],
    };
    const G = buildFromJson(extraction, { root });
    const sf = G.getNodeAttributes("overview_intro")["source_file"] as string;
    expect(sf).toBe("docs/overview.md");
  });

  it("leaves relative source_file unchanged when root is provided", () => {
    const extraction = {
      nodes: [
        { id: "foo_bar", label: "bar", source_file: "src/foo.py", file_type: "code" },
      ],
      edges: [],
    };
    const G = buildFromJson(extraction, { root: "/tmp/some_root" });
    expect(G.getNodeAttributes("foo_bar")["source_file"]).toBe("src/foo.py");
  });
});

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

describe("build", () => {
  it("merges multiple extractions into one graph", () => {
    const ext1 = {
      nodes: [{ id: "n1", label: "A", file_type: "code", source_file: "a.py" }],
      edges: [],
      input_tokens: 0,
      output_tokens: 0,
    };
    const ext2 = {
      nodes: [{ id: "n2", label: "B", file_type: "document", source_file: "b.md" }],
      edges: [
        {
          source: "n1", target: "n2", relation: "references",
          confidence: "INFERRED", source_file: "b.md", weight: 1.0,
        },
      ],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = build([ext1, ext2]);
    expect(G.order).toBe(2);
    expect(G.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// normalizeId
// ---------------------------------------------------------------------------

describe("normalizeId", () => {
  it("lowercases and normalizes IDs", () => {
    expect(normalizeId("Session_ValidateToken")).toBe("session_validatetoken");
  });

  it("collapses underscores and strips edge punctuation", () => {
    expect(normalizeId("__foo__bar__")).toBe("foo_bar");
  });
});

// ---------------------------------------------------------------------------
// normSourceFile
// ---------------------------------------------------------------------------

describe("normSourceFile", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normSourceFile("src\\middleware\\auth.py")).toBe("src/middleware/auth.py");
  });

  it("returns null for null input", () => {
    expect(normSourceFile(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// edgeData / edgeDatas
// ---------------------------------------------------------------------------

describe("edgeData", () => {
  it("returns attributes for a simple graph edge", () => {
    const ext = {
      nodes: [
        { id: "a", label: "A", file_type: "code", source_file: "a.py" },
        { id: "b", label: "B", file_type: "code", source_file: "b.py" },
      ],
      edges: [
        { source: "a", target: "b", relation: "calls", confidence: "EXTRACTED" },
      ],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    const d = edgeData(G, "a", "b");
    expect(typeof d).toBe("object");
    expect(d["relation"]).toBe("calls");
    expect(d["confidence"]).toBe("EXTRACTED");
  });
});

describe("edgeDatas", () => {
  it("returns singleton list for simple graph edge", () => {
    const ext = {
      nodes: [
        { id: "a", label: "A", file_type: "code", source_file: "a.py" },
        { id: "b", label: "B", file_type: "code", source_file: "b.py" },
      ],
      edges: [
        { source: "a", target: "b", relation: "calls", confidence: "EXTRACTED" },
      ],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    const ds = edgeDatas(G, "a", "b");
    expect(Array.isArray(ds)).toBe(true);
    expect(ds.length).toBe(1);
    expect(ds[0]["relation"]).toBe("calls");
  });
});

// ---------------------------------------------------------------------------
// deduplicateByLabel
// ---------------------------------------------------------------------------

describe("deduplicateByLabel", () => {
  it("merges nodes sharing a normalised label, rewriting edges", () => {
    const nodes = [
      { id: "render_c1", label: "render" },
      { id: "render", label: "render" },
    ];
    const edges = [
      { source: "caller", target: "render_c1", relation: "calls" },
    ];
    const result = deduplicateByLabel(nodes, edges);
    // Chunk-suffixed ID loses to bare ID
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0]["id"]).toBe("render");
    // Edge rewired
    expect(result.edges[0]["target"]).toBe("render");
  });

  it("returns unchanged when no duplicates", () => {
    const nodes = [
      { id: "a", label: "alpha" },
      { id: "b", label: "beta" },
    ];
    const edges: Record<string, unknown>[] = [];
    const result = deduplicateByLabel(nodes, edges);
    expect(result.nodes).toBe(nodes);
    expect(result.edges).toBe(edges);
  });
});

// ---------------------------------------------------------------------------
// prefixGraphForGlobal
// ---------------------------------------------------------------------------

describe("prefixGraphForGlobal", () => {
  it("prefixes all node IDs and adds repo/local_id attributes", () => {
    const ext = {
      nodes: [
        { id: "n1", label: "A", file_type: "code", source_file: "a.py" },
        { id: "n2", label: "B", file_type: "code", source_file: "b.py" },
      ],
      edges: [
        { source: "n1", target: "n2", relation: "calls", confidence: "EXTRACTED" },
      ],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    const H = prefixGraphForGlobal(G, "myrepo");
    expect(H.hasNode("myrepo::n1")).toBe(true);
    expect(H.hasNode("myrepo::n2")).toBe(true);
    expect(H.getNodeAttributes("myrepo::n1")["repo"]).toBe("myrepo");
    expect(H.getNodeAttributes("myrepo::n1")["local_id"]).toBe("n1");
  });
});

// ---------------------------------------------------------------------------
// pruneRepoFromGraph
// ---------------------------------------------------------------------------

describe("pruneRepoFromGraph", () => {
  it("removes all nodes tagged with the given repo", () => {
    const ext = {
      nodes: [
        { id: "n1", label: "A", file_type: "code", source_file: "a.py" },
        { id: "n2", label: "B", file_type: "code", source_file: "b.py" },
      ],
      edges: [],
      input_tokens: 0,
      output_tokens: 0,
    };
    const G = buildFromJson(ext);
    // Tag nodes
    G.mergeNodeAttributes("n1", { repo: "repo_a" });
    G.mergeNodeAttributes("n2", { repo: "repo_b" });
    const removed = pruneRepoFromGraph(G, "repo_a");
    expect(removed).toBe(1);
    expect(G.hasNode("n1")).toBe(false);
    expect(G.hasNode("n2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMerge
// ---------------------------------------------------------------------------

describe("buildMerge", () => {
  it("replaces stale nodes/edges when a file is re-extracted", () => {
    const tmpDir = path.join(FIXTURES, "..", "tmp_build_merge_test");
    fs.mkdirSync(tmpDir, { recursive: true });
    const graphPath = path.join(tmpDir, "graph.json");

    try {
      // First build: changed.md contributed A, B and edge A->B; keep.md is unrelated.
      const chunk0 = {
        nodes: [
          { id: "A", label: "A", file_type: "document", source_file: "changed.md" },
          { id: "B", label: "B", file_type: "document", source_file: "changed.md" },
          { id: "K", label: "K", file_type: "document", source_file: "keep.md" },
        ],
        edges: [
          {
            source: "A", target: "B", relation: "references", confidence: "EXTRACTED",
            source_file: "changed.md", weight: 1.0,
          },
          {
            source: "K", target: "A", relation: "references", confidence: "EXTRACTED",
            source_file: "keep.md", weight: 1.0,
          },
        ],
      };
      const G0 = build([chunk0]);
      // Save as JSON manually
      const jsonNodes: Record<string, unknown>[] = [];
      const jsonEdges: Record<string, unknown>[] = [];
      G0.forEachNode((node: string, attrs: Record<string, unknown>) => {
        jsonNodes.push({ id: node, ...attrs });
      });
      G0.forEachEdge((_ek: string, attrs: Record<string, unknown>, src: string, tgt: string) => {
        jsonEdges.push({ source: src, target: tgt, ...attrs });
      });
      fs.writeFileSync(graphPath, JSON.stringify({ nodes: jsonNodes, edges: jsonEdges }), "utf-8");

      // changed.md edited: re-extraction now yields A, C and edge A->C (B dropped).
      const newChunk = {
        nodes: [
          { id: "A", label: "A", file_type: "document", source_file: "changed.md" },
          { id: "C", label: "C", file_type: "document", source_file: "changed.md" },
        ],
        edges: [
          {
            source: "A", target: "C", relation: "references", confidence: "EXTRACTED",
            source_file: "changed.md", weight: 1.0,
          },
        ],
      };
      const G1 = buildMerge([newChunk], graphPath);

      const labels = new Set<string>();
      G1.forEachNode((_nid: string, attrs: Record<string, unknown>) => {
        labels.add(attrs["label"] as string);
      });

      // Stale contribution from the old version of changed.md is gone.
      expect(labels.has("B")).toBe(false);
      // Fresh contribution is present.
      expect(labels.has("C")).toBe(true);
      // An unchanged file is untouched.
      expect(labels.has("K")).toBe(true);
    } finally {
      // Cleanup
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }
  });
});
