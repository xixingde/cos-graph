/** Tests for src/wiki.ts.
 *  Ported from graphify/wiki.py logic.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Graph from "graphology";

import {
  safeFilename,
  crossCommunityLinks,
  communityArticle,
  godNodeArticle,
  indexMd,
  toWiki,
} from "../src/wiki.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeGraph(): Graph {
  const g = new Graph({ type: "directed" });
  g.addNode("n1", { label: "Parser", source_file: "src/parse.ts", kind: "function" });
  g.addNode("n2", { label: "Tokenizer", source_file: "src/token.ts", kind: "function" });
  g.addNode("n3", { label: "AST Builder", source_file: "src/ast.ts", kind: "function" });
  g.addDirectedEdge("n1", "n2", { relation: "calls", confidence: "EXTRACTED" });
  g.addDirectedEdge("n2", "n3", { relation: "uses", confidence: "EXTRACTED" });
  g.addDirectedEdge("n3", "n1", { relation: "imports", confidence: "INFERRED" });
  return g;
}

function makeGraphWithCommunities(): Graph {
  const g = new Graph({ type: "directed" });
  g.addNode("a", { label: "Alpha", source_file: "src/a.ts", kind: "function" });
  g.addNode("b", { label: "Beta", source_file: "src/b.ts", kind: "function" });
  g.addNode("c", { label: "Gamma", source_file: "src/c.ts", kind: "concept" });
  g.addNode("d", { label: "Delta", source_file: "src/d.ts", kind: "function" });
  g.addNode("e", { label: "Epsilon", source_file: "src/e.ts", kind: "concept" });
  g.addDirectedEdge("a", "b", { relation: "calls", confidence: "EXTRACTED" });
  g.addDirectedEdge("b", "c", { relation: "uses", confidence: "EXTRACTED" });
  g.addDirectedEdge("c", "d", { relation: "uses", confidence: "INFERRED" });
  g.addDirectedEdge("d", "e", { relation: "uses", confidence: "EXTRACTED" });
  g.addDirectedEdge("a", "d", { relation: "imports", confidence: "EXTRACTED" });
  return g;
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wiki-test-"));
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tmpDirs.length = 0;
});

// ── safeFilename ─────────────────────────────────────────────────────────────

describe("safeFilename", () => {
  it("replaces slashes and spaces", () => {
    expect(safeFilename("src/parse ts")).toBe("src-parse_ts");
  });

  it("replaces colons with dashes", () => {
    expect(safeFilename("module:class")).toBe("module-class");
  });

  it("returns cleaned name for simple input", () => {
    expect(safeFilename("MyComponent")).toBe("MyComponent");
  });

  it("replaces unsafe characters with underscores", () => {
    expect(safeFilename("a<b>c\\d|e?f*g")).toBe("a_b_c_d_e_f_g");
  });

  it("truncates names over 200 chars", () => {
    const long = "x".repeat(250);
    expect(safeFilename(long).length).toBe(200);
  });

  it("returns 'unnamed' for empty after cleanup", () => {
    expect(safeFilename("...")).toBe("unnamed");
  });
});

// ── crossCommunityLinks ─────────────────────────────────────────────────────

describe("crossCommunityLinks", () => {
  it("returns links from other communities", () => {
    const g = makeGraphWithCommunities();
    const nodeCommunity: Record<string, number> = { a: 0, b: 0, c: 1, d: 1, e: 1 };
    const labels: Record<number, string> = { 0: "Group A", 1: "Group B" };
    const links = crossCommunityLinks(g, ["a", "b"], 0, labels, nodeCommunity);
    expect(links.length).toBeGreaterThan(0);
  });

  it("returns empty for isolated community", () => {
    const g = new Graph({ type: "directed" });
    g.addNode("x", { label: "X" });
    g.addNode("y", { label: "Y" });
    const nodeCommunity: Record<string, number> = { x: 0, y: 1 };
    const labels: Record<number, string> = { 0: "Group X", 1: "Group Y" };
    const links = crossCommunityLinks(g, ["x"], 0, labels, nodeCommunity);
    expect(links).toEqual([]);
  });

  it("counts multiple edges to same community", () => {
    const g = makeGraphWithCommunities();
    const nodeCommunity: Record<string, number> = { a: 0, b: 0, c: 1, d: 1, e: 1 };
    const labels: Record<number, string> = { 0: "Group A", 1: "Group B" };
    const links = crossCommunityLinks(g, ["a", "b"], 0, labels, nodeCommunity);
    const groupBLink = links.find((l) => l[0] === "Group B");
    expect(groupBLink).toBeDefined();
    expect(groupBLink![1]).toBeGreaterThan(0);
  });
});

// ── communityArticle ─────────────────────────────────────────────────────────

describe("communityArticle", () => {
  it("generates markdown article for a community", () => {
    const g = makeGraphWithCommunities();
    const nodeCommunity: Record<string, number> = { a: 0, b: 0, c: 1, d: 1, e: 1 };
    const labels: Record<number, string> = { 0: "Parsing", 1: "Processing" };
    const article = communityArticle(g, 0, ["a", "b"], "Parsing", labels, null, nodeCommunity);
    expect(article).toContain("# Parsing");
    expect(article).toContain("Alpha");
    expect(article).toContain("Beta");
  });

  it("includes cross-community links section", () => {
    const g = makeGraphWithCommunities();
    const nodeCommunity: Record<string, number> = { a: 0, b: 0, c: 1, d: 1, e: 1 };
    const labels: Record<number, string> = { 0: "Group A", 1: "Group B" };
    const article = communityArticle(g, 0, ["a", "b"], "Group A", labels, null, nodeCommunity);
    expect(article).toContain("Group B");
  });

  it("includes cohesion when provided", () => {
    const g = makeGraphWithCommunities();
    const labels: Record<number, string> = { 0: "Test" };
    const article = communityArticle(g, 0, ["a", "b"], "Test", labels, 0.85, {});
    expect(article).toContain("cohesion 0.85");
  });

  it("omits cohesion when null", () => {
    const g = makeGraphWithCommunities();
    const labels: Record<number, string> = { 0: "Test" };
    const article = communityArticle(g, 0, ["a"], "Test", labels, null, {});
    expect(article).not.toContain("cohesion");
  });

  it("includes Audit Trail section", () => {
    const g = makeGraphWithCommunities();
    const labels: Record<number, string> = { 0: "Test" };
    const article = communityArticle(g, 0, ["a"], "Test", labels, null, {});
    expect(article).toContain("Audit Trail");
    expect(article).toContain("EXTRACTED");
  });
});

// ── godNodeArticle ───────────────────────────────────────────────────────────

describe("godNodeArticle", () => {
  it("generates article for a highly connected node", () => {
    const g = makeGraph();
    const article = godNodeArticle(g, "n1", {});
    expect(article).toContain("# Parser");
    expect(article).toContain("God node");
  });

  it("includes community info when provided", () => {
    const g = makeGraph();
    const nodeCommunity: Record<string, number> = { n1: 0, n2: 0, n3: 1 };
    const labels: Record<number, string> = { 0: "Core", 1: "Util" };
    const article = godNodeArticle(g, "n1", labels, nodeCommunity);
    expect(article).toContain("Core");
  });

  it("groups neighbors by relation type", () => {
    const g = makeGraph();
    const article = godNodeArticle(g, "n1", {});
    expect(article).toContain("Connections by Relation");
  });
});

// ── indexMd ─────────────────────────────────────────────────────────────────

describe("indexMd", () => {
  it("generates index with community and god node entries", () => {
    const communities: Record<number, string[]> = {
      0: ["a", "b"],
      1: ["c", "d"],
    };
    const labels: Record<number, string> = { 0: "Core", 1: "Utils" };
    const godNodes = [{ id: "a", label: "Alpha", community: 0, degree: 5, neighbors: [] }];
    const index = indexMd(communities, labels, godNodes, 4, 3);
    expect(index).toContain("Core");
    expect(index).toContain("Utils");
    expect(index).toContain("Alpha");
    expect(index).toContain("4 nodes");
  });

  it("has a god nodes section heading when god nodes exist", () => {
    const communities: Record<number, string[]> = { 0: ["x"] };
    const labels: Record<number, string> = { 0: "Test" };
    const godNodes = [{ id: "x", label: "XNode", community: 0, degree: 2, neighbors: [] }];
    const index = indexMd(communities, labels, godNodes, 1, 0);
    expect(index).toContain("God Nodes");
    expect(index).toContain("XNode");
  });

  it("shows total nodes and edges", () => {
    const communities: Record<number, string[]> = { 0: ["x"] };
    const labels: Record<number, string> = { 0: "Test" };
    const index = indexMd(communities, labels, [], 42, 99);
    expect(index).toContain("42 nodes");
    expect(index).toContain("99 edges");
  });
});

// ── toWiki ───────────────────────────────────────────────────────────────────

describe("toWiki", () => {
  it("generates wiki files and returns article count", () => {
    const g = makeGraphWithCommunities();
    const communities: Record<number, string[]> = {
      0: ["a", "b"],
      1: ["c", "d", "e"],
    };
    const labels: Record<number, string> = { 0: "Parsing", 1: "Processing" };
    const dir = tmpDir(); tmpDirs.push(dir);
    const result = toWiki(g, communities, dir, labels);
    expect(result).toBe(2);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(3); // 2 community + 1 index
    expect(files).toContain("index.md");
  });

  it("throws on empty communities", () => {
    const g = new Graph({ type: "directed" });
    const dir = tmpDir(); tmpDirs.push(dir);
    expect(() => toWiki(g, {}, dir)).toThrow("communities dict is empty");
  });

  it("includes community label in generated files", () => {
    const g = makeGraphWithCommunities();
    const communities: Record<number, string[]> = { 0: ["a", "b"] };
    const labels: Record<number, string> = { 0: "MyGroup" };
    const dir = tmpDir(); tmpDirs.push(dir);
    toWiki(g, communities, dir, labels);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "index.md");
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf-8");
    expect(content).toContain("MyGroup");
  });

  it("writes god node articles", () => {
    const g = makeGraphWithCommunities();
    const communities: Record<number, string[]> = { 0: ["a", "b", "c", "d", "e"] };
    const labels: Record<number, string> = { 0: "All" };
    const godNodes = [{ id: "a", label: "AlphaGod", degree: 3 }];
    const dir = tmpDir(); tmpDirs.push(dir);
    const result = toWiki(g, communities, dir, labels, undefined, undefined, godNodes);
    expect(result).toBeGreaterThanOrEqual(1);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "index.md");
    expect(files.length).toBeGreaterThanOrEqual(1);
  });
});
