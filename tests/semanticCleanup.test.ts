/** Tests for src/semanticCleanup.ts. Ported from graphify/semantic_cleanup.py. */
import { describe, it, expect } from "vitest";
import {
  validateSemanticFragment,
  sanitizeSemanticFragment,
  isSentenceLikeRationaleLabel,
  MAX_SEMANTIC_FRAGMENT_BYTES,
  MAX_SEMANTIC_FRAGMENT_NODES,
  MAX_SEMANTIC_FRAGMENT_EDGES,
  MAX_SEMANTIC_FRAGMENT_HYPEREDGES,
  MAX_SEMANTIC_HYPEREDGE_NODES,
  MAX_SEMANTIC_ID_LENGTH,
  VALID_SEMANTIC_FILE_TYPES,
} from "../src/semanticCleanup.js";

// ── Constants ─────────────────────────────────────────────────────────────

describe("constants", () => {
  it("exports correct byte limit", () => {
    expect(MAX_SEMANTIC_FRAGMENT_BYTES).toBe(25 * 1024 * 1024);
  });
  it("exports correct node limit", () => {
    expect(MAX_SEMANTIC_FRAGMENT_NODES).toBe(10_000);
  });
  it("exports correct edge limit", () => {
    expect(MAX_SEMANTIC_FRAGMENT_EDGES).toBe(100_000);
  });
  it("exports correct hyperedge limit", () => {
    expect(MAX_SEMANTIC_FRAGMENT_HYPEREDGES).toBe(10_000);
  });
  it("exports correct hyperedge node limit", () => {
    expect(MAX_SEMANTIC_HYPEREDGE_NODES).toBe(256);
  });
  it("exports correct id length limit", () => {
    expect(MAX_SEMANTIC_ID_LENGTH).toBe(256);
  });
  it("exports valid file types set", () => {
    expect(VALID_SEMANTIC_FILE_TYPES).toBeInstanceOf(Set);
    expect(VALID_SEMANTIC_FILE_TYPES.has("code")).toBe(true);
    expect(VALID_SEMANTIC_FILE_TYPES.has("rationale")).toBe(true);
    expect(VALID_SEMANTIC_FILE_TYPES.has("concept")).toBe(true);
    expect(VALID_SEMANTIC_FILE_TYPES.has("invalid")).toBe(false);
  });
});

// ── validateSemanticFragment ───────────────────────────────────────────────

describe("validateSemanticFragment", () => {
  it("rejects non-object input", () => {
    expect(validateSemanticFragment("string")).toEqual(["fragment must be a JSON object"]);
    expect(validateSemanticFragment(42)).toEqual(["fragment must be a JSON object"]);
    expect(validateSemanticFragment(null)).toEqual(["fragment must be a JSON object"]);
    expect(validateSemanticFragment([1, 2])).toEqual(["fragment must be a JSON object"]);
  });

  it("accepts a valid minimal fragment", () => {
    const errors = validateSemanticFragment({ nodes: [], edges: [] });
    expect(errors).toEqual([]);
  });

  it("rejects oversize payload", () => {
    // Create a fragment with a huge string field
    const big = "x".repeat(MAX_SEMANTIC_FRAGMENT_BYTES + 1);
    const errors = validateSemanticFragment({ nodes: [], edges: [], data: big });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("payload is");
    expect(errors[0]).toContain("bytes; max is");
  });

  it("rejects non-list nodes", () => {
    const errors = validateSemanticFragment({ nodes: "not-a-list", edges: [] });
    expect(errors).toContain("nodes must be a list");
  });

  it("rejects too many nodes", () => {
    const nodes = Array.from({ length: MAX_SEMANTIC_FRAGMENT_NODES + 1 }, (_, i) => ({
      id: `n${i}`, label: `node ${i}`, file_type: "code",
    }));
    const errors = validateSemanticFragment({ nodes, edges: [] });
    expect(errors.some((e) => e.includes("nodes has") && e.includes("entries; max is"))).toBe(true);
  });

  it("rejects too many edges", () => {
    const edges = Array.from({ length: MAX_SEMANTIC_FRAGMENT_EDGES + 1 }, (_, i) => ({
      source: `s${i}`, target: `t${i}`, relation: "calls",
    }));
    const errors = validateSemanticFragment({ nodes: [], edges });
    expect(errors.some((e) => e.includes("edges has") && e.includes("entries; max is"))).toBe(true);
  });

  it("validates node ids", () => {
    const errors = validateSemanticFragment({
      nodes: [{ id: "" }, { id: 123 }],
      edges: [],
    });
    expect(errors.some((e) => e.includes("must not be empty"))).toBe(true);
    expect(errors.some((e) => e.includes("must be a string"))).toBe(true);
  });

  it("rejects node ids with path separators", () => {
    const errors = validateSemanticFragment({
      nodes: [{ id: "a/b" }, { id: "a\\b" }, { id: "a..b" }],
      edges: [],
    });
    expect(errors.some((e) => e.includes("path separators or '..'"))).toBe(true);
  });

  it("rejects invalid node file_type", () => {
    const errors = validateSemanticFragment({
      nodes: [{ id: "n1", file_type: "invalid_type" }],
      edges: [],
    });
    expect(errors.some((e) => e.includes("file_type") && e.includes("invalid_type"))).toBe(true);
  });

  it("validates edge source/target", () => {
    const errors = validateSemanticFragment({
      nodes: [],
      edges: [{ source: 42, target: "t1" }, { source: "s1", target: null }],
    });
    expect(errors.some((e) => e.includes("edges[0].source must be a string"))).toBe(true);
    expect(errors.some((e) => e.includes("edges[1].target must be a string"))).toBe(true);
  });

  it("validates hyperedges", () => {
    const errors = validateSemanticFragment({
      nodes: [],
      edges: [],
      hyperedges: [{ id: "he1", nodes: "not-a-list" }],
    });
    expect(errors.some((e) => e.includes("hyperedges[0].nodes must be a list"))).toBe(true);
  });

  it("rejects too many hyperedge nodes", () => {
    const heNodes = Array.from({ length: MAX_SEMANTIC_HYPEREDGE_NODES + 1 }, (_, i) => `ref${i}`);
    const errors = validateSemanticFragment({
      nodes: [],
      edges: [],
      hyperedges: [{ id: "he1", nodes: heNodes }],
    });
    expect(errors.some((e) => e.includes("hyperedges[0].nodes has") && e.includes("entries; max is"))).toBe(true);
  });

  it("treats null hyperedges as empty list", () => {
    const errors = validateSemanticFragment({
      nodes: [],
      edges: [],
      hyperedges: null,
    });
    expect(errors).toEqual([]);
  });
});

// ── isSentenceLikeRationaleLabel ───────────────────────────────────────────

describe("isSentenceLikeRationaleLabel", () => {
  it("returns false for empty string", () => {
    expect(isSentenceLikeRationaleLabel("")).toBe(false);
  });

  it("returns false for short entity names", () => {
    expect(isSentenceLikeRationaleLabel("UserService")).toBe(false);
    expect(isSentenceLikeRationaleLabel("config")).toBe(false);
  });

  it("returns false for long text without sentence punctuation", () => {
    const label = "a".repeat(100);
    expect(isSentenceLikeRationaleLabel(label)).toBe(false);
  });

  it("returns true for long text with period", () => {
    const label = "This is a rationale that explains why we chose this architecture. " +
      "It spans multiple sentences and provides detailed reasoning for the decision.";
    expect(isSentenceLikeRationaleLabel(label)).toBe(true);
  });

  it("returns true for text with many words and colon", () => {
    const label = "Decision: we should use the repository pattern because it separates " +
      "domain logic from data access and makes testing easier";
    expect(isSentenceLikeRationaleLabel(label)).toBe(true);
  });

  it("returns false for text below both thresholds without punctuation", () => {
    expect(isSentenceLikeRationaleLabel("short label")).toBe(false);
  });
});

// ── sanitizeSemanticFragment ──────────────────────────────────────────────

describe("sanitizeSemanticFragment", () => {
  it("removes rationale and concept nodes", () => {
    const fragment = {
      nodes: [
        { id: "n1", label: "CodeNode", file_type: "code" },
        { id: "n2", label: "RationaleNode", file_type: "rationale" },
        { id: "n3", label: "ConceptNode", file_type: "concept" },
      ],
      edges: [],
      hyperedges: [],
    };
    const result = sanitizeSemanticFragment(fragment);
    expect(result.nodes).toEqual([{ id: "n1", label: "CodeNode", file_type: "code" }]);
  });

  it("converts sentence-like rationale nodes to attributes", () => {
    const fragment = {
      nodes: [
        { id: "n1", label: "CodeNode", file_type: "code" },
        {
          id: "n2",
          label: "This is a long rationale explaining why we chose this approach. It provides detailed reasoning for the decision.",
          file_type: "rationale",
        },
      ],
      edges: [
        { source: "n2", target: "n1", relation: "rationale_for" },
      ],
      hyperedges: [],
    };
    const result = sanitizeSemanticFragment(fragment);
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].id).toBe("n1");
    expect(result.nodes[0].rationale).toBeTruthy();
    expect(result.edges).toEqual([]);
  });

  it("preserves rationale text when appending to existing attribute", () => {
    const fragment = {
      nodes: [
        { id: "n1", label: "CodeNode", file_type: "code", rationale: "Existing rationale." },
        {
          id: "n2",
          label: "This is another rationale that explains a different aspect. It is also quite long and detailed.",
          file_type: "rationale",
        },
      ],
      edges: [
        { source: "n2", target: "n1", relation: "rationale_for" },
      ],
      hyperedges: [],
    };
    const result = sanitizeSemanticFragment(fragment);
    expect(result.nodes[0].rationale).toContain("Existing rationale.");
    expect(result.nodes[0].rationale).toContain("another rationale");
  });

  it("removes nodes without id", () => {
    const fragment = {
      nodes: [
        { id: "", label: "EmptyId" },
        { id: "n1", label: "ValidNode", file_type: "code" },
      ],
      edges: [],
      hyperedges: [],
    };
    const result = sanitizeSemanticFragment(fragment);
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].id).toBe("n1");
  });

  it("strips edges referencing removed nodes", () => {
    const fragment = {
      nodes: [
        { id: "n1", label: "Node1", file_type: "code" },
        { id: "n2", label: "RationaleNode", file_type: "rationale" },
      ],
      edges: [
        { source: "n2", target: "n1", relation: "calls" },
        { source: "n1", target: "n2", relation: "references" },
      ],
      hyperedges: [],
    };
    const result = sanitizeSemanticFragment(fragment);
    expect(result.edges).toEqual([]);
  });

  it("filters hyperedges to surviving node IDs", () => {
    const fragment = {
      nodes: [
        { id: "n1", label: "Node1", file_type: "code" },
        { id: "n2", label: "Node2", file_type: "code" },
        { id: "n3", label: "RationaleNode", file_type: "rationale" },
      ],
      edges: [],
      hyperedges: [
        { id: "he1", nodes: ["n1", "n2", "n3"] },
        { id: "he2", nodes: ["n1", "n3"] },
        { id: "he3", nodes: ["n1", "n2"] },
      ],
    };
    const result = sanitizeSemanticFragment(fragment);
    expect(result.hyperedges.length).toBe(2);
    // he1: n1+n2 survive (n3 removed) → 2 members → kept, filtered
    expect(result.hyperedges.some((he: any) => he.id === "he1" && he.nodes.length === 2)).toBe(true);
    // he2: only n1 survives (n3 removed) → 1 member → dropped
    expect(result.hyperedges.some((he: any) => he.id === "he2")).toBe(false);
    // he3: n1+n2 both survive → kept
    expect(result.hyperedges.some((he: any) => he.id === "he3")).toBe(true);
  });

  it("handles sentence-like nodes with rationale_for even when file_type is allowed", () => {
    const fragment = {
      nodes: [
        { id: "n1", label: "CodeNode", file_type: "code" },
        {
          id: "n2",
          label: "This is a rationale that was accidentally marked as code. It explains why we did something.",
          file_type: "document",
        },
      ],
      edges: [
        { source: "n2", target: "n1", relation: "rationale_for" },
      ],
      hyperedges: [],
    };
    const result = sanitizeSemanticFragment(fragment);
    // n2 sources a rationale_for edge and has a sentence-like label → converted
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].id).toBe("n1");
    expect(result.nodes[0].rationale).toBeTruthy();
  });
});
