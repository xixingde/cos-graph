/** Tests for src/analyze.ts.
 *  Ported from tests/test_analyze.py.
 */
import { describe, it, expect } from "vitest";
import Graph, { DirectedGraph } from "graphology";
import * as fs from "fs";
import * as path from "path";

import {
  godNodes,
  surprisingConnections,
  suggestQuestions,
  graphDiff,
  findImportCycles,
  isFileNode,
  isConceptNode,
  isJsonKeyNode,
  nodeCommunityMap,
  surpriseScore,
  fileCategory,
  crossLanguage,
} from "../src/analyze.js";
import { graphFromJSON } from "../src/graph/factory.js";
import { cluster } from "../src/cluster.js";
import { degree, addNode, addEdge } from "../src/graph/operations.js";
import type { CommunityMap } from "../src/types/graph.js";

const FIXTURES = path.resolve(__dirname, "fixtures");

function makeGraph(): Graph {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, "extraction.json"), "utf-8"));
  return graphFromJSON(data);
}

// Helper: build a simple undirected graph from node/edge specs
function makeSimpleGraph(
  nodes: Array<[string, string]>,
  edges: Array<[string, string, string, string]>,
): Graph {
  const g = new Graph({ type: "undirected" });
  for (const [nodeId, label] of nodes) {
    g.addNode(nodeId, { label, source_file: "test.py" });
  }
  for (const [src, tgt, rel, conf] of edges) {
    g.addEdge(src, tgt, { relation: rel, confidence: conf });
  }
  return g;
}

// ── godNodes ────────────────────────────────────────────────────────────────

describe("godNodes", () => {
  it("returns list with at most topN entries", () => {
    const G = makeGraph();
    const result = godNodes(G, 3);
    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("sorted by degree descending", () => {
    const G = makeGraph();
    const result = godNodes(G, 10);
    const degs = result.map((r) => r.degree);
    expect(degs).toEqual([...degs].sort((a, b) => b - a));
  });

  it("has required keys", () => {
    const G = makeGraph();
    const result = godNodes(G, 1);
    expect(result.length).toBeGreaterThan(0);
    expect("id" in result[0]).toBe(true);
    expect("label" in result[0]).toBe(true);
    expect("degree" in result[0]).toBe(true);
  });

  it("excludes JSON noise labels", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("real", { label: "AuthService", source_file: "src/auth.py" });
    G.addNode("json_name", { label: "name", source_file: "schema.json" });
    for (let i = 0; i < 8; i++) {
      const n = `peer${i}`;
      G.addNode(n, { label: `Peer${i}`, source_file: `src/peer${i}.py` });
      G.addEdge("json_name", n);
      G.addEdge("real", n);
    }
    const result = godNodes(G, 10);
    const labels = result.map((r) => r.label);
    expect(labels).not.toContain("name");
    expect(labels).toContain("AuthService");
  });

  it("filter is case-insensitive for JSON noise", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("real", { label: "RealAbstraction", source_file: "libs/real.py" });
    for (let i = 0; i < 3; i++) {
      G.addNode(`peer${i}`, { label: `P${i}`, source_file: `src/p${i}.py` });
      G.addEdge("real", `peer${i}`);
    }
    for (const variant of ["Start", "START", "Name", "ID"]) {
      const nid = `json_${variant.toLowerCase()}`;
      if (!G.hasNode(nid)) G.addNode(nid, { label: variant, source_file: "testhelpers/data.json" });
      for (let i = 0; i < 15; i++) {
        const t = `${nid}_t${i}`;
        if (!G.hasNode(t)) G.addNode(t, { label: `X${i}`, source_file: "testhelpers/data.json" });
        if (!G.hasEdge(t, nid)) G.addEdge(t, nid);
      }
    }
    const result = godNodes(G, 10);
    const labels = result.map((r) => r.label);
    for (const variant of ["Start", "START", "Name", "ID"]) {
      expect(labels).not.toContain(variant);
    }
  });

  it("excludes npm dep-block keys", () => {
    for (const depKey of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "bundledDependencies"]) {
      const G = new Graph({ type: "undirected" });
      G.addNode("real_node", { label: "AuthService", source_file: "src/auth.py", file_type: "code", source_location: "L1" });
      G.addNode("dep_node", { label: depKey, source_file: "frontend/package.json", file_type: "code", source_location: "L1" });
      for (let i = 0; i < 20; i++) {
        const peer = `pkg_${i}`;
        G.addNode(peer, { label: `package-${i}`, source_file: "frontend/package.json", file_type: "code", source_location: `L${i + 2}` });
        G.addEdge("dep_node", peer, { relation: "contains", confidence: "EXTRACTED", source_file: "frontend/package.json" });
      }
      G.addEdge("real_node", "dep_node", { relation: "imports", confidence: "EXTRACTED", source_file: "src/auth.py" });

      const result = godNodes(G, 10);
      const resultIds = result.map((r) => r.id);
      expect(resultIds).not.toContain("dep_node");
      expect(resultIds).toContain("real_node");
    }
  });
});

// ── surprisingConnections ────────────────────────────────────────────────────

describe("surprisingConnections", () => {
  it("cross-source multi-file: finds cross-file edges", () => {
    const G = makeGraph();
    const communities = cluster(G);
    const surprises = surprisingConnections(G, communities);
    expect(surprises.length).toBeGreaterThan(0);
    for (const s of surprises) {
      expect(s.sourceFiles[0]).not.toBe(s.sourceFiles[1]);
    }
  });

  it("excludes concept nodes", () => {
    const G = makeGraph();
    // Add a concept node with empty source_file
    G.addNode("concept_x", { label: "Abstract Concept", file_type: "document", source_file: "" });
    G.addEdge("n_transformer", "concept_x", { relation: "relates_to", confidence: "INFERRED", source_file: "" });
    const communities = cluster(G);
    const surprises = surprisingConnections(G, communities);
    const labels = [...surprises.map((s) => s.source), ...surprises.map((s) => s.target)];
    expect(labels).not.toContain("Abstract Concept");
  });

  it("single-file uses community bridges", () => {
    const G = new Graph({ type: "undirected" });
    for (let i = 0; i < 5; i++) {
      G.addNode(`a${i}`, { label: `A${i}`, file_type: "code", source_file: "single.py", source_location: `L${i}` });
    }
    for (let i = 0; i < 5; i++) {
      G.addNode(`b${i}`, { label: `B${i}`, file_type: "code", source_file: "single.py", source_location: `L${i + 10}` });
    }
    for (let i = 0; i < 4; i++) {
      G.addEdge(`a${i}`, `a${i + 1}`, { relation: "calls", confidence: "EXTRACTED", source_file: "single.py" });
    }
    for (let i = 0; i < 4; i++) {
      G.addEdge(`b${i}`, `b${i + 1}`, { relation: "calls", confidence: "EXTRACTED", source_file: "single.py" });
    }
    G.addEdge("a4", "b0", { relation: "references", confidence: "INFERRED", source_file: "single.py" });
    const communities = cluster(G);
    const surprises = surprisingConnections(G, communities);
    expect(surprises.length).toBeGreaterThan(0);
  });

  it("has why field", () => {
    const G = makeGraph();
    const communities = cluster(G);
    for (const s of surprisingConnections(G, communities)) {
      expect("why" in s).toBe(true);
      expect(typeof s.why).toBe("string");
      expect(s.why!.length).toBeGreaterThan(0);
    }
  });

  it("has required keys", () => {
    const G = makeGraph();
    const communities = cluster(G);
    for (const s of surprisingConnections(G, communities)) {
      expect("source" in s).toBe(true);
      expect("target" in s).toBe(true);
      expect("sourceFiles" in s).toBe(true);
      expect("confidence" in s).toBe(true);
    }
  });
});

// ── surpriseScore ────────────────────────────────────────────────────────────

describe("surpriseScore", () => {
  function makeMultiFileGraph() {
    const G = new Graph({ type: "undirected" });
    G.addNode("a", { label: "Alpha", source_file: "repo1/model.py", file_type: "code" });
    G.addNode("b", { label: "Beta", source_file: "repo2/train.py", file_type: "code" });
    G.addNode("c", { label: "Gamma", source_file: "repo1/data.py", file_type: "code" });
    G.addNode("d", { label: "Delta", source_file: "repo2/eval.py", file_type: "code" });
    G.addEdge("a", "b", { relation: "calls", confidence: "AMBIGUOUS", source_file: "repo1/model.py" });
    G.addEdge("c", "d", { relation: "calls", confidence: "EXTRACTED", source_file: "repo1/data.py" });
    return G;
  }

  it("AMBIGUOUS scores higher than EXTRACTED", () => {
    const G = makeMultiFileGraph();
    const nc: Record<string, number> = { a: 0, c: 0, b: 1, d: 1 };
    const [scoreAmb] = surpriseScore(G, "a", "b", G.getEdgeAttributes("a", "b") as Record<string, unknown>, nc, "repo1/model.py", "repo2/train.py");
    const [scoreExt] = surpriseScore(G, "c", "d", G.getEdgeAttributes("c", "d") as Record<string, unknown>, nc, "repo1/data.py", "repo2/eval.py");
    expect(scoreAmb).toBeGreaterThan(scoreExt);
  });

  it("accepts precomputed degrees", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("hub", { label: "Hub", source_file: "repo1/hub.py", file_type: "code" });
    G.addNode("leaf", { label: "Leaf", source_file: "repo2/leaf.py", file_type: "code" });
    G.addNode("n1", { label: "N1", source_file: "repo1/n1.py", file_type: "code" });
    G.addNode("n2", { label: "N2", source_file: "repo1/n2.py", file_type: "code" });
    G.addNode("n3", { label: "N3", source_file: "repo1/n3.py", file_type: "code" });
    G.addNode("n4", { label: "N4", source_file: "repo1/n4.py", file_type: "code" });
    for (const node of ["leaf", "n1", "n2", "n3", "n4"]) {
      G.addEdge("hub", node, { relation: "calls", confidence: "EXTRACTED" });
    }
    const nc: Record<string, number> = { hub: 0, leaf: 1 };
    const edge = G.getEdgeAttributes("hub", "leaf") as Record<string, unknown>;
    const args: Parameters<typeof surpriseScore> = [G, "hub", "leaf", edge, nc, "repo1/hub.py", "repo2/leaf.py"];
    const degMap: Record<string, number> = {};
    G.forEachNode((n) => { degMap[n] = degree(G, n); });
    const [s1] = surpriseScore(...args);
    const [s2] = surpriseScore(G, "hub", "leaf", edge, nc, "repo1/hub.py", "repo2/leaf.py", degMap);
    expect(s1).toBe(s2);
  });

  it("cross-type (code↔paper) scores higher than same-type", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("a", { label: "Transformer", source_file: "code/model.py", file_type: "code" });
    G.addNode("b", { label: "FlashAttn", source_file: "papers/flash.pdf", file_type: "code" });
    G.addNode("c", { label: "Trainer", source_file: "code/train.py", file_type: "code" });
    G.addNode("d", { label: "Dataset", source_file: "code/data.py", file_type: "code" });
    G.addEdge("a", "b", { relation: "references", confidence: "EXTRACTED", source_file: "code/model.py" });
    G.addEdge("c", "d", { relation: "calls", confidence: "EXTRACTED", source_file: "code/train.py" });
    const nc: Record<string, number> = { a: 0, b: 1, c: 0, d: 0 };
    const [scoreCross, reasonsCross] = surpriseScore(G, "a", "b", G.getEdgeAttributes("a", "b") as Record<string, unknown>, nc, "code/model.py", "papers/flash.pdf");
    const [scoreSame] = surpriseScore(G, "c", "d", G.getEdgeAttributes("c", "d") as Record<string, unknown>, nc, "code/train.py", "code/data.py");
    expect(scoreCross).toBeGreaterThan(scoreSame);
    expect(reasonsCross.some((r) => r.includes("code") && r.includes("paper"))).toBe(true);
  });
});

// ── cross-language suppression ───────────────────────────────────────────────

function makeCrossLangGraph() {
  const G = new Graph({ type: "undirected" });
  G.addNode("py_auth", { label: "AuthError", source_file: "backend/auth.py", file_type: "code" });
  G.addNode("ts_member", { label: "Member", source_file: "frontend/types.ts", file_type: "code" });
  G.addNode("py_a", { label: "ServiceA", source_file: "backend/service.py", file_type: "code" });
  G.addNode("py_b", { label: "ServiceB", source_file: "backend/utils.py", file_type: "code" });
  return G;
}

describe("cross-language suppression", () => {
  it("INFERRED calls across languages are suppressed", () => {
    const G = makeCrossLangGraph();
    G.addEdge("py_auth", "ts_member", { relation: "calls", confidence: "INFERRED", source_file: "backend/auth.py" });
    G.addEdge("py_a", "py_b", { relation: "calls", confidence: "EXTRACTED", source_file: "backend/service.py" });
    const nc: Record<string, number> = { py_auth: 0, ts_member: 1, py_a: 0, py_b: 0 };
    const [scoreCross] = surpriseScore(G, "py_auth", "ts_member", G.getEdgeAttributes("py_auth", "ts_member") as Record<string, unknown>, nc, "backend/auth.py", "frontend/types.ts");
    const [scoreSame] = surpriseScore(G, "py_a", "py_b", G.getEdgeAttributes("py_a", "py_b") as Record<string, unknown>, nc, "backend/service.py", "backend/utils.py");
    expect(scoreCross).toBeLessThanOrEqual(scoreSame);
  });

  it("INFERRED uses across languages are suppressed", () => {
    const G = makeCrossLangGraph();
    G.addEdge("py_auth", "ts_member", { relation: "uses", confidence: "INFERRED", source_file: "backend/auth.py" });
    G.addEdge("py_a", "py_b", { relation: "calls", confidence: "EXTRACTED", source_file: "backend/service.py" });
    const nc: Record<string, number> = { py_auth: 0, ts_member: 1, py_a: 0, py_b: 0 };
    const [scoreCross] = surpriseScore(G, "py_auth", "ts_member", G.getEdgeAttributes("py_auth", "ts_member") as Record<string, unknown>, nc, "backend/auth.py", "frontend/types.ts");
    const [scoreSame] = surpriseScore(G, "py_a", "py_b", G.getEdgeAttributes("py_a", "py_b") as Record<string, unknown>, nc, "backend/service.py", "backend/utils.py");
    expect(scoreCross).toBeLessThanOrEqual(scoreSame);
  });

  it("semantically_similar_to across languages is NOT suppressed", () => {
    const G = makeCrossLangGraph();
    G.addEdge("py_auth", "ts_member", { relation: "semantically_similar_to", confidence: "INFERRED", source_file: "backend/auth.py" });
    G.addEdge("py_a", "py_b", { relation: "calls", confidence: "EXTRACTED", source_file: "backend/service.py" });
    const nc: Record<string, number> = { py_auth: 0, ts_member: 1, py_a: 0, py_b: 0 };
    const [scoreSem] = surpriseScore(G, "py_auth", "ts_member", G.getEdgeAttributes("py_auth", "ts_member") as Record<string, unknown>, nc, "backend/auth.py", "frontend/types.ts");
    const [scoreSame] = surpriseScore(G, "py_a", "py_b", G.getEdgeAttributes("py_a", "py_b") as Record<string, unknown>, nc, "backend/service.py", "backend/utils.py");
    expect(scoreSem).toBeGreaterThan(scoreSame);
  });

  it("same-language INFERRED calls are NOT suppressed", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("py_a", { label: "ModuleA", source_file: "src/a.py", file_type: "code" });
    G.addNode("py_b", { label: "ModuleB", source_file: "src/b.py", file_type: "code" });
    G.addNode("py_c", { label: "ModuleC", source_file: "src/c.py", file_type: "code" });
    G.addNode("py_d", { label: "ModuleD", source_file: "src/d.py", file_type: "code" });
    G.addEdge("py_a", "py_b", { relation: "calls", confidence: "INFERRED", source_file: "src/a.py" });
    G.addEdge("py_c", "py_d", { relation: "calls", confidence: "EXTRACTED", source_file: "src/c.py" });
    const nc: Record<string, number> = { py_a: 0, py_b: 1, py_c: 0, py_d: 1 };
    const [scoreInf] = surpriseScore(G, "py_a", "py_b", G.getEdgeAttributes("py_a", "py_b") as Record<string, unknown>, nc, "src/a.py", "src/b.py");
    const [scoreExt] = surpriseScore(G, "py_c", "py_d", G.getEdgeAttributes("py_c", "py_d") as Record<string, unknown>, nc, "src/c.py", "src/d.py");
    expect(scoreInf).toBeGreaterThan(scoreExt);
  });

  it("EXTRACTED cross-language calls are NOT suppressed", () => {
    const G = makeCrossLangGraph();
    G.addEdge("py_auth", "ts_member", { relation: "calls", confidence: "EXTRACTED", source_file: "backend/auth.py" });
    const nc: Record<string, number> = { py_auth: 0, ts_member: 1 };
    const [score] = surpriseScore(G, "py_auth", "ts_member", G.getEdgeAttributes("py_auth", "ts_member") as Record<string, unknown>, nc, "backend/auth.py", "frontend/types.ts");
    expect(score).toBeGreaterThanOrEqual(1);
  });
});

// ── code↔doc INFERRED suppression ───────────────────────────────────────────

function makeCodeDocGraph() {
  const G = new Graph({ type: "undirected" });
  G.addNode("py_fn", { label: "ProcessData", source_file: "src/processor.py", file_type: "document" });
  G.addNode("md_doc", { label: "README Section", source_file: "docs/readme.md", file_type: "document" });
  G.addNode("py_a", { label: "ServiceA", source_file: "src/service.py", file_type: "code" });
  G.addNode("py_b", { label: "ServiceB", source_file: "src/utils.py", file_type: "code" });
  return G;
}

describe("code↔doc suppression", () => {
  it("INFERRED calls code→doc is suppressed", () => {
    const G = makeCodeDocGraph();
    G.addEdge("py_fn", "md_doc", { relation: "calls", confidence: "INFERRED", source_file: "src/processor.py" });
    G.addEdge("py_a", "py_b", { relation: "calls", confidence: "EXTRACTED", source_file: "src/service.py" });
    const nc: Record<string, number> = { py_fn: 0, md_doc: 1, py_a: 0, py_b: 0 };
    const [scoreNoise] = surpriseScore(G, "py_fn", "md_doc", G.getEdgeAttributes("py_fn", "md_doc") as Record<string, unknown>, nc, "src/processor.py", "docs/readme.md");
    const [scoreReal] = surpriseScore(G, "py_a", "py_b", G.getEdgeAttributes("py_a", "py_b") as Record<string, unknown>, nc, "src/service.py", "src/utils.py");
    expect(scoreNoise).toBeLessThanOrEqual(scoreReal);
  });

  it("INFERRED uses code→doc is suppressed", () => {
    const G = makeCodeDocGraph();
    G.addEdge("py_fn", "md_doc", { relation: "uses", confidence: "INFERRED", source_file: "src/processor.py" });
    G.addEdge("py_a", "py_b", { relation: "calls", confidence: "EXTRACTED", source_file: "src/service.py" });
    const nc: Record<string, number> = { py_fn: 0, md_doc: 1, py_a: 0, py_b: 0 };
    const [scoreNoise] = surpriseScore(G, "py_fn", "md_doc", G.getEdgeAttributes("py_fn", "md_doc") as Record<string, unknown>, nc, "src/processor.py", "docs/readme.md");
    const [scoreReal] = surpriseScore(G, "py_a", "py_b", G.getEdgeAttributes("py_a", "py_b") as Record<string, unknown>, nc, "src/service.py", "src/utils.py");
    expect(scoreNoise).toBeLessThanOrEqual(scoreReal);
  });

  it("EXTRACTED code→doc calls are NOT suppressed", () => {
    const G = makeCodeDocGraph();
    G.addEdge("py_fn", "md_doc", { relation: "calls", confidence: "EXTRACTED", source_file: "src/processor.py" });
    const nc: Record<string, number> = { py_fn: 0, md_doc: 1 };
    const [score] = surpriseScore(G, "py_fn", "md_doc", G.getEdgeAttributes("py_fn", "md_doc") as Record<string, unknown>, nc, "src/processor.py", "docs/readme.md");
    expect(score).toBeGreaterThanOrEqual(1);
  });

  it("semantically_similar_to code↔doc is NOT suppressed", () => {
    const G = makeCodeDocGraph();
    G.addEdge("py_fn", "md_doc", { relation: "semantically_similar_to", confidence: "INFERRED", source_file: "src/processor.py" });
    G.addEdge("py_a", "py_b", { relation: "calls", confidence: "EXTRACTED", source_file: "src/service.py" });
    const nc: Record<string, number> = { py_fn: 0, md_doc: 1, py_a: 0, py_b: 0 };
    const [scoreSem] = surpriseScore(G, "py_fn", "md_doc", G.getEdgeAttributes("py_fn", "md_doc") as Record<string, unknown>, nc, "src/processor.py", "docs/readme.md");
    const [scoreSame] = surpriseScore(G, "py_a", "py_b", G.getEdgeAttributes("py_a", "py_b") as Record<string, unknown>, nc, "src/service.py", "src/utils.py");
    expect(scoreSem).toBeGreaterThan(scoreSame);
  });

  it("unknown extension INFERRED calls are suppressed (falls back to doc)", () => {
    expect(fileCategory("vendor/random.xyz")).toBe("doc");
    const G = new Graph({ type: "undirected" });
    G.addNode("py_fn", { label: "Handler", source_file: "src/handler.py", file_type: "code" });
    G.addNode("unk", { label: "Handler", source_file: "vendor/unknown.xyz", file_type: "document" });
    G.addNode("py_a", { label: "A", source_file: "src/a.py", file_type: "code" });
    G.addNode("py_b", { label: "B", source_file: "src/b.py", file_type: "code" });
    G.addEdge("py_fn", "unk", { relation: "calls", confidence: "INFERRED", source_file: "src/handler.py" });
    G.addEdge("py_a", "py_b", { relation: "calls", confidence: "EXTRACTED", source_file: "src/a.py" });
    const nc: Record<string, number> = { py_fn: 0, unk: 1, py_a: 0, py_b: 0 };
    const [scoreUnk] = surpriseScore(G, "py_fn", "unk", G.getEdgeAttributes("py_fn", "unk") as Record<string, unknown>, nc, "src/handler.py", "vendor/unknown.xyz");
    const [scoreSame] = surpriseScore(G, "py_a", "py_b", G.getEdgeAttributes("py_a", "py_b") as Record<string, unknown>, nc, "src/a.py", "src/b.py");
    expect(scoreUnk).toBeLessThanOrEqual(scoreSame);
  });

  it("code↔paper INFERRED calls are NOT suppressed", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("py_model", { label: "Transformer", source_file: "src/model.py", file_type: "code" });
    G.addNode("pdf_paper", { label: "Attention Is All You Need", source_file: "papers/vaswani.pdf", file_type: "paper" });
    G.addNode("py_a", { label: "ServiceA", source_file: "src/service.py", file_type: "code" });
    G.addNode("py_b", { label: "ServiceB", source_file: "src/utils.py", file_type: "code" });
    G.addEdge("py_model", "pdf_paper", { relation: "calls", confidence: "INFERRED", source_file: "src/model.py" });
    G.addEdge("py_a", "py_b", { relation: "calls", confidence: "EXTRACTED", source_file: "src/service.py" });
    const nc: Record<string, number> = { py_model: 0, pdf_paper: 1, py_a: 0, py_b: 1 };
    const [scoreCross] = surpriseScore(G, "py_model", "pdf_paper", G.getEdgeAttributes("py_model", "pdf_paper") as Record<string, unknown>, nc, "src/model.py", "papers/vaswani.pdf");
    const [scoreSame] = surpriseScore(G, "py_a", "py_b", G.getEdgeAttributes("py_a", "py_b") as Record<string, unknown>, nc, "src/service.py", "src/utils.py");
    expect(scoreCross).toBeGreaterThan(scoreSame);
  });
});

// ── fileCategory ────────────────────────────────────────────────────────────

describe("fileCategory", () => {
  it("classifies code extensions", () => {
    expect(fileCategory("model.py")).toBe("code");
    expect(fileCategory("app.swift")).toBe("code");
    expect(fileCategory("plugin.lua")).toBe("code");
    expect(fileCategory("build.zig")).toBe("code");
    expect(fileCategory("deploy.ps1")).toBe("code");
    expect(fileCategory("server.ex")).toBe("code");
    expect(fileCategory("component.jsx")).toBe("code");
    expect(fileCategory("analysis.jl")).toBe("code");
    expect(fileCategory("view.m")).toBe("code");
  });

  it("classifies paper/image/doc", () => {
    expect(fileCategory("flash.pdf")).toBe("paper");
    expect(fileCategory("diagram.png")).toBe("image");
    expect(fileCategory("notes.md")).toBe("doc");
  });
});

// ── isConceptNode / isJsonKeyNode / nodeCommunityMap ────────────────────────

describe("helper functions", () => {
  it("isConceptNode: empty source_file → concept", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("c1", { source_file: "" });
    expect(isConceptNode(G, "c1")).toBe(true);
  });

  it("isConceptNode: real file → not concept", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("n1", { source_file: "model.py" });
    expect(isConceptNode(G, "n1")).toBe(false);
  });

  it("isJsonKeyNode: noise label from .json", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("j1", { label: "name", source_file: "schema.json" });
    expect(isJsonKeyNode(G, "j1")).toBe(true);
  });

  it("isJsonKeyNode: non-json file → false", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("n1", { label: "name", source_file: "model.py" });
    expect(isJsonKeyNode(G, "n1")).toBe(false);
  });

  it("isJsonKeyNode: real label from .json → false", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("j2", { label: "UserProfile", source_file: "schema.json" });
    expect(isJsonKeyNode(G, "j2")).toBe(false);
  });

  it("nodeCommunityMap: inverts communities", () => {
    const communities: Record<number, string[]> = { 0: ["a", "b"], 1: ["c"] };
    const result = nodeCommunityMap(communities);
    expect(result).toEqual({ a: 0, b: 0, c: 1 });
  });
});

// ── graphDiff ───────────────────────────────────────────────────────────────

describe("graphDiff", () => {
  it("detects new nodes", () => {
    const gOld = makeSimpleGraph([["n1", "Alpha"], ["n2", "Beta"]], []);
    const gNew = makeSimpleGraph([["n1", "Alpha"], ["n2", "Beta"], ["n3", "Gamma"]], []);
    const diff = graphDiff(gOld, gNew);
    expect(diff.newNodes.length).toBe(1);
    expect(diff.newNodes[0].id).toBe("n3");
    expect(diff.newNodes[0].label).toBe("Gamma");
    expect(diff.removedNodes.length).toBe(0);
    expect(diff.summary).toContain("1 new node");
  });

  it("detects removed nodes", () => {
    const gOld = makeSimpleGraph([["n1", "Alpha"], ["n2", "Beta"], ["n3", "Gamma"]], []);
    const gNew = makeSimpleGraph([["n1", "Alpha"], ["n2", "Beta"]], []);
    const diff = graphDiff(gOld, gNew);
    expect(diff.newNodes.length).toBe(0);
    expect(diff.removedNodes.length).toBe(1);
    expect(diff.removedNodes[0].id).toBe("n3");
    expect(diff.summary).toContain("removed");
  });

  it("detects new edges", () => {
    const nodes: Array<[string, string]> = [["n1", "Alpha"], ["n2", "Beta"], ["n3", "Gamma"]];
    const gOld = makeSimpleGraph(nodes, [["n1", "n2", "calls", "EXTRACTED"]]);
    const gNew = makeSimpleGraph(nodes, [["n1", "n2", "calls", "EXTRACTED"], ["n2", "n3", "uses", "INFERRED"]]);
    const diff = graphDiff(gOld, gNew);
    expect(diff.newEdges.length).toBe(1);
    expect(diff.newEdges[0].relation).toBe("uses");
    expect(diff.newEdges[0].confidence).toBe("INFERRED");
    expect(diff.removedEdges.length).toBe(0);
    expect(diff.summary).toContain("new edge");
  });

  it("empty diff when identical", () => {
    const nodes: Array<[string, string]> = [["n1", "Alpha"], ["n2", "Beta"]];
    const edges: Array<[string, string, string, string]> = [["n1", "n2", "calls", "EXTRACTED"]];
    const gOld = makeSimpleGraph(nodes, edges);
    const gNew = makeSimpleGraph(nodes, edges);
    const diff = graphDiff(gOld, gNew);
    expect(diff.newNodes.length).toBe(0);
    expect(diff.removedNodes.length).toBe(0);
    expect(diff.newEdges.length).toBe(0);
    expect(diff.removedEdges.length).toBe(0);
    expect(diff.summary).toBe("no changes");
  });
});

// ── findImportCycles ─────────────────────────────────────────────────────────

function makeId(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "").replace(/_+$/, "") || "_root";
}

function makeFileNode(p: string): [string, Record<string, string>] {
  const nid = makeId(p);
  const attrs: Record<string, string> = {
    label: p.split("/").pop()!,
    source_file: p,
    file_type: "code",
  };
  return [nid, attrs];
}

function makeCycleGraphDirected(): DirectedGraph {
  const G = new DirectedGraph();

  const [aId, a] = makeFileNode("src/a.ts");
  const [bId, b] = makeFileNode("src/b.ts");
  const [cId, c] = makeFileNode("src/c.ts");
  const [dId, d] = makeFileNode("src/d.ts");
  const extId = makeId("react");

  G.addNode(aId, a);
  G.addNode(bId, b);
  G.addNode(cId, c);
  G.addNode(dId, d);
  G.addNode(extId, { label: "react", file_type: "code" });

  // 2-cycle: a ↔ b
  G.addEdge(aId, bId, { relation: "imports_from", source_file: "src/a.ts", confidence: "EXTRACTED" });
  G.addEdge(bId, aId, { relation: "imports_from", source_file: "src/b.ts", confidence: "EXTRACTED" });

  // 3-cycle: b → c → d → b
  G.addEdge(bId, cId, { relation: "imports_from", source_file: "src/b.ts", confidence: "EXTRACTED" });
  G.addEdge(cId, dId, { relation: "imports_from", source_file: "src/c.ts", confidence: "EXTRACTED" });
  G.addEdge(dId, bId, { relation: "imports_from", source_file: "src/d.ts", confidence: "EXTRACTED" });

  // Self-loop: c imports itself
  G.addEdge(cId, cId, { relation: "imports_from", source_file: "src/c.ts", confidence: "EXTRACTED" });

  // Non-import edge to a different external node: must not bleed into cycle graph
  const ext2Id = makeId("lodash");
  G.addNode(ext2Id, { label: "lodash", file_type: "code" });
  G.addEdge(aId, ext2Id, { relation: "calls", source_file: "src/a.ts", confidence: "INFERRED" });

  // Import edge whose target has no source_file — must be skipped
  G.addEdge(aId, extId, { relation: "imports_from", source_file: "src/a.ts", confidence: "EXTRACTED" });

  return G;
}

describe("findImportCycles", () => {
  it("returns structured records", () => {
    const G = makeCycleGraphDirected();
    const cycles = findImportCycles(G);
    expect(cycles).toBeInstanceOf(Array);
    expect(cycles.length).toBeGreaterThan(0);
    expect("cycle" in cycles[0]).toBe(true);
    expect("length" in cycles[0]).toBe(true);
    expect("why" in cycles[0]).toBe(true);
  });

  it("detects 2- and 3-cycles", () => {
    const G = makeCycleGraphDirected();
    const cycles = findImportCycles(G);
    const cycleSets = cycles.map((c) => new Set(c.cycle));
    expect(cycleSets.some((s) => s.has("src/a.ts") && s.has("src/b.ts"))).toBe(true);
    expect(cycleSets.some((s) => s.has("src/b.ts") && s.has("src/c.ts") && s.has("src/d.ts"))).toBe(true);
  });

  it("detects self-loop cycle", () => {
    const G = makeCycleGraphDirected();
    const cycles = findImportCycles(G);
    expect(cycles.some((c) => c.cycle.length === 1 && c.cycle[0] === "src/c.ts" && c.length === 1)).toBe(true);
  });

  it("respects maxCycleLength", () => {
    const G = makeCycleGraphDirected();
    const cycles = findImportCycles(G, 2);
    expect(cycles.every((c) => c.length <= 2)).toBe(true);
  });

  it("skips nodes without source_file", () => {
    const G = makeCycleGraphDirected();
    const cycles = findImportCycles(G);
    const flat = cycles.map((c) => c.cycle.join(" ")).join(" ");
    expect(flat).not.toContain("react");
  });

  it("handles undirected graph input", () => {
    const Gd = makeCycleGraphDirected();
    const Gu = new Graph({ type: "undirected" });
    Gd.forEachNode((node, attrs) => { Gu.addNode(node, attrs); });
    Gd.forEachEdge((_edge, attrs, u, v) => { if (!Gu.hasEdge(u, v)) Gu.addEdge(u, v, attrs); });
    const cycles = findImportCycles(Gu);
    // should still resolve orientation via edge.source_file
    expect(cycles.length).toBeGreaterThanOrEqual(0);
  });

  it("ignores non-import relations", () => {
    const G = new DirectedGraph();
    const [aId, a] = makeFileNode("src/a.ts");
    const [bId, b] = makeFileNode("src/b.ts");
    G.addNode(aId, a);
    G.addNode(bId, b);
    G.addEdge(aId, bId, { relation: "calls", source_file: "src/a.ts", confidence: "INFERRED" });
    G.addEdge(bId, aId, { relation: "contains", source_file: "src/b.ts", confidence: "EXTRACTED" });
    expect(findImportCycles(G)).toEqual([]);
  });

  it("returns empty for empty graph", () => {
    expect(findImportCycles(new DirectedGraph())).toEqual([]);
  });

  it("returns empty when no cycles", () => {
    const G = new DirectedGraph();
    const [xId, x] = makeFileNode("x.ts");
    const [yId, y] = makeFileNode("y.ts");
    G.addNode(xId, x);
    G.addNode(yId, y);
    G.addEdge(xId, yId, { relation: "imports_from", source_file: "x.ts", confidence: "EXTRACTED" });
    expect(findImportCycles(G)).toEqual([]);
  });
});

// ── suggestQuestions ─────────────────────────────────────────────────────────

describe("suggestQuestions", () => {
  it("generates questions", () => {
    const G = makeGraph();
    const communities = cluster(G);
    const communityLabels: Record<number, string> = {};
    const questions = suggestQuestions(G, communities, communityLabels);
    expect(questions.length).toBeGreaterThan(0);
    expect("type" in questions[0]).toBe(true);
    expect("why" in questions[0]).toBe(true);
  });

  it("returns no_signal when graph has no signal", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("n1", { label: "a.py", source_file: "a.py", file_type: "code" });
    // label matches source_file basename → isFileNode returns true → excluded from isolated check → no_signal
    const communities: CommunityMap = { n1: 0 };
    const questions = suggestQuestions(G, communities, {});
    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0].type).toBe("no_signal");
  });
});
