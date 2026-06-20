import { describe, it, expect } from "vitest";
import { FileType, AffectedHit, ExtractionResult } from "../src/types/index.js";

describe("FileType enum", () => {
  it("has Code member", () => {
    expect(FileType.Code).toBe("code");
  });

  it("has Document member", () => {
    expect(FileType.Document).toBe("document");
  });

  it("has Paper member", () => {
    expect(FileType.Paper).toBe("paper");
  });
});

describe("AffectedHit interface", () => {
  it("can be created with required fields", () => {
    const hit: AffectedHit = {
      nodeId: "node-1",
      depth: 2,
      viaRelation: "calls",
    };
    expect(hit.nodeId).toBe("node-1");
    expect(hit.depth).toBe(2);
    expect(hit.viaRelation).toBe("calls");
  });
});

describe("ExtractionResult interface", () => {
  it("can be created with nodes and edges", () => {
    const result: ExtractionResult = {
      nodes: [],
      edges: [],
      languages: {},
    };
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.languages).toEqual({});
  });

  it("can include an optional error", () => {
    const result: ExtractionResult = {
      nodes: [],
      edges: [],
      languages: {},
      error: "something failed",
    };
    expect(result.error).toBe("something failed");
  });
});
