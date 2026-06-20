/** Tests for src/affected.ts.
 *  Ported from tests/test_affected_cli.py.
 */
import { describe, it, expect } from "vitest";
import { DirectedGraph } from "graphology";

import {
  DEFAULT_AFFECTED_RELATIONS,
  resolveSeed,
  affectedNodes,
  formatAffected,
} from "../src/affected.js";

function makeTestGraph(): DirectedGraph {
  const g = new DirectedGraph();
  g.addNode("target", { label: "Foo", source_file: "pkg/foo.py", source_location: "L1" });
  g.addNode("caller", { label: "X()", source_file: "app.py", source_location: "L4" });
  g.addNode("barrel", { label: "__init__.py", source_file: "pkg/__init__.py", source_location: null });
  g.addNode("consumer", { label: "app.py", source_file: "app.py", source_location: null });
  g.addEdge("caller", "target", { relation: "calls", context: "call", confidence: "EXTRACTED" });
  g.addEdge("barrel", "target", { relation: "re_exports", context: "export", confidence: "EXTRACTED" });
  g.addEdge("consumer", "target", { relation: "imports", context: "import", confidence: "EXTRACTED" });
  return g;
}

// ── DEFAULT_AFFECTED_RELATIONS ────────────────────────────────────────────

describe("DEFAULT_AFFECTED_RELATIONS", () => {
  it("contains expected relation types", () => {
    expect(DEFAULT_AFFECTED_RELATIONS).toContain("calls");
    expect(DEFAULT_AFFECTED_RELATIONS).toContain("references");
    expect(DEFAULT_AFFECTED_RELATIONS).toContain("imports");
    expect(DEFAULT_AFFECTED_RELATIONS).toContain("re_exports");
    expect(DEFAULT_AFFECTED_RELATIONS).toContain("extends");
    expect(DEFAULT_AFFECTED_RELATIONS).toContain("implements");
  });
});

// ── resolveSeed ───────────────────────────────────────────────────────────

describe("resolveSeed", () => {
  it("matches exact node ID", () => {
    const g = makeTestGraph();
    expect(resolveSeed(g, "target")).toBe("target");
  });

  it("matches exact label (unique)", () => {
    const g = makeTestGraph();
    expect(resolveSeed(g, "Foo")).toBe("target");
  });

  it("returns null for ambiguous label", () => {
    const g = new DirectedGraph();
    g.addNode("a", { label: "Dup", source_file: "one.py" });
    g.addNode("b", { label: "Dup", source_file: "two.py" });
    expect(resolveSeed(g, "Dup")).toBeNull();
  });

  it("matches bare name against callable label", () => {
    const g = new DirectedGraph();
    g.addNode("a", { label: "classifyProperty()", source_file: "pkg/entity.py" });
    g.addNode("b", { label: "classifyPropertySafe()", source_file: "app/context.py" });
    expect(resolveSeed(g, "classifyProperty")).toBe("a");
    expect(resolveSeed(g, "classifyPropertySafe")).toBe("b");
  });

  it("matches decorated query against bare label", () => {
    const g = new DirectedGraph();
    g.addNode("a", { label: "Foo", source_file: "pkg/foo.py" });
    g.addNode("b", { label: "FooBar", source_file: "pkg/foobar.py" });
    expect(resolveSeed(g, "Foo()")).toBe("a");
  });

  it("matches unicode normalized label", () => {
    const g = new DirectedGraph();
    g.addNode("a", { label: "Auditoría", source_file: "pkg/auditoria.py" });
    // NFD form of "Auditoría" decomposes the í into i + combining accent
    const nfdQuery = "Audi\u0074\u006F\u0072\u0069\u0301\u0061";
    expect(resolveSeed(g, nfdQuery)).toBe("a");
  });

  it("preserves distinct accents (resume vs résumé)", () => {
    const g = new DirectedGraph();
    g.addNode("a", { label: "resume", source_file: "pkg/resume.py" });
    g.addNode("b", { label: "résumé", source_file: "pkg/resume_accented.py" });
    expect(resolveSeed(g, "resume")).toBe("a");
  });

  it("returns null when bare name ties", () => {
    const g = new DirectedGraph();
    g.addNode("a", { label: "dup()", source_file: "pkg/one.py" });
    g.addNode("b", { label: "dup()", source_file: "pkg/two.py" });
    expect(resolveSeed(g, "dup")).toBeNull();
  });

  it("matches source_file", () => {
    const g = makeTestGraph();
    // "app.py" is a label on the "consumer" node — unique label match
    expect(resolveSeed(g, "app.py")).toBe("consumer");
  });

  it("matches contains (label contains query)", () => {
    const g = new DirectedGraph();
    g.addNode("a", { label: "MyLongClassName", source_file: "pkg/a.py" });
    expect(resolveSeed(g, "LongClass")).toBe("a");
  });

  it("returns null when no match", () => {
    const g = makeTestGraph();
    expect(resolveSeed(g, "NonExistent")).toBeNull();
  });
});

// ── affectedNodes ─────────────────────────────────────────────────────────

describe("affectedNodes", () => {
  it("reverse-traverses impact edges (BFS)", () => {
    const g = makeTestGraph();
    const hits = affectedNodes(g, "target");
    expect(hits.length).toBe(3);

    const nodeIds = hits.map((h) => h.nodeId);
    expect(nodeIds).toContain("caller");
    expect(nodeIds).toContain("barrel");
    expect(nodeIds).toContain("consumer");

    const callerHit = hits.find((h) => h.nodeId === "caller")!;
    expect(callerHit.viaRelation).toBe("calls");
    expect(callerHit.depth).toBe(1);

    const barrelHit = hits.find((h) => h.nodeId === "barrel")!;
    expect(barrelHit.viaRelation).toBe("re_exports");

    const consumerHit = hits.find((h) => h.nodeId === "consumer")!;
    expect(consumerHit.viaRelation).toBe("imports");
  });

  it("filters by relation", () => {
    const g = makeTestGraph();
    const hits = affectedNodes(g, "target", { relations: ["calls"] });
    expect(hits.length).toBe(1);
    expect(hits[0].nodeId).toBe("caller");
    expect(hits[0].viaRelation).toBe("calls");
  });

  it("respects depth limit", () => {
    const g = new DirectedGraph();
    g.addNode("a", { label: "A", source_file: "a.py" });
    g.addNode("b", { label: "B", source_file: "b.py" });
    g.addNode("c", { label: "C", source_file: "c.py" });
    g.addEdge("a", "b", { relation: "calls" });
    g.addEdge("b", "c", { relation: "calls" });

    // depth=1: from "c", only "b" is reachable (1 hop)
    const hits1 = affectedNodes(g, "c", { depth: 1 });
    expect(hits1.length).toBe(1);
    expect(hits1[0].nodeId).toBe("b");

    // depth=2: from "c", "b" (depth 1) and "a" (depth 2) are reachable
    const hits2 = affectedNodes(g, "c", { depth: 2 });
    expect(hits2.length).toBe(2);
    const aHit = hits2.find((h) => h.nodeId === "a")!;
    expect(aHit.depth).toBe(2);
  });

  it("returns empty for seed with no incoming edges", () => {
    const g = new DirectedGraph();
    g.addNode("a", { label: "A", source_file: "a.py" });
    const hits = affectedNodes(g, "a");
    expect(hits).toEqual([]);
  });

  it("directed graph: caller affected by change to callee", () => {
    const g = new DirectedGraph();
    g.addNode("A", { label: "caller_fn", source_file: "a.py", source_location: "L1" });
    g.addNode("B", { label: "callee_fn", source_file: "b.py", source_location: "L2" });
    g.addEdge("A", "B", { relation: "calls", context: "call", confidence: "EXTRACTED" });

    const hits = affectedNodes(g, "B", { relations: ["calls"] });
    expect(hits.length).toBe(1);
    expect(hits[0].nodeId).toBe("A");
    expect(hits[0].viaRelation).toBe("calls");
  });
});

// ── formatAffected ────────────────────────────────────────────────────────

describe("formatAffected", () => {
  it("formats full output with all affected nodes", () => {
    const g = makeTestGraph();
    const out = formatAffected(g, "Foo");
    expect(out).toContain("Affected nodes for Foo");
    expect(out).toContain("X()");
    expect(out).toContain("calls");
    expect(out).toContain("__init__.py");
    expect(out).toContain("re_exports");
    expect(out).toContain("app.py");
    expect(out).toContain("imports");
  });

  it("formats output with relation filter", () => {
    const g = makeTestGraph();
    const out = formatAffected(g, "Foo", { relations: ["calls"] });
    expect(out).toContain("Relations: calls");
    expect(out).toContain("X()");
    expect(out).not.toContain("__init__.py");
  });

  it("returns not-found message for unknown query", () => {
    const g = makeTestGraph();
    const out = formatAffected(g, "NonExistent");
    expect(out).toBe("No unique node match for NonExistent");
  });

  it("shows no affected nodes message when seed has no incoming", () => {
    const g = new DirectedGraph();
    g.addNode("a", { label: "Lonely", source_file: "a.py" });
    const out = formatAffected(g, "Lonely");
    expect(out).toContain("No affected nodes found.");
  });
});
