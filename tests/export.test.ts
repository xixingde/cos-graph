/** Tests for src/export/ — multi-format graph export module.
 *  Ported from graphify/tests/test_cli_export.py.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Graph from "graphology";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  cypherEscape,
  cypherLabel,
  toCypher,
} from "../src/export/cypher.js";
import {
  stripDiacritics,
  yamlStr,
  obsidianTag,
  sanitizeLabel,
  capFilename,
  safeName,
} from "../src/export/obsidian.js";
import {
  pruneDanglingEdges,
  attachHyperedges,
  toJson,
} from "../src/export/json.js";
import { toGraphml } from "../src/export/graphml.js";
import { toCanvas } from "../src/export/canvas.js";
import {
  toHtml,
  generateHtml,
  vizNodeLimit,
  COMMUNITY_COLORS,
  MAX_NODES_FOR_VIZ,
  htmlStyles,
} from "../src/export/html.js";
import { toSvg } from "../src/export/svg.js";
import { pushToNeo4j } from "../src/export/neo4j.js";
import { pushToFalkorDB } from "../src/export/falkordb.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSimpleGraph(): Graph {
  const g = new Graph({ type: "undirected" });
  g.addNode("n1", { label: "AuthService", source_file: "src/auth.py", file_type: "py" });
  g.addNode("n2", { label: "UserService", source_file: "src/user.py", file_type: "py" });
  g.addNode("n3", { label: "DBHelper", source_file: "src/db.ts", file_type: "ts" });
  g.addEdge("n1", "n2", { relation: "IMPORTS", confidence: "EXTRACTED" });
  g.addEdge("n2", "n3", { relation: "CALLS", confidence: "INFERRED" });
  return g;
}

const SIMPLE_COMMUNITIES: Record<number, string[]> = {
  0: ["n1", "n2"],
  1: ["n3"],
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-export-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── cypherEscape ─────────────────────────────────────────────────────────────

describe("cypherEscape", () => {
  it("escapes single quotes", () => {
    expect(cypherEscape("it's")).toBe("it\\'s");
  });

  it("escapes backslashes", () => {
    expect(cypherEscape("a\\b")).toBe("a\\\\b");
  });

  it("escapes newlines and carriage returns", () => {
    const input = "line1\nline2\r";
    const result = cypherEscape(input);
    expect(result).toContain("\\n");
    expect(result).toContain("\\r");
    expect(result).not.toContain("\n");
    expect(result).not.toContain("\r");
  });

  it("strips NUL and C0 control chars except tab", () => {
    expect(cypherEscape("a\x00b\tc")).toBe("ab\tc");
  });

  it("leaves normal text unchanged", () => {
    expect(cypherEscape("Hello World")).toBe("Hello World");
  });
});

// ── cypherLabel ──────────────────────────────────────────────────────────────

describe("cypherLabel", () => {
  it("returns cleaned identifier when valid", () => {
    expect(cypherLabel("AuthService", "Entity")).toBe("AuthService");
  });

  it("strips non-identifier chars", () => {
    expect(cypherLabel("auth-service!", "Entity")).toBe("authservice");
  });

  it("falls back when result starts with digit", () => {
    expect(cypherLabel("123invalid", "Entity")).toBe("Entity");
  });

  it("falls back when result is empty", () => {
    expect(cypherLabel("!@#", "Entity")).toBe("Entity");
  });

  it("handles null/undefined input", () => {
    expect(cypherLabel(null as unknown as string, "Entity")).toBe("Entity");
  });
});

// ── stripDiacritics ──────────────────────────────────────────────────────────

describe("stripDiacritics", () => {
  it("strips combining marks from accented characters", () => {
    expect(stripDiacritics("café")).toBe("cafe");
  });

  it("handles null input", () => {
    expect(stripDiacritics(null)).toBe("");
  });

  it("handles undefined input", () => {
    expect(stripDiacritics(undefined as unknown as string)).toBe("");
  });

  it("leaves ASCII unchanged", () => {
    expect(stripDiacritics("hello")).toBe("hello");
  });

  it("handles German umlauts", () => {
    // ü decomposes to u + combining diaeresis
    expect(stripDiacritics("über")).toBe("uber");
  });
});

// ── yamlStr ──────────────────────────────────────────────────────────────────

describe("yamlStr", () => {
  it("escapes backslashes", () => {
    expect(yamlStr("a\\b")).toBe("a\\\\b");
  });

  it("escapes double quotes", () => {
    expect(yamlStr('say "hi"')).toBe('say \\"hi\\"');
  });

  it("escapes newlines", () => {
    expect(yamlStr("a\nb")).toBe("a\\nb");
  });

  it("escapes tabs", () => {
    expect(yamlStr("a\tb")).toBe("a\\tb");
  });

  it("escapes NUL", () => {
    expect(yamlStr("a\0b")).toBe("a\\0b");
  });

  it("returns empty string for null/undefined", () => {
    expect(yamlStr(null)).toBe("");
    expect(yamlStr(undefined)).toBe("");
  });

  it("leaves normal text unchanged", () => {
    expect(yamlStr("hello world")).toBe("hello world");
  });
});

// ── obsidianTag ──────────────────────────────────────────────────────────────

describe("obsidianTag", () => {
  it("replaces spaces with underscores", () => {
    expect(obsidianTag("my community")).toBe("my_community");
  });

  it("strips non-alphanumeric chars except hyphen and slash", () => {
    expect(obsidianTag("comm#1!")).toBe("comm1");
  });

  it("preserves hyphens and slashes", () => {
    expect(obsidianTag("my-comm/sub")).toBe("my-comm/sub");
  });
});

// ── sanitizeLabel ────────────────────────────────────────────────────────────

describe("sanitizeLabel", () => {
  it("strips control characters except tab and newline", () => {
    expect(sanitizeLabel("a\x01b\tc\nd")).toBe("ab\tc\nd");
  });

  it("caps length at 200 chars", () => {
    const long = "a".repeat(300);
    expect(sanitizeLabel(long).length).toBe(200);
  });

  it("leaves normal text unchanged when under limit", () => {
    expect(sanitizeLabel("Hello World")).toBe("Hello World");
  });
});

// ── capFilename ──────────────────────────────────────────────────────────────

describe("capFilename", () => {
  it("returns short strings unchanged", () => {
    expect(capFilename("short")).toBe("short");
  });

  it("truncates long strings by UTF-8 byte limit", () => {
    const long = "a".repeat(300);
    const result = capFilename(long, 200);
    // Result should be shorter than 300 and include a hash suffix
    expect(result.length).toBeLessThan(300);
    expect(result).toContain("_");
  });
});

// ── safeName ─────────────────────────────────────────────────────────────────

describe("safeName", () => {
  it("strips filesystem-unsafe chars", () => {
    expect(safeName('hello "world"')).toBe("hello world");
  });

  it("does not collapse whitespace (matches Python implementation)", () => {
    expect(safeName("a   b")).toBe("a   b");
  });

  it("trims leading/trailing spaces", () => {
    expect(safeName("  hello  ")).toBe("hello");
  });

  it("returns 'unnamed' for empty/whitespace-only input", () => {
    expect(safeName("   ")).toBe("unnamed");
  });
});

// ── pruneDanglingEdges ───────────────────────────────────────────────────────

describe("pruneDanglingEdges", () => {
  it("removes edges referencing missing nodes", () => {
    const data = {
      nodes: [{ id: "a" }, { id: "b" }],
      links: [
        { source: "a", target: "b" },
        { source: "a", target: "missing" },
        { source: "ghost", target: "b" },
      ],
    };
    const result = pruneDanglingEdges(data);
    expect(result.pruned).toBe(2);
    expect((result.data["links"] as unknown[]).length).toBe(1);
  });

  it("returns pruned=0 when all edges are valid", () => {
    const data = {
      nodes: [{ id: "a" }, { id: "b" }],
      links: [{ source: "a", target: "b" }],
    };
    const result = pruneDanglingEdges(data);
    expect(result.pruned).toBe(0);
  });

  it("handles 'edges' key as fallback for 'links'", () => {
    const data = {
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ source: "a", target: "missing" }],
    };
    const result = pruneDanglingEdges(data);
    expect(result.pruned).toBe(1);
  });

  it("handles empty graph", () => {
    const data = { nodes: [], links: [] };
    const result = pruneDanglingEdges(data);
    expect(result.pruned).toBe(0);
  });
});

// ── attachHyperedges ──────────────────────────────────────────────────────────

describe("attachHyperedges", () => {
  it("adds hyperedges to graph attributes", () => {
    const g = new Graph();
    g.addNode("a", { label: "A" });
    attachHyperedges(g, [{ id: "h1", label: "H1", nodes: ["a"] }]);
    const he = g.getAttribute("hyperedges") as Record<string, unknown>[];
    expect(he.length).toBe(1);
    expect(he[0]["id"]).toBe("h1");
  });

  it("deduplicates by id", () => {
    const g = new Graph();
    g.addNode("a", { label: "A" });
    attachHyperedges(g, [{ id: "h1", label: "H1", nodes: ["a"] }]);
    attachHyperedges(g, [{ id: "h1", label: "H1-updated", nodes: ["a"] }]);
    const he = g.getAttribute("hyperedges") as Record<string, unknown>[];
    expect(he.length).toBe(1);
  });

  it("appends new hyperedges to existing ones", () => {
    const g = new Graph();
    g.addNode("a", { label: "A" });
    attachHyperedges(g, [{ id: "h1", label: "H1", nodes: ["a"] }]);
    attachHyperedges(g, [{ id: "h2", label: "H2", nodes: ["a"] }]);
    const he = g.getAttribute("hyperedges") as Record<string, unknown>[];
    expect(he.length).toBe(2);
  });
});

// ── toJson ───────────────────────────────────────────────────────────────────

describe("toJson", () => {
  it("writes graph.json with nodes and links", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "graph.json");
    const result = toJson(g, SIMPLE_COMMUNITIES, outPath);
    expect(result).toBe(true);
    expect(fs.existsSync(outPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    expect(written.nodes.length).toBe(3);
    expect(written.links.length).toBe(2);
  });

  it("adds community to each node", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "graph.json");
    toJson(g, SIMPLE_COMMUNITIES, outPath);

    const written = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    for (const node of written.nodes) {
      expect("community" in node).toBe(true);
    }
  });

  it("adds confidence_score to edges", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "graph.json");
    toJson(g, SIMPLE_COMMUNITIES, outPath);

    const written = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    for (const link of written.links) {
      expect("confidence_score" in link).toBe(true);
    }
  });

  it("adds norm_label to each node", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "graph.json");
    toJson(g, SIMPLE_COMMUNITIES, outPath);

    const written = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    for (const node of written.nodes) {
      expect("norm_label" in node).toBe(true);
      expect(typeof node.norm_label).toBe("string");
    }
  });

  it("restores edge direction from _src/_tgt", () => {
    const g = new Graph({ type: "directed" });
    g.addNode("a", { label: "A", source_file: "a.py" });
    g.addNode("b", { label: "B", source_file: "b.py" });
    g.addEdge("a", "b", { relation: "CALLS", confidence: "EXTRACTED", _src: "b", _tgt: "a" });
    const outPath = path.join(tmpDir, "graph.json");
    toJson(g, { 0: ["a", "b"] }, outPath);

    const written = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    const link = written.links[0];
    expect(link.source).toBe("b");
    expect(link.target).toBe("a");
    expect("_src" in link).toBe(false);
    expect("_tgt" in link).toBe(false);
  });

  it("refuses to overwrite when new graph is smaller (node shrink protection)", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "graph.json");

    // Write initial graph
    toJson(g, SIMPLE_COMMUNITIES, outPath);

    // Create smaller graph (2 nodes instead of 3)
    const small = new Graph({ type: "undirected" });
    small.addNode("x", { label: "X", source_file: "x.py" });
    small.addNode("y", { label: "Y", source_file: "y.py" });
    const result = toJson(small, { 0: ["x", "y"] }, outPath);
    expect(result).toBe(false);
  });

  it("overwrites with force=true even if smaller", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "graph.json");
    toJson(g, SIMPLE_COMMUNITIES, outPath);

    const small = new Graph({ type: "undirected" });
    small.addNode("x", { label: "X", source_file: "x.py" });
    small.addNode("y", { label: "Y", source_file: "y.py" });
    const result = toJson(small, { 0: ["x", "y"] }, outPath, { force: true });
    expect(result).toBe(true);
  });

  it("includes community_name when communityLabels provided", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "graph.json");
    toJson(g, SIMPLE_COMMUNITIES, outPath, { communityLabels: { 0: "Auth", 1: "Data" } });

    const written = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    const nodeN1 = written.nodes.find((n: Record<string, unknown>) => n.id === "n1");
    expect(nodeN1.community_name).toBe("Auth");
  });
});

// ── toCypher ─────────────────────────────────────────────────────────────────

describe("toCypher", () => {
  it("writes Cypher import script", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "import.cypher");
    toCypher(g, outPath);
    expect(fs.existsSync(outPath)).toBe(true);

    const content = fs.readFileSync(outPath, "utf-8");
    expect(content).toContain("MERGE");
    expect(content).toContain("AuthService");
    expect(content).toContain("MATCH");
  });

  it("creates node labels from file_type", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "import.cypher");
    toCypher(g, outPath);

    const content = fs.readFileSync(outPath, "utf-8");
    expect(content).toContain(":Py");
  });

  it("creates relationship types from relation attribute", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "import.cypher");
    toCypher(g, outPath);

    const content = fs.readFileSync(outPath, "utf-8");
    expect(content).toContain("IMPORTS");
  });
});

// ── toGraphml ────────────────────────────────────────────────────────────────

describe("toGraphml", () => {
  it("writes valid GraphML XML", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "graph.graphml");
    toGraphml(g, SIMPLE_COMMUNITIES, outPath);
    expect(fs.existsSync(outPath)).toBe(true);

    const content = fs.readFileSync(outPath, "utf-8");
    expect(content).toContain("<?xml");
    expect(content).toContain("<graphml");
    expect(content).toContain("<node");
    expect(content).toContain("<edge");
  });

  it("includes community as node attribute", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "graph.graphml");
    toGraphml(g, SIMPLE_COMMUNITIES, outPath);

    const content = fs.readFileSync(outPath, "utf-8");
    expect(content).toContain('key="community"');
  });

  it("escapes XML special chars in attributes", () => {
    const g = new Graph({ type: "undirected" });
    g.addNode("x", { label: "A & B < C", source_file: "test.py" });
    const outPath = path.join(tmpDir, "graph.graphml");
    toGraphml(g, { 0: ["x"] }, outPath);

    const content = fs.readFileSync(outPath, "utf-8");
    expect(content).not.toContain("A & B < C");
    expect(content).toContain("A &amp; B &lt; C");
  });
});

// ── toCanvas ─────────────────────────────────────────────────────────────────

describe("toCanvas", () => {
  it("writes Obsidian Canvas JSON with groups and cards", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "canvas.json");
    toCanvas(g, SIMPLE_COMMUNITIES, outPath);
    expect(fs.existsSync(outPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.edges.length).toBeGreaterThan(0);

    // Should have group nodes
    const groups = data.nodes.filter((n: Record<string, unknown>) => n.type === "group");
    expect(groups.length).toBe(2);
  });

  it("handles empty communities by putting all nodes in one group", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "canvas.json");
    toCanvas(g, {}, outPath);

    const data = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    const groups = data.nodes.filter((n: Record<string, unknown>) => n.type === "group");
    expect(groups.length).toBe(1);
  });
});

// ── toHtml / generateHtml ────────────────────────────────────────────────────

describe("toHtml", () => {
  it("writes an HTML file", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "graph.html");
    toHtml(g, SIMPLE_COMMUNITIES, outPath);
    expect(fs.existsSync(outPath)).toBe(true);

    const content = fs.readFileSync(outPath, "utf-8");
    expect(content).toContain("<!DOCTYPE html>");
    expect(content).toContain("vis-network");
  });
});

describe("generateHtml", () => {
  it("writes HTML file (alias for toHtml)", () => {
    const g = makeSimpleGraph();
    const outPath = path.join(tmpDir, "generated.html");
    generateHtml(g, SIMPLE_COMMUNITIES, outPath);
    expect(fs.existsSync(outPath)).toBe(true);
    const content = fs.readFileSync(outPath, "utf-8");
    expect(content).toContain("<!DOCTYPE html>");
    expect(content).toContain("vis-network");
  });
});

describe("vizNodeLimit", () => {
  it("returns default when env var not set", () => {
    const orig = process.env.GRAPHIFY_VIZ_NODE_LIMIT;
    delete process.env.GRAPHIFY_VIZ_NODE_LIMIT;
    expect(vizNodeLimit()).toBe(MAX_NODES_FOR_VIZ);
    if (orig !== undefined) process.env.GRAPHIFY_VIZ_NODE_LIMIT = orig;
  });

  it("honours GRAPHIFY_VIZ_NODE_LIMIT env var", () => {
    const orig = process.env.GRAPHIFY_VIZ_NODE_LIMIT;
    process.env.GRAPHIFY_VIZ_NODE_LIMIT = "1000";
    expect(vizNodeLimit()).toBe(1000);
    if (orig !== undefined) process.env.GRAPHIFY_VIZ_NODE_LIMIT = orig;
    else delete process.env.GRAPHIFY_VIZ_NODE_LIMIT;
  });

  it("falls back to default for invalid value", () => {
    const orig = process.env.GRAPHIFY_VIZ_NODE_LIMIT;
    process.env.GRAPHIFY_VIZ_NODE_LIMIT = "not-a-number";
    expect(vizNodeLimit()).toBe(MAX_NODES_FOR_VIZ);
    if (orig !== undefined) process.env.GRAPHIFY_VIZ_NODE_LIMIT = orig;
    else delete process.env.GRAPHIFY_VIZ_NODE_LIMIT;
  });
});

// ── htmlStyles ───────────────────────────────────────────────────────────────

describe("htmlStyles", () => {
  it("returns CSS within style tags", () => {
    const styles = htmlStyles();
    expect(styles).toContain("<style>");
    expect(styles).toContain("</style>");
  });
});

// ── COMMUNITY_COLORS ─────────────────────────────────────────────────────────

describe("COMMUNITY_COLORS", () => {
  it("is a non-empty array of hex color strings", () => {
    expect(COMMUNITY_COLORS.length).toBeGreaterThan(0);
    for (const c of COMMUNITY_COLORS) {
      expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

// ── TODO stubs: toSvg, pushToNeo4j, pushToFalkorDB ───────────────────────────

describe("toSvg stub", () => {
  it("throws 'Not implemented' error", () => {
    const g = makeSimpleGraph();
    expect(() => toSvg(g, SIMPLE_COMMUNITIES, "/dev/null")).toThrow("Not implemented");
  });
});

describe("pushToNeo4j stub", () => {
  it("throws 'Not implemented' error", () => {
    const g = makeSimpleGraph();
    expect(() => pushToNeo4j(g, "bolt://localhost", "neo4j", "pw")).toThrow("Not implemented");
  });
});

describe("pushToFalkorDB stub", () => {
  it("throws 'Not implemented' error", () => {
    const g = makeSimpleGraph();
    expect(() => pushToFalkorDB(g, "redis://localhost")).toThrow("Not implemented");
  });
});
