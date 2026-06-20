import { describe, it, expect } from "vitest";

import {
  globalAdd,
  globalRemove,
  globalList,
  globalPath,
} from "../src/globalGraph.js";

describe("globalGraph", () => {
  it("globalPath returns a string ending with global-graph.json", () => {
    const p = globalPath();
    expect(p).toContain("global-graph.json");
  });

  it("globalList returns an object", () => {
    const list = globalList();
    expect(typeof list).toBe("object");
  });

  it("globalRemove on non-existent repo throws", () => {
    expect(() => globalRemove("__nonexistent_repo_tag_test__")).toThrow(
      /not in global graph/
    );
  });

  it("globalAdd with missing file throws", () => {
    expect(() => globalAdd("/tmp/__no_such_graph_file__.json", "__test_missing__")).toThrow(
      /graph not found/
    );
  });
});
