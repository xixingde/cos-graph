import { describe, it, expect } from "vitest";

import {
  runBenchmark,
  printBenchmark,
  queryTerms,
} from "../src/benchmark.js";

describe("benchmark", () => {
  describe("queryTerms", () => {
    it("splits a question into lowercase terms and removes stop words", () => {
      const terms = queryTerms("How does authentication work?");
      expect(terms).toContain("authentication");
      expect(terms).toContain("work?");
      expect(terms).not.toContain("how");
      expect(terms).not.toContain("does");
    });

    it("preserves punctuation attached to words", () => {
      const terms = queryTerms("What is the main function?");
      expect(terms).toContain("main");
      expect(terms).toContain("function?");
    });

    it("handles empty string", () => {
      const terms = queryTerms("");
      expect(terms).toEqual([]);
    });
  });

  describe("runBenchmark", () => {
    it("throws for non-existent graph file", () => {
      expect(() => runBenchmark("/tmp/__no_such_benchmark_graph__.json")).toThrow();
    });
  });

  describe("printBenchmark", () => {
    it("handles result with error", () => {
      const result = { error: "file not found" } as any;
      const output = printBenchmark(result);
      expect(output).toBeUndefined();
    });

    it("handles a complete result without error", () => {
      const result = {
        corpus_tokens: 1000,
        corpus_words: 750,
        nodes: 10,
        edges: 20,
        avg_query_tokens: 50,
        reduction_ratio: 20,
        per_question: [],
      };
      const output = printBenchmark(result as any);
      expect(output).toBeUndefined();
    });
  });
});
