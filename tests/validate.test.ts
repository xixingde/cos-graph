import { describe, it, expect } from "vitest";
import {
  validateExtraction,
  assertValid,
  VALID_FILE_TYPES,
  VALID_CONFIDENCES,
  REQUIRED_NODE_FIELDS,
  REQUIRED_EDGE_FIELDS,
} from "../src/validate.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("validate constants", () => {
  it("VALID_FILE_TYPES contains expected values", () => {
    expect(VALID_FILE_TYPES).toBeInstanceOf(Set);
    expect(VALID_FILE_TYPES.has("code")).toBe(true);
    expect(VALID_FILE_TYPES.has("document")).toBe(true);
    expect(VALID_FILE_TYPES.has("paper")).toBe(true);
    expect(VALID_FILE_TYPES.has("image")).toBe(true);
    expect(VALID_FILE_TYPES.has("rationale")).toBe(true);
    expect(VALID_FILE_TYPES.has("concept")).toBe(true);
    expect(VALID_FILE_TYPES.size).toBe(6);
  });

  it("VALID_CONFIDENCES contains expected values", () => {
    expect(VALID_CONFIDENCES).toBeInstanceOf(Set);
    expect(VALID_CONFIDENCES.has("EXTRACTED")).toBe(true);
    expect(VALID_CONFIDENCES.has("INFERRED")).toBe(true);
    expect(VALID_CONFIDENCES.has("AMBIGUOUS")).toBe(true);
    expect(VALID_CONFIDENCES.size).toBe(3);
  });

  it("REQUIRED_NODE_FIELDS has correct fields", () => {
    expect(REQUIRED_NODE_FIELDS).toEqual([
      "id",
      "label",
      "file_type",
      "source_file",
    ]);
  });

  it("REQUIRED_EDGE_FIELDS has correct fields", () => {
    expect(REQUIRED_EDGE_FIELDS).toEqual([
      "source",
      "target",
      "relation",
      "confidence",
      "source_file",
    ]);
  });
});

// ---------------------------------------------------------------------------
// validateExtraction
// ---------------------------------------------------------------------------
describe("validateExtraction", () => {
  // --- Non-object input ---
  it("returns error for non-object input", () => {
    expect(validateExtraction(null as unknown as Record<string, unknown>)).toEqual([
      "Extraction must be a JSON object",
    ]);
  });

  it("returns error for array input", () => {
    expect(validateExtraction([] as unknown as Record<string, unknown>)).toEqual([
      "Extraction must be a JSON object",
    ]);
  });

  // --- Missing nodes ---
  it("returns error when nodes key is missing", () => {
    const data = { edges: [] };
    const errors = validateExtraction(data);
    expect(errors).toContain("Missing required key 'nodes'");
  });

  it("returns error when nodes is not a list", () => {
    const data = { nodes: "not-a-list", edges: [] };
    const errors = validateExtraction(data);
    expect(errors).toContain("'nodes' must be a list");
  });

  // --- Node validation ---
  it("returns errors for nodes missing required fields (snake_case)", () => {
    const data = {
      nodes: [{ id: "a" }],
      edges: [],
    };
    const errors = validateExtraction(data);
    expect(errors.some((e) => e.includes("missing required field 'label'"))).toBe(true);
    expect(errors.some((e) => e.includes("missing required field 'file_type'"))).toBe(true);
    expect(errors.some((e) => e.includes("missing required field 'source_file'"))).toBe(true);
  });

  it("accepts nodes with camelCase alternatives for file_type and source_file", () => {
    const data = {
      nodes: [
        { id: "a", label: "A", fileType: "code", sourceFile: "a.ts" },
      ],
      edges: [
        {
          source: "a",
          target: "a",
          relation: "calls",
          confidence: "EXTRACTED",
          sourceFile: "a.ts",
        },
      ],
    };
    const errors = validateExtraction(data);
    expect(errors).toEqual([]);
  });

  it("returns error for node with invalid file_type", () => {
    const data = {
      nodes: [
        { id: "a", label: "A", file_type: "invalid", source_file: "a.ts" },
      ],
      edges: [],
    };
    const errors = validateExtraction(data);
    expect(errors.some((e) => e.includes("invalid file_type"))).toBe(true);
  });

  it("returns error for non-object node", () => {
    const data = { nodes: ["not-an-object"], edges: [] };
    const errors = validateExtraction(data);
    expect(errors.some((e) => e.includes("Node 0 must be an object"))).toBe(true);
  });

  // --- Missing edges ---
  it("returns error when edges and links keys are both missing", () => {
    const data = { nodes: [] };
    const errors = validateExtraction(data);
    expect(errors).toContain("Missing required key 'edges'");
  });

  it("returns error when edges is not a list", () => {
    const data = { nodes: [], edges: "not-a-list" };
    const errors = validateExtraction(data);
    expect(errors).toContain("'edges' must be a list");
  });

  // --- Edges with "links" fallback (NetworkX <= 3.1) ---
  it("accepts 'links' as fallback for 'edges'", () => {
    const data = {
      nodes: [
        { id: "a", label: "A", file_type: "code", source_file: "a.ts" },
      ],
      links: [
        {
          source: "a",
          target: "a",
          relation: "calls",
          confidence: "EXTRACTED",
          source_file: "a.ts",
        },
      ],
    };
    const errors = validateExtraction(data);
    expect(errors).toEqual([]);
  });

  // --- Edge validation ---
  it("returns errors for edges missing required fields", () => {
    const data = { nodes: [], edges: [{ source: "a" }] };
    const errors = validateExtraction(data);
    expect(errors.some((e) => e.includes("Edge 0 missing required field 'target'"))).toBe(true);
    expect(errors.some((e) => e.includes("Edge 0 missing required field 'relation'"))).toBe(true);
    expect(errors.some((e) => e.includes("Edge 0 missing required field 'confidence'"))).toBe(true);
    expect(errors.some((e) => e.includes("Edge 0 missing required field 'source_file'"))).toBe(true);
  });

  it("accepts edges with camelCase sourceFile", () => {
    const data = {
      nodes: [
        { id: "a", label: "A", file_type: "code", source_file: "a.ts" },
      ],
      edges: [
        {
          source: "a",
          target: "a",
          relation: "calls",
          confidence: "EXTRACTED",
          sourceFile: "a.ts",
        },
      ],
    };
    const errors = validateExtraction(data);
    expect(errors).toEqual([]);
  });

  it("returns error for invalid confidence", () => {
    const data = {
      nodes: [],
      edges: [
        {
          source: "a",
          target: "b",
          relation: "calls",
          confidence: "INVALID",
          source_file: "a.ts",
        },
      ],
    };
    const errors = validateExtraction(data);
    expect(errors.some((e) => e.includes("invalid confidence"))).toBe(true);
  });

  it("returns error for non-object edge", () => {
    const data = { nodes: [], edges: ["not-an-object"] };
    const errors = validateExtraction(data);
    expect(errors.some((e) => e.includes("Edge 0 must be an object"))).toBe(true);
  });

  // --- Referential integrity ---
  it("returns error when edge source does not match any node id", () => {
    const data = {
      nodes: [
        { id: "a", label: "A", file_type: "code", source_file: "a.ts" },
      ],
      edges: [
        {
          source: "missing",
          target: "a",
          relation: "calls",
          confidence: "EXTRACTED",
          source_file: "a.ts",
        },
      ],
    };
    const errors = validateExtraction(data);
    expect(errors.some((e) => e.includes("source 'missing' does not match any node id"))).toBe(true);
  });

  it("returns error when edge target does not match any node id", () => {
    const data = {
      nodes: [
        { id: "a", label: "A", file_type: "code", source_file: "a.ts" },
      ],
      edges: [
        {
          source: "a",
          target: "missing",
          relation: "calls",
          confidence: "EXTRACTED",
          source_file: "a.ts",
        },
      ],
    };
    const errors = validateExtraction(data);
    expect(errors.some((e) => e.includes("target 'missing' does not match any node id"))).toBe(true);
  });

  // --- Fully valid extraction ---
  it("returns empty list for valid extraction (snake_case)", () => {
    const data = {
      nodes: [
        { id: "a", label: "A", file_type: "code", source_file: "a.ts" },
        { id: "b", label: "B", file_type: "document", source_file: "b.md" },
      ],
      edges: [
        {
          source: "a",
          target: "b",
          relation: "imports",
          confidence: "EXTRACTED",
          source_file: "a.ts",
        },
      ],
    };
    expect(validateExtraction(data)).toEqual([]);
  });

  it("returns empty list for valid extraction (camelCase)", () => {
    const data = {
      nodes: [
        { id: "a", label: "A", fileType: "code", sourceFile: "a.ts" },
      ],
      edges: [
        {
          source: "a",
          target: "a",
          relation: "calls",
          confidence: "INFERRED",
          sourceFile: "a.ts",
        },
      ],
    };
    expect(validateExtraction(data)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assertValid
// ---------------------------------------------------------------------------
describe("assertValid", () => {
  it("does not throw for valid data", () => {
    const data = {
      nodes: [
        { id: "a", label: "A", file_type: "code", source_file: "a.ts" },
      ],
      edges: [
        {
          source: "a",
          target: "a",
          relation: "calls",
          confidence: "EXTRACTED",
          source_file: "a.ts",
        },
      ],
    };
    expect(() => assertValid(data)).not.toThrow();
  });

  it("throws Error for invalid data with formatted message", () => {
    const data = { nodes: "not-a-list" };
    expect(() => assertValid(data)).toThrow(Error);
    try {
      assertValid(data);
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("Extraction JSON has");
      expect(msg).toContain("error(s)");
      expect(msg).toContain("•");
    }
  });

  it("throws for null input", () => {
    expect(() =>
      assertValid(null as unknown as Record<string, unknown>),
    ).toThrow(Error);
  });
});
