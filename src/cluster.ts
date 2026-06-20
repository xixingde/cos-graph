/** Community detection on graphology graphs.
 *
 * Uses Louvain (graphology-communities-louvain). Leiden is TODO.
 * Splits oversized communities and low-cohesion communities.
 * Returns cohesion scores.
 *
 * Ported from graphify/cluster.py (273 lines).
 */
import type Graph from "graphology";
import { louvainCommunities } from "./graph/community.js";
import {
  degree,
  neighbors,
  subgraphFromNodes,
  toUndirectedGraph,
  hasEdge,
} from "./graph/operations.js";
import type { CommunityMap, CohesionScores } from "./types/graph.js";

// ── constants ────────────────────────────────────────────────────────────────

const _MAX_COMMUNITY_FRACTION = 0.25;
const _MIN_SPLIT_SIZE = 10;
const _COHESION_SPLIT_THRESHOLD = 0.05;
const _COHESION_SPLIT_MIN_SIZE = 50;

// ── internal helpers ─────────────────────────────────────────────────────────

/** Invert CommunityMap (node→cid) into groups (cid→node[]). */
function communityGroups(cmap: CommunityMap): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const [node, cid] of Object.entries(cmap)) {
    let list = groups.get(cid);
    if (!list) {
      list = [];
      groups.set(cid, list);
    }
    list.push(node);
  }
  return groups;
}

/** Build CommunityMap from groups (cid→node[]). */
function communityMapFromGroups(groups: Map<number, string[]>): CommunityMap {
  const cmap: CommunityMap = {};
  for (const [cid, nodes] of groups) {
    for (const node of nodes) {
      cmap[node] = cid;
    }
  }
  return cmap;
}

/** Count edges whose both endpoints are in `nodes`. */
function internalEdgeCount(graph: Graph, nodes: string[]): number {
  let count = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (hasEdge(graph, nodes[i], nodes[j])) {
        count++;
      }
    }
  }
  return count;
}

/** Run a second Louvain pass on a community subgraph to split it further. */
function splitCommunity(graph: Graph, nodes: string[]): string[][] {
  const sub = subgraphFromNodes(graph, nodes);
  if (sub.size === 0) {
    return nodes.slice().sort().map((n) => [n]);
  }
  try {
    const partition = louvainCommunities(sub);
    const groups = communityGroups(partition);
    if (groups.size <= 1) {
      return [nodes.slice().sort()];
    }
    const result: string[][] = [];
    for (const gNodes of groups.values()) {
      result.push(gNodes.slice().sort());
    }
    return result;
  } catch {
    return [nodes.slice().sort()];
  }
}

// ── public API ───────────────────────────────────────────────────────────────

export interface ClusterOptions {
  resolution?: number;
  previousCommunities?: CommunityMap;
}

/** Run Louvain community detection. Returns CommunityMap (node→community-id).
 *
 * Oversized communities (> 25% of graph nodes, min 10) are split by running
 * a second Louvain pass on the subgraph.
 *
 * Low-cohesion communities (cohesion < 0.05, min 50 nodes) are re-split.
 *
 * Community IDs are stable across runs: 0 = largest community after splitting.
 *
 * Accepts directed or undirected graphs. DiGraphs are converted to undirected
 * internally since Louvain requires undirected input.
 *
 * resolution > 1.0 → more, smaller communities.
 * resolution < 1.0 → fewer, larger communities.
 *
 * TODO: Leiden algorithm support (currently falls back to Louvain).
 */
export function cluster(
  graph: Graph,
  options?: ClusterOptions
): CommunityMap {
  const resolution = options?.resolution ?? 1.0;

  if (graph.order === 0) return {};

  let G = graph;
  if (graph.type === "directed") {
    G = toUndirectedGraph(graph);
  }

  if (G.size === 0) {
    const cmap: CommunityMap = {};
    const sortedNodes = G.nodes().slice().sort();
    sortedNodes.forEach((n, i) => {
      cmap[n] = i;
    });
    return cmap;
  }

  // Identify isolates (degree 0) and connected nodes (degree > 0)
  const allNodes = G.nodes();
  const isolates: string[] = [];
  const connectedNodes: string[] = [];
  for (const node of allNodes) {
    if (degree(G, node) === 0) {
      isolates.push(node);
    } else {
      connectedNodes.push(node);
    }
  }

  // Run Louvain on connected component subgraph
  let rawGroups = new Map<number, string[]>();
  if (connectedNodes.length > 0) {
    const connected = subgraphFromNodes(G, connectedNodes);
    const partition = louvainCommunities(connected, resolution);
    rawGroups = communityGroups(partition);
  }

  // Each isolate becomes its own single-node community
  let nextCid = 0;
  for (const [, nodes] of rawGroups) {
    for (const n of nodes) {
      // just iterate to find max cid
    }
  }
  const existingCids = Array.from(rawGroups.keys());
  if (existingCids.length > 0) {
    nextCid = Math.max(...existingCids) + 1;
  }
  for (const node of isolates) {
    rawGroups.set(nextCid, [node]);
    nextCid++;
  }

  // Split oversized communities
  const maxSize = Math.max(_MIN_SPLIT_SIZE, Math.floor(G.order * _MAX_COMMUNITY_FRACTION));
  const firstPass: string[][] = [];
  for (const nodes of rawGroups.values()) {
    if (nodes.length > maxSize) {
      firstPass.push(...splitCommunity(G, nodes));
    } else {
      firstPass.push(nodes);
    }
  }

  // Second pass: re-split low-cohesion communities
  const secondPass: string[][] = [];
  for (const nodes of firstPass) {
    if (nodes.length >= _COHESION_SPLIT_MIN_SIZE && cohesionScore(G, nodes) < _COHESION_SPLIT_THRESHOLD) {
      const splits = splitCommunity(G, nodes);
      if (splits.length > 1) {
        secondPass.push(...splits);
      } else {
        secondPass.push(nodes);
      }
    } else {
      secondPass.push(nodes);
    }
  }

  // Re-index by size descending with lexical tie-break for total ordering
  secondPass.sort((a, b) => {
    const sizeDiff = b.length - a.length;
    if (sizeDiff !== 0) return sizeDiff;
    const aSorted = a.slice().sort();
    const bSorted = b.slice().sort();
    for (let i = 0; i < Math.min(aSorted.length, bSorted.length); i++) {
      const cmp = aSorted[i].localeCompare(bSorted[i]);
      if (cmp !== 0) return cmp;
    }
    return aSorted.length - bSorted.length;
  });

  // Apply previous community mapping if provided
  if (options?.previousCommunities) {
    const initialMap: CommunityMap = {};
    secondPass.forEach((nodes, i) => {
      for (const node of nodes) {
        initialMap[node] = i;
      }
    });
    return remapCommunities(initialMap, options.previousCommunities);
  }

  // Build final CommunityMap
  const result: CommunityMap = {};
  secondPass.forEach((nodes, i) => {
    for (const node of nodes) {
      result[node] = i;
    }
  });
  return result;
}

/** Ratio of actual intra-community edges to maximum possible. */
export function cohesionScore(graph: Graph, communityNodes: string[]): number {
  const n = communityNodes.length;
  if (n <= 1) return 1.0;
  const actual = internalEdgeCount(graph, communityNodes);
  const possible = (n * (n - 1)) / 2;
  return possible > 0 ? actual / possible : 0.0;
}

/** Compute cohesion for all communities. */
export function scoreAll(graph: Graph, communities: CommunityMap): CohesionScores {
  const groups = communityGroups(communities);
  const scores: CohesionScores = {};
  for (const [cid, nodes] of groups) {
    scores[cid] = cohesionScore(graph, nodes);
  }
  return scores;
}

/** Remap community IDs to maximize overlap with a previous assignment.
 *
 * Uses greedy one-to-one matching by intersection size, then assigns fresh IDs
 * to unmatched communities in deterministic order (size desc, lexical tie-break).
 */
export function remapCommunities(
  communities: CommunityMap,
  previous: CommunityMap
): CommunityMap {
  if (Object.keys(communities).length === 0) return {};

  const newGroups = communityGroups(communities);
  const oldGroups = new Map<number, Set<string>>();
  for (const [node, oldCid] of Object.entries(previous)) {
    let set = oldGroups.get(oldCid);
    if (!set) {
      set = new Set();
      oldGroups.set(oldCid, set);
    }
    set.add(node);
  }

  // Build overlap pairs: (overlapSize, oldCid, newCid)
  const overlaps: [number, number, number][] = [];
  for (const [oldCid, oldNodes] of oldGroups) {
    for (const [newCid, newNodes] of newGroups) {
      let overlap = 0;
      const newSet = new Set(newNodes);
      for (const n of oldNodes) {
        if (newSet.has(n)) overlap++;
      }
      if (overlap > 0) {
        overlaps.push([overlap, oldCid, newCid]);
      }
    }
  }
  overlaps.sort((a, b) => {
    const d0 = b[0] - a[0];
    if (d0 !== 0) return d0;
    const d1 = a[1] - b[1];
    if (d1 !== 0) return d1;
    return a[2] - b[2];
  });

  const newToFinal = new Map<number, number>();
  const usedOldIds = new Set<number>();
  const matchedNewIds = new Set<number>();

  for (const [_overlap, oldCid, newCid] of overlaps) {
    if (usedOldIds.has(oldCid) || matchedNewIds.has(newCid)) continue;
    newToFinal.set(newCid, oldCid);
    usedOldIds.add(oldCid);
    matchedNewIds.add(newCid);
  }

  // Assign fresh IDs to unmatched communities
  const unmatched: number[] = [];
  for (const cid of newGroups.keys()) {
    if (!matchedNewIds.has(cid)) unmatched.push(cid);
  }
  // Sort by size desc, then lexical tie-break on sorted node list
  unmatched.sort((a, b) => {
    const sizeDiff = (newGroups.get(b)?.length ?? 0) - (newGroups.get(a)?.length ?? 0);
    if (sizeDiff !== 0) return sizeDiff;
    const aNodes = (newGroups.get(a) ?? []).slice().sort();
    const bNodes = (newGroups.get(b) ?? []).slice().sort();
    for (let i = 0; i < Math.min(aNodes.length, bNodes.length); i++) {
      const cmp = aNodes[i].localeCompare(bNodes[i]);
      if (cmp !== 0) return cmp;
    }
    return aNodes.length - bNodes.length;
  });

  let nextId = 0;
  for (const newCid of unmatched) {
    while (usedOldIds.has(nextId)) nextId++;
    newToFinal.set(newCid, nextId);
    usedOldIds.add(nextId);
    nextId++;
  }

  // Build remapped CommunityMap
  const remapped: CommunityMap = {};
  for (const [node, cid] of Object.entries(communities)) {
    remapped[node] = newToFinal.get(cid) ?? cid;
  }
  return remapped;
}
