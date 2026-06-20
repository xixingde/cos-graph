/** Tests for src/cluster.ts community detection.
 *  Ported from tests/test_cluster.py.
 */
import { describe, it, expect } from "vitest";
import Graph from "graphology";
import { cluster, cohesionScore, scoreAll, remapCommunities } from "../src/cluster.js";
import { graphFromJSON } from "../src/graph/factory.js";
import type { CommunityMap } from "../src/types/graph.js";
import fs from "node:fs";
import path from "node:path";

const FIXTURES = path.resolve(__dirname, "fixtures");

function makeGraph(): Graph {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, "extraction.json"), "utf-8"));
  return graphFromJSON(data);
}

// ── cluster ─────────────────────────────────────────────────────────────────

describe("cluster", () => {
  it("returns CommunityMap", () => {
    const G = makeGraph();
    const communities = cluster(G);
    expect(communities).toBeTypeOf("object");
  });

  it("covers all nodes", () => {
    const G = makeGraph();
    const communities = cluster(G);
    const communityNodes = new Set(Object.keys(communities));
    const graphNodes = new Set(G.nodes());
    expect(communityNodes).toEqual(graphNodes);
  });

  it("returns empty map for empty graph", () => {
    const G = new Graph({ type: "undirected" });
    expect(cluster(G)).toEqual({});
  });

  it("assigns each isolated node to its own community", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("a");
    G.addNode("b");
    G.addNode("c");
    const communities = cluster(G);
    const uniqueCids = new Set(Object.values(communities));
    expect(uniqueCids.size).toBe(3);
  });
});

// ── cohesionScore ────────────────────────────────────────────────────────────

describe("cohesionScore", () => {
  it("complete graph has cohesion 1.0", () => {
    const G = new Graph({ type: "undirected" });
    const nodes = ["0", "1", "2", "3"];
    nodes.forEach((n) => G.addNode(n));
    // Add all edges for complete graph K4
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        G.addEdge(nodes[i], nodes[j]);
      }
    }
    expect(cohesionScore(G, nodes)).toBe(1.0);
  });

  it("single node has cohesion 1.0", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("a");
    expect(cohesionScore(G, ["a"])).toBe(1.0);
  });

  it("disconnected nodes have cohesion 0.0", () => {
    const G = new Graph({ type: "undirected" });
    G.addNode("a");
    G.addNode("b");
    G.addNode("c");
    expect(cohesionScore(G, ["a", "b", "c"])).toBe(0.0);
  });

  it("cohesion is in range [0, 1]", () => {
    const G = makeGraph();
    const communities = cluster(G);
    // Collect groups from CommunityMap
    const groups = new Map<number, string[]>();
    for (const [node, cid] of Object.entries(communities)) {
      let list = groups.get(cid);
      if (!list) {
        list = [];
        groups.set(cid, list);
      }
      list.push(node);
    }
    for (const nodes of groups.values()) {
      const score = cohesionScore(G, nodes);
      expect(score).toBeGreaterThanOrEqual(0.0);
      expect(score).toBeLessThanOrEqual(1.0);
    }
  });
});

// ── scoreAll ──────────────────────────────────────────────────────────────────

describe("scoreAll", () => {
  it("keys match community IDs", () => {
    const G = makeGraph();
    const communities = cluster(G);
    const scores = scoreAll(G, communities);
    // Extract unique community IDs from CommunityMap
    const communityIds = new Set(Object.values(communities));
    expect(new Set(Object.keys(scores).map(Number))).toEqual(communityIds);
  });
});

// ── remapCommunities ─────────────────────────────────────────────────────────

describe("remapCommunities", () => {
  it("reuses old IDs for overlapping communities", () => {
    // Python test had communities = {10: ["a","b","c"], 11: ["d","e"]}
    // In CommunityMap format: {a:10, b:10, c:10, d:11, e:11}
    const communities: CommunityMap = { a: 10, b: 10, c: 10, d: 11, e: 11 };
    const previous: CommunityMap = { a: 5, b: 5, c: 5, d: 1, e: 1 };
    const remapped = remapCommunities(communities, previous);
    const communityIds = new Set(Object.values(remapped));
    expect(communityIds).toEqual(new Set([1, 5]));
    expect(remapped.a).toBe(5);
    expect(remapped.b).toBe(5);
    expect(remapped.c).toBe(5);
    expect(remapped.d).toBe(1);
    expect(remapped.e).toBe(1);
  });

  it("assigns deterministic new IDs to unmatched communities", () => {
    const communities: CommunityMap = { x: 7, y: 7, z: 7, m: 8 };
    const previous: CommunityMap = { a: 3 };
    const remapped = remapCommunities(communities, previous);
    // The larger community (x,y,z) gets ID 0, the smaller (m) gets ID 1
    const cids = new Set(Object.values(remapped));
    expect(cids).toEqual(new Set([0, 1]));
    expect(remapped.x).toBe(0);
    expect(remapped.y).toBe(0);
    expect(remapped.z).toBe(0);
    expect(remapped.m).toBe(1);
  });

  it("returns empty for empty communities", () => {
    const previous: CommunityMap = { a: 1 };
    expect(remapCommunities({}, previous)).toEqual({});
  });
});
