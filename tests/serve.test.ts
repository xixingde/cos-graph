import { describe, it, expect } from "vitest";
import Graph from "graphology";
import {
  stripDiacritics,
  isSearchable,
  queryTerms,
  computeIdf,
  scoreNodes,
  pickSeeds,
  bfs,
  dfs,
  findNode,
  normalizeContextFilters,
  inferContextFilters,
  resolveContextFilters,
  communitiesFromGraph,
  filterGraphByContext,
  subgraphToText,
  CONTEXT_HINTS,
  CONTEXT_FILTER_ALIASES,
  edgeData,
} from "../src/serve/query-engine.js";

function makeTestGraph(): Graph {
  const g = new Graph({ type: "directed" });
  g.addNode("a", { label: "UserService", community: 0, file_type: "concept" });
  g.addNode("b", { label: "auth.ts", community: 0, file_type: "file" });
  g.addNode("c", { label: "OrderService", community: 1, file_type: "concept" });
  g.addNode("d", { label: "order.ts", community: 1, file_type: "file" });
  g.addNode("e", { label: "DatabaseHelper", community: 0, file_type: "concept" });
  g.addDirectedEdgeWithKey("ab", "a", "b", { relation: "defined_in", confidence: 0.9, context: "import" });
  g.addDirectedEdgeWithKey("ae", "a", "e", { relation: "depends_on", confidence: 0.8, context: "call" });
  g.addDirectedEdgeWithKey("cd", "c", "d", { relation: "defined_in", confidence: 0.9, context: "import" });
  g.addDirectedEdgeWithKey("ea", "e", "a", { relation: "used_by", confidence: 0.7, context: "call" });
  return g;
}

describe("stripDiacritics", () => {
  it("strips combining diacritical marks", () => {
    expect(stripDiacritics("caf\u00E9")).toBe("cafe");
    expect(stripDiacritics("na\u00EFve")).toBe("naive");
    expect(stripDiacritics("\u00FCber")).toBe("uber");
  });

  it("returns empty string for null", () => {
    expect(stripDiacritics(null)).toBe("");
  });

  it("returns input unchanged if no diacritics", () => {
    expect(stripDiacritics("hello")).toBe("hello");
  });
});

describe("isSearchable", () => {
  it("returns true for English words longer than 2 chars", () => {
    expect(isSearchable("abc")).toBe(true);
    expect(isSearchable("user")).toBe(true);
  });

  it("returns false for English words of length <= 2", () => {
    expect(isSearchable("ab")).toBe(false);
    expect(isSearchable("a")).toBe(false);
  });

  it("returns true for non-English terms (digits, mixed, CJK)", () => {
    // Non-[a-z]+ terms always pass
    expect(isSearchable("123")).toBe(true);
    expect(isSearchable("")).toBe(true); // not [a-z]+ so returns true
    expect(isSearchable("\u4F60\u597D")).toBe(true);
  });
});

describe("queryTerms", () => {
  it("splits question into searchable terms", () => {
    const terms = queryTerms("How does the UserService work?");
    expect(terms.length).toBeGreaterThan(0);
    // "UserService" lowercased becomes "userservice", which is searchable
    expect(terms).toContain("userservice");
  });

  it("filters out short English terms (len <= 2)", () => {
    const terms = queryTerms("I am a user");
    // "I"→"i" (len 1), "am" (len 2), "a" (len 1) are filtered out
    expect(terms).not.toContain("i");
    expect(terms).not.toContain("a");
    expect(terms).toContain("user");
  });

  it("returns empty array for empty question", () => {
    expect(queryTerms("")).toEqual([]);
  });
});

describe("computeIdf", () => {
  it("computes IDF for terms on a graph", () => {
    const g = makeTestGraph();
    const idf = computeIdf(g, ["user", "service"]);
    expect(typeof idf).toBe("object");
    expect(typeof idf["user"]).toBe("number");
  });

  it("returns higher IDF for rarer terms", () => {
    const g = makeTestGraph();
    const idf = computeIdf(g, ["userservice", "nonexistent"]);
    // nonexistent appears in no node label, should have higher IDF
    expect(idf["nonexistent"]).toBeGreaterThan(idf["userservice"] ?? 0);
  });
});

describe("scoreNodes", () => {
  it("scores nodes based on query terms", () => {
    const g = makeTestGraph();
    const scored = scoreNodes(g, ["user", "service"]);
    // Only nodes with matching terms get scored > 0
    expect(scored.length).toBeGreaterThan(0);
    // UserService (node "a") should score highest (exact match components)
    const topNode = scored[0]; // sorted descending
    expect(topNode[1]).toBe("a");
  });

  it("returns empty for no matching terms", () => {
    const g = makeTestGraph();
    const scored = scoreNodes(g, ["xyznonexistent"]);
    expect(scored.length).toBe(0);
  });

  it("returns empty for empty terms", () => {
    const g = makeTestGraph();
    const scored = scoreNodes(g, []);
    expect(scored.length).toBe(0);
  });
});

describe("pickSeeds", () => {
  it("picks top-k seed nodes by score", () => {
    // Sorted descending: highest first
    const scored: [number, string][] = [
      [5, "e"],
      [3, "c"],
      [2, "b"],
      [1, "a"],
      [0.5, "d"],
    ];
    const seeds = pickSeeds(scored, 3);
    expect(seeds.length).toBeLessThanOrEqual(3);
    expect(seeds).toContain("e");
  });

  it("stops when score drops below gapRatio of top", () => {
    const scored: [number, string][] = [
      [100, "a"],
      [99, "b"],
      [10, "c"],   // below 100 * 0.2 = 20, so stops here
      [1, "d"],
    ];
    const seeds = pickSeeds(scored, 5, 0.2);
    expect(seeds).toEqual(["a", "b"]);
  });

  it("defaults to maxK=3", () => {
    const scored: [number, string][] = Array.from({ length: 10 }, (_, i) => [i, `n${i}`]);
    const seeds = pickSeeds(scored);
    expect(seeds.length).toBeLessThanOrEqual(3);
  });
});

describe("bfs", () => {
  it("traverses graph from start nodes", () => {
    const g = makeTestGraph();
    const [visited, edges] = bfs(g, ["a"], 2);
    expect(visited.has("a")).toBe(true);
    expect(visited.has("b")).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
  });

  it("respects depth limit", () => {
    const g = makeTestGraph();
    const [visited1] = bfs(g, ["a"], 1);
    const [visited2] = bfs(g, ["a"], 3);
    expect(visited2.size).toBeGreaterThanOrEqual(visited1.size);
  });
});

describe("dfs", () => {
  it("traverses graph from start nodes", () => {
    const g = makeTestGraph();
    const [visited, edges] = dfs(g, ["a"], 2);
    expect(visited.has("a")).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
  });
});

describe("findNode", () => {
  it("finds exact match", () => {
    const g = makeTestGraph();
    const found = findNode(g, "UserService");
    expect(found).toContain("a");
  });

  it("finds case-insensitive match", () => {
    const g = makeTestGraph();
    const found = findNode(g, "userservice");
    expect(found).toContain("a");
  });

  it("returns empty for no match", () => {
    const g = makeTestGraph();
    const found = findNode(g, "NonExistent");
    expect(found).toEqual([]);
  });
});

describe("normalizeContextFilters", () => {
  it("normalizes edge-type aliases", () => {
    const result = normalizeContextFilters(["param", "imports"]);
    expect(result).toContain("parameter_type");
    expect(result).toContain("import");
  });

  it("returns empty for null", () => {
    expect(normalizeContextFilters(null)).toEqual([]);
  });

  it("lowercases and strips diacritics", () => {
    const result = normalizeContextFilters(["CALL"]);
    expect(result).toContain("call");
  });

  it("passes through unknown values unchanged", () => {
    const result = normalizeContextFilters(["js"]);
    expect(result).toContain("js");
  });
});

describe("inferContextFilters", () => {
  it("infers context from edge-type hints in question text", () => {
    const filters = inferContextFilters("How does the call to that function work?");
    expect(filters).toContain("call");
  });

  it("infers import context from question text", () => {
    const filters = inferContextFilters("What modules are imported?");
    expect(filters).toContain("import");
  });

  it("returns empty for no matches", () => {
    const filters = inferContextFilters("random gibberish xyz");
    expect(filters).toEqual([]);
  });
});

describe("resolveContextFilters", () => {
  it("prefers explicit filters over inferred", () => {
    const [filters, source] = resolveContextFilters(
      "How does the call work?",
      ["import"]
    );
    expect(filters).toContain("import");
    expect(source).toBe("explicit");
  });

  it("uses inferred when no explicit provided", () => {
    const [filters, source] = resolveContextFilters("How does the call work?");
    expect(filters).toContain("call");
    expect(source).toBe("heuristic");
  });

  it("returns empty when neither explicit nor inferred", () => {
    const [filters, source] = resolveContextFilters("random gibberish xyz");
    expect(filters).toEqual([]);
    expect(source).toBeNull();
  });
});

describe("communitiesFromGraph", () => {
  it("groups nodes by community attribute", () => {
    const g = makeTestGraph();
    const comms = communitiesFromGraph(g);
    expect(Object.keys(comms).length).toBeGreaterThan(0);
    expect(comms[0]).toContain("a");
    expect(comms[0]).toContain("b");
    expect(comms[1]).toContain("c");
  });
});

describe("filterGraphByContext", () => {
  it("filters edges by context attribute, keeping all nodes", () => {
    const g = makeTestGraph();
    const sub = filterGraphByContext(g, ["call"]);
    // All nodes are still present
    expect(sub.order).toBe(g.order);
    // Only edges with context="call" remain
    let edgeCount = 0;
    sub.forEachEdge(() => { edgeCount++; });
    expect(edgeCount).toBe(2); // ae and ea have context="call"
  });

  it("returns full graph for null filters", () => {
    const g = makeTestGraph();
    const sub = filterGraphByContext(g, null);
    expect(sub.order).toBe(g.order);
  });
});

describe("subgraphToText", () => {
  it("formats subgraph as readable text", () => {
    const g = makeTestGraph();
    const [visited, edges] = bfs(g, ["a"], 2);
    const text = subgraphToText(g, visited, edges);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    // Should contain node labels
    expect(text).toContain("UserService");
  });

  it("respects token budget", () => {
    const g = makeTestGraph();
    const [visited, edges] = bfs(g, ["a"], 2);
    const text = subgraphToText(g, visited, edges, 50);
    // With a small token budget, text should be shorter
    expect(text.length).toBeLessThan(5000);
  });
});

describe("CONTEXT_HINTS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(CONTEXT_HINTS)).toBe(true);
    expect(CONTEXT_HINTS.length).toBeGreaterThan(0);
  });

  it("maps edge contexts to hint words", () => {
    const callEntry = CONTEXT_HINTS.find(([ctx]) => ctx === "call");
    expect(callEntry).toBeTruthy();
    expect(callEntry![1]).toContain("call");
  });
});

describe("CONTEXT_FILTER_ALIASES", () => {
  it("maps short aliases to edge-type context names", () => {
    expect(typeof CONTEXT_FILTER_ALIASES).toBe("object");
    expect(CONTEXT_FILTER_ALIASES["param"]).toBe("parameter_type");
    expect(CONTEXT_FILTER_ALIASES["params"]).toBe("parameter_type");
    expect(CONTEXT_FILTER_ALIASES["fields"]).toBe("field");
    expect(CONTEXT_FILTER_ALIASES["imports"]).toBe("import");
  });
});

describe("edgeData", () => {
  it("extracts edge attributes between two nodes", () => {
    const g = makeTestGraph();
    const data = edgeData(g, "a", "b");
    expect(data.relation).toBe("defined_in");
    expect(data.confidence).toBe(0.9);
  });

  it("returns empty object for non-existent edge", () => {
    const g = makeTestGraph();
    const data = edgeData(g, "a", "d");
    expect(Object.keys(data).length).toBe(0);
  });

  it("finds edge regardless of direction (undirected-like query)", () => {
    const g = makeTestGraph();
    // graphology edges(u, v) returns edges in both directions
    // edgeData treats the pair as unordered when there are edges between them
    const eaData = edgeData(g, "e", "a");
    expect(eaData.relation).toBeTruthy();

    const aeData = edgeData(g, "a", "e");
    expect(aeData.relation).toBeTruthy();
  });
});
