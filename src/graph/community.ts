import type Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { CommunityMap } from "../types/graph.js";

export function louvainCommunities(
  graph: Graph,
  resolution?: number
): CommunityMap {
  const options: { resolution?: number } = {};
  if (resolution !== undefined) {
    options.resolution = resolution;
  }
  return louvain(graph, options) as CommunityMap;
}

export function leidenCommunities(
  graph: Graph,
  resolution?: number
): CommunityMap {
  console.warn(
    "Leiden algorithm is not available in graphology; falling back to Louvain"
  );
  return louvainCommunities(graph, resolution);
}
