import { describe, it, expect } from "vitest";

import {
  ingestScipJson,
  _isTrue,
  _firstOccurrenceLine,
  _makeScipNodeId,
} from "../src/scipIngest.js";

describe("scipIngest", () => {
  describe("_isTrue", () => {
    it("returns true only for boolean true", () => {
      expect(_isTrue(true)).toBe(true);
      expect(_isTrue(false)).toBe(false);
      expect(_isTrue(1 as any)).toBe(false);
      expect(_isTrue("true" as any)).toBe(false);
    });
  });

  describe("_firstOccurrenceLine", () => {
    it("returns line number from first occurrence with range format", () => {
      expect(_firstOccurrenceLine([{ range: [10, 0, 5] }, { range: [20, 0, 5] }])).toBe(10);
    });

    it("returns 0 for empty array", () => {
      expect(_firstOccurrenceLine([])).toBe(0);
    });

    it("returns 0 for non-array input", () => {
      expect(_firstOccurrenceLine(null)).toBe(0);
      expect(_firstOccurrenceLine("not an array")).toBe(0);
    });

    it("returns 0 when first occurrence has no range", () => {
      expect(_firstOccurrenceLine([{ line: 5 }])).toBe(0);
    });

    it("returns 0 for boolean value in range[0]", () => {
      expect(_firstOccurrenceLine([{ range: [true, 0] }])).toBe(0);
    });
  });

  describe("_makeScipNodeId", () => {
    it("produces a deterministic scip-prefixed id", () => {
      const id = _makeScipNodeId("my symbol", "src/main.py");
      expect(id).toMatch(/^scip_/);
    });

    it("same inputs produce same id", () => {
      const a = _makeScipNodeId("sym", "file.py");
      const b = _makeScipNodeId("sym", "file.py");
      expect(a).toBe(b);
    });

    it("different inputs produce different ids", () => {
      const a = _makeScipNodeId("sym1", "file.py");
      const b = _makeScipNodeId("sym2", "file.py");
      expect(a).not.toBe(b);
    });
  });

  describe("ingestScipJson", () => {
    it("returns empty nodes/edges for null input", () => {
      const result = ingestScipJson(null, "test.py");
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it("returns empty nodes/edges for non-object input", () => {
      const result = ingestScipJson("bad input", "test.py");
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it("returns empty nodes/edges for object without documents", () => {
      const result = ingestScipJson({}, "test.py");
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it("processes a minimal SCIP document", () => {
      const doc = {
        documents: [
          {
            relative_path: "src/main.py",
            language: "python",
            symbols: [
              {
                symbol: "src/main.py/my_func().",
                kind: 12,
                display_name: "my_func",
                documentation: "A test function",
                relationships: [],
                occurrences: [],
              },
            ],
          },
        ],
      };
      const result = ingestScipJson(doc, "src/main.py");
      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });
});
