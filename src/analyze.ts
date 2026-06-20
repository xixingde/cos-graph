/**Graph analysis: god nodes (most connected), surprising connections (cross-community), suggested questions.
 *
 * Ported from graphify/analyze.py (733 lines).
 */
import type Graph from "graphology";
import { DirectedGraph } from "graphology";

import {
  degree,
  neighbors,
  getNodeAttributes,
  getEdgeAttributes,
  hasNode,
} from "./graph/operations.js";
import { cohesionScore } from "./cluster.js";
import { CODE_EXTENSIONS, PAPER_EXTENSIONS, IMAGE_EXTENSIONS } from "./detect.js";
import type {
  GodNode,
  SurprisingConnection,
  ConfidenceLevel,
  SuggestedQuestion,
  QuestionType,
  DiffNodeEntry,
  DiffEdgeEntry,
  GraphDiff,
  ImportCycle,
} from "./types/report.js";
import type { CommunityMap } from "./types/graph.js";

/** Convert CommunityMap (node→cid) to groups (cid→node[]). */
function communityGroups(cmap: CommunityMap): Record<number, string[]> {
  const groups: Record<number, string[]> = {};
  for (const [node, cid] of Object.entries(cmap)) {
    if (!groups[cid]) groups[cid] = [];
    groups[cid].push(node);
  }
  return groups;
}

// ── constants ────────────────────────────────────────────────────────────────

/** Builtin/mock names that can appear as annotation-derived nodes.
 *  Excluded from god-node ranking so they don't displace real abstractions. */
const BUILTIN_NOISE_LABELS: Set<string> = new Set([
  "str", "int", "float", "bool", "bytes", "bytearray", "complex", "object",
  "True", "False",
  "MagicMock", "Mock", "AsyncMock", "NonCallableMock",
  "NonCallableMagicMock", "PropertyMock", "patch", "sentinel",
  "Path", "Any", "Optional", "List", "Dict", "Set", "Tuple", "Union",
  "Callable", "Type", "ClassVar", "Final", "Literal", "Protocol",
  "Counter", "defaultdict", "OrderedDict", "datetime", "Enum",
  "os", "sys", "re", "json", "io", "abc", "typing",
]);

/** Language families — extensions sharing a runtime can legitimately call each other. */
const LANG_FAMILY: Record<string, string> = {
  ...Object.fromEntries([".py", ".pyw"].map((e) => [e, "python"])),
  ...Object.fromEntries([".js", ".jsx", ".mjs", ".ejs", ".ts", ".tsx", ".vue", ".svelte"].map((e) => [e, "js"])),
  ...Object.fromEntries([".go"].map((e) => [e, "go"])),
  ...Object.fromEntries([".rs"].map((e) => [e, "rust"])),
  ...Object.fromEntries([".java", ".kt", ".kts", ".scala"].map((e) => [e, "jvm"])),
  ...Object.fromEntries([".c", ".h", ".cpp", ".cc", ".cxx", ".hpp"].map((e) => [e, "c"])),
  ...Object.fromEntries([".rb"].map((e) => [e, "ruby"])),
  ...Object.fromEntries([".swift"].map((e) => [e, "swift"])),
  ...Object.fromEntries([".cs"].map((e) => [e, "dotnet"])),
  ...Object.fromEntries([".php"].map((e) => [e, "php"])),
  ...Object.fromEntries([".r"].map((e) => [e, "r"])),
};

/** JSON key noise labels to filter from god-node ranking. */
const JSON_NOISE_LABELS: Set<string> = new Set([
  "start", "end", "name", "id", "type", "properties",
  "value", "key", "data", "items", "title", "description", "version",
  "dependencies", "devdependencies", "peerdependencies",
  "optionaldependencies", "bundleddependencies", "bundledependencies",
]);

// ── internal helpers ─────────────────────────────────────────────────────────

/** Return True if two source files belong to different language families. */
export function crossLanguage(srcA: string, srcB: string): boolean {
  const extA = getExtension(srcA).toLowerCase();
  const extB = getExtension(srcB).toLowerCase();
  const famA = LANG_FAMILY[extA];
  const famB = LANG_FAMILY[extB];
  if (famA === undefined || famB === undefined) return false;
  return famA !== famB;
}

/** Get file extension including the dot. Returns empty string if no dot. */
function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "";
  return path.slice(lastDot);
}

/** Invert communities groups (cid→node[]) to CommunityMap (nodeId→cid).
 *  If a CommunityMap is already provided (node→cid), returns it as-is. */
export function nodeCommunityMap(communities: Record<number, string[]> | CommunityMap): CommunityMap {
  // Detect if it's already a CommunityMap (values are numbers, not arrays)
  const entries = Object.entries(communities);
  if (entries.length === 0) return {};
  const firstValue = entries[0][1];
  if (typeof firstValue === "number") return communities as CommunityMap;
  // It's groups (cid → node[])
  const result: CommunityMap = {};
  for (const [cid, nodes] of entries as [string, string[]][]) {
    for (const n of nodes) {
      result[n] = Number(cid);
    }
  }
  return result;
}

/** Return True if this node is a file-level hub node or an AST method stub. */
export function isFileNode(graph: Graph, nodeId: string): boolean {
  const attrs = getNodeAttributes(graph, nodeId);
  const label = (attrs.label as string) || "";
  if (!label) return false;
  // File-level hub: label matches the actual source filename
  const sourceFile = (attrs.source_file as string) || "";
  if (sourceFile) {
    const fileName = sourceFile.split("/").pop()!;
    if (label === fileName) return true;
  }
  // Method stub: AST extractor labels methods as '.method_name()'
  if (label.startsWith(".") && label.endsWith("()")) return true;
  // Module-level function stub: labeled 'function_name()' with degree ≤ 1
  if (label.endsWith("()") && degree(graph, nodeId) <= 1) return true;
  return false;
}

/** Return True if this node is a manually-injected semantic concept node. */
export function isConceptNode(graph: Graph, nodeId: string): boolean {
  const attrs = getNodeAttributes(graph, nodeId);
  const source = (attrs.source_file as string) || "";
  if (!source) return true;
  // Has no file extension → probably a concept label
  const lastPart = source.split("/").pop()!;
  if (!lastPart.includes(".")) return true;
  return false;
}

/** Return True if this node is a JSON key noise node. */
export function isJsonKeyNode(graph: Graph, nodeId: string): boolean {
  const attrs = getNodeAttributes(graph, nodeId);
  const src = ((attrs.source_file as string) || "").toLowerCase();
  if (!src.endsWith(".json")) return false;
  const label = ((attrs.label as string) || "").trim().toLowerCase();
  return JSON_NOISE_LABELS.has(label);
}

/** Classify a file path into code/paper/image/doc. */
export function fileCategory(path: string): string {
  const ext = getExtension(path).toLowerCase();
  if (!ext) return "doc";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (PAPER_EXTENSIONS.has(ext)) return "paper";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "doc";
}

/** Return the first path component — used to detect cross-repo edges. */
function topLevelDir(path: string): string {
  const idx = path.indexOf("/");
  return idx >= 0 ? path.slice(0, idx) : path;
}

/** Score how surprising a cross-file edge is. Returns [score, reasons]. */
export function surpriseScore(
  graph: Graph,
  u: string,
  v: string,
  edgeAttrs: Record<string, unknown>,
  nodeCommunity: Record<string, number>,
  uSource: string,
  vSource: string,
  degrees?: Record<string, number> | null,
): [number, string[]] {
  let score = 0;
  const reasons: string[] = [];

  // 1. Confidence weight
  const conf = (edgeAttrs.confidence as string) || "EXTRACTED";
  const relation = (edgeAttrs.relation as string) || "";
  const confBonusMap: Record<string, number> = { AMBIGUOUS: 3, INFERRED: 2, EXTRACTED: 1 };
  let confBonus = confBonusMap[conf] ?? 1;

  const catU = fileCategory(uSource);
  const catV = fileCategory(vSource);

  // Suppress structural bonuses for INFERRED calls/uses that cross language
  // boundaries or connect code to a doc file.
  const suppressStructural =
    conf === "INFERRED"
    && (relation === "calls" || relation === "uses")
    && (crossLanguage(uSource, vSource) || (catU === "code" && catV === "doc") || (catV === "code" && catU === "doc"));

  if (suppressStructural) confBonus = 0;

  score += confBonus;
  if (conf === "AMBIGUOUS" || conf === "INFERRED") {
    reasons.push(`${conf.toLowerCase()} connection - not explicitly stated in source`);
  }

  // 2. Cross file-type bonus
  if (catU !== catV && !suppressStructural) {
    score += 2;
    reasons.push(`crosses file types (${catU} \u2194 ${catV})`);
  }

  // 3. Cross-repo bonus
  if (topLevelDir(uSource) !== topLevelDir(vSource) && !suppressStructural) {
    score += 2;
    reasons.push("connects across different repos/directories");
  }

  // 4. Cross-community bonus
  const cidU = nodeCommunity[u];
  const cidV = nodeCommunity[v];
  if (cidU !== undefined && cidV !== undefined && cidU !== cidV && !suppressStructural) {
    score += 1;
    reasons.push("bridges separate communities");
  }

  // 4b. Semantic similarity bonus
  if ((edgeAttrs.relation as string) === "semantically_similar_to") {
    score = Math.floor(score * 1.5);
    reasons.push("semantically similar concepts with no structural link");
  }

  // 5. Peripheral→hub
  const degU = degrees ? degrees[u] : degree(graph, u);
  const degV = degrees ? degrees[v] : degree(graph, v);
  if (Math.min(degU, degV) <= 2 && Math.max(degU, degV) >= 5) {
    score += 1;
    const uAttrs = getNodeAttributes(graph, u);
    const vAttrs = getNodeAttributes(graph, v);
    const peripheral = degU <= 2 ? (uAttrs.label as string) || u : (vAttrs.label as string) || v;
    const hub = degU <= 2 ? (vAttrs.label as string) || v : (uAttrs.label as string) || u;
    reasons.push(`peripheral node \`${peripheral}\` unexpectedly reaches hub \`${hub}\``);
  }

  return [score, reasons];
}

// ── betweenness centrality (Brandes algorithm) ──────────────────────────────

/** Compute betweenness centrality for all nodes using Brandes' algorithm.
 *  For large graphs (>1000 nodes), uses sampling approximation. */
function betweennessCentrality(graph: Graph): Record<string, number> {
  const n = graph.order;
  if (n === 0) return {};

  const cb: Record<string, number> = {};
  graph.forEachNode((node) => { cb[node] = 0; });

  // For large graphs, sample
  let sources: string[];
  if (n > 1000) {
    const k = Math.min(100, n);
    sources = sampleNodes(graph, k, 42);
  } else {
    sources = [];
    graph.forEachNode((node) => { sources.push(node); });
  }

  for (const s of sources) {
    // BFS from s
    const stack: string[] = [];
    const pred: Record<string, string[]> = {};
    const sigma: Record<string, number> = {};
    const dist: Record<string, number> = {};
    graph.forEachNode((node) => {
      pred[node] = [];
      sigma[node] = 0;
      dist[node] = -1;
    });
    sigma[s] = 1;
    dist[s] = 0;
    const queue: string[] = [s];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      const nbrs = neighbors(graph, v);
      for (const w of nbrs) {
        // First visit?
        if (dist[w] < 0) {
          queue.push(w);
          dist[w] = dist[v] + 1;
        }
        // Shortest path via v?
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          pred[w].push(v);
        }
      }
    }

    // Accumulation
    const delta: Record<string, number> = {};
    graph.forEachNode((node) => { delta[node] = 0; });
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of pred[w]) {
        const contribution = (sigma[v] / sigma[w]) * (1 + delta[w]);
        delta[v] += contribution;
      }
      if (w !== s) {
        cb[w] += delta[w];
      }
    }
  }

  // Normalize
  const scale = sources.length < n ? n / sources.length : 1;
  // For undirected graphs, divide by 2
  const isDirected = graph.type === "directed";
  const undirectedFactor = isDirected ? 1 : 2;
  const normFactor = n <= 2 ? 1 : (n - 1) * (n - 2);
  for (const node of Object.keys(cb)) {
    cb[node] = (cb[node] * scale) / (undirectedFactor * normFactor);
  }

  return cb;
}

/** Deterministic sampling of k nodes from graph using seed. */
function sampleNodes(graph: Graph, k: number, _seed: number): string[] {
  const allNodes: string[] = [];
  graph.forEachNode((node) => { allNodes.push(node); });
  // Simple deterministic shuffle using seed
  const arr = [...allNodes];
  let s = _seed;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, k);
}

/** Compute edge betweenness centrality. */
function edgeBetweennessCentrality(graph: Graph): Record<string, number> {
  const n = graph.order;
  if (n === 0) return {};

  const edgeCb: Record<string, number> = {};

  const addEdgeScore = (u: string, v: string, score: number) => {
    const key = u < v ? `${u}\0${v}` : `${v}\0${u}`;
    edgeCb[key] = (edgeCb[key] || 0) + score;
  };

  const getEdgeScore = (u: string, v: string): number => {
    const key = u < v ? `${u}\0${v}` : `${v}\0${u}`;
    return edgeCb[key] || 0;
  };

  const sources: string[] = [];
  graph.forEachNode((node) => { sources.push(node); });

  for (const s of sources) {
    const stack: string[] = [];
    const pred: Record<string, string[]> = {};
    const sigma: Record<string, number> = {};
    const dist: Record<string, number> = {};
    graph.forEachNode((node) => {
      pred[node] = [];
      sigma[node] = 0;
      dist[node] = -1;
    });
    sigma[s] = 1;
    dist[s] = 0;
    const queue: string[] = [s];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      const nbrs = neighbors(graph, v);
      for (const w of nbrs) {
        if (dist[w] < 0) {
          queue.push(w);
          dist[w] = dist[v] + 1;
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          pred[w].push(v);
        }
      }
    }

    const delta: Record<string, number> = {};
    graph.forEachNode((node) => { delta[node] = 0; });
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of pred[w]) {
        const contribution = (sigma[v] / sigma[w]) * (1 + delta[w]);
        delta[v] += contribution;
        addEdgeScore(v, w, contribution);
      }
    }
  }

  // Build result keyed by "u\tv"
  const isDirected = graph.type === "directed";
  const undirectedFactor = isDirected ? 1 : 2;
  const normFactor = n <= 2 ? 1 : n * (n - 1);
  const result: Record<string, number> = {};

  graph.forEachEdge((_edge, _attrs, u, v) => {
    const key = u < v ? `${u}\0${v}` : `${v}\0${u}`;
    if (edgeCb[key] !== undefined) {
      result[`${u}\t${v}`] = edgeCb[key] / (undirectedFactor * normFactor);
    }
  });

  return result;
}

// ── simple cycles (DFS-based for directed graphs) ───────────────────────────

/** Find simple cycles in a directed graph, bounded by length.
 *  Uses a DFS-based approach (Johnson-inspired). */
function simpleCycles(
  fileGraph: DirectedGraph,
  lengthBound: number,
  maxCycles: number,
): string[][] {
  const cycles: string[][] = [];
  const nodes: string[] = [];
  fileGraph.forEachNode((node) => { nodes.push(node); });

  // For each node, try DFS-based cycle detection starting from that node
  const allCycles: string[][] = [];

  for (const startNode of nodes) {
    // DFS from startNode, only finding cycles that include startNode
    const visited = new Set<string>();
    const stack: [string, string[]][] = [];

    // Initial neighbors
    const initialNeighbors: string[] = [];
    fileGraph.forEachOutNeighbor(startNode, (nbr) => {
      initialNeighbors.push(nbr);
    });

    // Push (node, path) onto stack
    for (const nbr of initialNeighbors) {
      stack.push([nbr, [startNode]] as [string, string[]]);
    }
    visited.add(startNode);

    while (stack.length > 0) {
      const [current, path] = stack.pop()!;

      if (current === startNode && path.length > 0) {
        // Found a cycle
        if (path.length <= lengthBound) {
          allCycles.push([...path, current]);
        }
        continue;
      }

      if (visited.has(current)) continue;
      if (path.length >= lengthBound) continue;

      const newVisited = new Set(visited);
      newVisited.add(current);

      const outNeighbors: string[] = [];
      fileGraph.forEachOutNeighbor(current, (nbr) => {
        outNeighbors.push(nbr);
      });

      for (const nbr of outNeighbors) {
        if (nbr === startNode) {
          // Cycle found
          if (path.length + 1 <= lengthBound) {
            allCycles.push([...path, current, nbr]);
          }
        } else if (!newVisited.has(nbr) && path.length + 1 < lengthBound) {
          stack.push([nbr, [...path, current]] as [string, string[]]);
        }
      }

      visited.add(current);
    }

    if (allCycles.length >= maxCycles * 10) break;
  }

  return allCycles;
}

// ── public functions ─────────────────────────────────────────────────────────

/** Return the top_n most-connected real entities — the core abstractions. */
export function godNodes(graph: Graph, topN: number = 10): GodNode[] {
  // Build degree map
  const degMap: Record<string, number> = {};
  graph.forEachNode((node) => { degMap[node] = degree(graph, node); });

  const sortedNodes = Object.entries(degMap)
    .sort((a, b) => b[1] - a[1]);

  const result: GodNode[] = [];
  for (const [nodeId, deg] of sortedNodes) {
    if (isFileNode(graph, nodeId) || isConceptNode(graph, nodeId) || isJsonKeyNode(graph, nodeId)) {
      continue;
    }
    const attrs = getNodeAttributes(graph, nodeId);
    const label = (attrs.label as string) || "";
    if (BUILTIN_NOISE_LABELS.has(label)) continue;
    result.push({ id: nodeId, label: label || nodeId, degree: deg });
    if (result.length >= topN) break;
  }
  return result;
}

/** Find connections that are genuinely surprising — not obvious from file structure. */
export function surprisingConnections(
  graph: Graph,
  communities?: CommunityMap,
  topN: number = 5,
): SurprisingConnection[] {
  // Identify unique source files
  const sourceFiles = new Set<string>();
  graph.forEachNode((node) => {
    const attrs = getNodeAttributes(graph, node);
    const sf = (attrs.source_file as string) || "";
    if (sf) sourceFiles.add(sf);
  });

  const isMultiSource = sourceFiles.size > 1;
  const comms = communities || {};

  if (isMultiSource) {
    return crossFileSurprises(graph, comms, topN);
  } else {
    return crossCommunitySurprises(graph, comms, topN);
  }
}

/** Cross-file edges between real entities, ranked by surprise score. */
function crossFileSurprises(
  graph: Graph,
  communities: CommunityMap,
  topN: number,
): SurprisingConnection[] {
  const nodeCommunity = nodeCommunityMap(communities);
  const degMap: Record<string, number> = {};
  graph.forEachNode((node) => { degMap[node] = degree(graph, node); });

  interface Candidate {
    _score: number;
    source: string;
    target: string;
    sourceFiles: [string, string];
    confidence: ConfidenceLevel;
    relation: string;
    why: string;
  }

  const candidates: Candidate[] = [];

  graph.forEachEdge((_edge, edgeAttrs, u, v) => {
    const attrs = edgeAttrs as Record<string, unknown>;
    const relation = (attrs.relation as string) || "";
    if (relation === "imports" || relation === "imports_from" || relation === "contains" || relation === "method") {
      return;
    }
    if (isConceptNode(graph, u) || isConceptNode(graph, v)) return;
    if (isFileNode(graph, u) || isFileNode(graph, v)) return;

    const uAttrs = getNodeAttributes(graph, u);
    const vAttrs = getNodeAttributes(graph, v);
    const uSource = (uAttrs.source_file as string) || "";
    const vSource = (vAttrs.source_file as string) || "";

    if (!uSource || !vSource || uSource === vSource) return;

    const [score, reasons] = surpriseScore(graph, u, v, attrs, nodeCommunity, uSource, vSource, degMap);

    const srcId = (attrs._src as string) || u;
    const tgtId = (attrs._tgt as string) || v;
    const finalSrcId = hasNode(graph, srcId) ? srcId : u;
    const finalTgtId = hasNode(graph, tgtId) ? tgtId : v;

    const srcAttrs = getNodeAttributes(graph, finalSrcId);
    const tgtAttrs = getNodeAttributes(graph, finalTgtId);

    candidates.push({
      _score: score,
      source: (srcAttrs.label as string) || finalSrcId,
      target: (tgtAttrs.label as string) || finalTgtId,
      sourceFiles: [
        (srcAttrs.source_file as string) || "",
        (tgtAttrs.source_file as string) || "",
      ] as [string, string],
      confidence: ((attrs.confidence as string) || "EXTRACTED") as ConfidenceLevel,
      relation,
      why: reasons.length > 0 ? reasons.join("; ") : "cross-file semantic connection",
    });
  });

  candidates.sort((a, b) => b._score - a._score);

  if (candidates.length > 0) {
    return candidates.slice(0, topN).map(({ _score: _, ...rest }) => rest);
  }

  return crossCommunitySurprises(graph, communities, topN);
}

/** For single-source corpora: find edges that bridge different communities. */
function crossCommunitySurprises(
  graph: Graph,
  communities: CommunityMap,
  topN: number,
): SurprisingConnection[] {
  if (!communities || Object.keys(communities).length === 0) {
    // No community info — use edge betweenness centrality
    if (graph.size === 0) return [];
    if (graph.order > 5000) return [];

    const betweenness = edgeBetweennessCentrality(graph);
    const topEdges = Object.entries(betweenness)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN);

    const result: SurprisingConnection[] = [];
    for (const [key, score] of topEdges) {
      const [u, v] = key.split("\t");
      const edgeAttrs = graph.getEdgeAttributes(u, v) as Record<string, unknown>;
      const uAttrs = getNodeAttributes(graph, u);
      const vAttrs = getNodeAttributes(graph, v);
      result.push({
        source: (uAttrs.label as string) || u,
        target: (vAttrs.label as string) || v,
        sourceFiles: [
          (uAttrs.source_file as string) || "",
          (vAttrs.source_file as string) || "",
        ] as [string, string],
        confidence: ((edgeAttrs.confidence as string) || "EXTRACTED") as ConfidenceLevel,
        relation: (edgeAttrs.relation as string) || "",
        note: `Bridges graph structure (betweenness=${score.toFixed(3)})`,
      });
    }
    return result;
  }

  // Build node → community map
  const nodeCommunity = nodeCommunityMap(communities);

  interface SurpriseCandidate {
    source: string;
    target: string;
    sourceFiles: [string, string];
    confidence: ConfidenceLevel;
    relation: string;
    note: string;
    _pair: string;
  }

  const surprises: SurpriseCandidate[] = [];

  graph.forEachEdge((_edge, edgeAttrs, u, v) => {
    const attrs = edgeAttrs as Record<string, unknown>;
    const cidU = nodeCommunity[u];
    const cidV = nodeCommunity[v];
    if (cidU === undefined || cidV === undefined || cidU === cidV) return;
    if (isFileNode(graph, u) || isFileNode(graph, v)) return;
    const relation = (attrs.relation as string) || "";
    if (relation === "imports" || relation === "imports_from" || relation === "contains" || relation === "method") return;

    const confidence = ((attrs.confidence as string) || "EXTRACTED") as ConfidenceLevel;
    const srcId = (attrs._src as string) || u;
    const tgtId = (attrs._tgt as string) || v;
    const finalSrcId = hasNode(graph, srcId) ? srcId : u;
    const finalTgtId = hasNode(graph, tgtId) ? tgtId : v;

    const srcAttrs = getNodeAttributes(graph, finalSrcId);
    const tgtAttrs = getNodeAttributes(graph, finalTgtId);

    const pairKey = cidU < cidV ? `${cidU},${cidV}` : `${cidV},${cidU}`;
    surprises.push({
      source: (srcAttrs.label as string) || finalSrcId,
      target: (tgtAttrs.label as string) || finalTgtId,
      sourceFiles: [
        (srcAttrs.source_file as string) || "",
        (tgtAttrs.source_file as string) || "",
      ] as [string, string],
      confidence,
      relation,
      note: `Bridges community ${cidU} \u2192 community ${cidV}`,
      _pair: pairKey,
    });
  });

  // Sort: AMBIGUOUS first, then INFERRED, then EXTRACTED
  const order: Record<string, number> = { AMBIGUOUS: 0, INFERRED: 1, EXTRACTED: 2 };
  surprises.sort((a, b) => (order[a.confidence] ?? 3) - (order[b.confidence] ?? 3));

  // Deduplicate by community pair
  const seenPairs = new Set<string>();
  const deduped: SurprisingConnection[] = [];
  for (const s of surprises) {
    if (!seenPairs.has(s._pair)) {
      seenPairs.add(s._pair);
      const { _pair: _, ...rest } = s;
      deduped.push(rest);
    }
  }
  return deduped.slice(0, topN);
}

/** Generate questions the graph is uniquely positioned to answer. */
export function suggestQuestions(
  graph: Graph,
  communities: CommunityMap,
  communityLabels: Record<number, string>,
  topN: number = 7,
): SuggestedQuestion[] {
  // Normalize community labels keys to numbers
  const labels: Record<number, string> = {};
  if (communityLabels) {
    for (const [k, v] of Object.entries(communityLabels)) {
      labels[Number(k)] = v;
    }
  }

  const questions: SuggestedQuestion[] = [];
  const nodeCommunity = nodeCommunityMap(communities);

  // 1. AMBIGUOUS edges → unresolved relationship questions
  graph.forEachEdge((_edge, edgeAttrs, u, v) => {
    const attrs = edgeAttrs as Record<string, unknown>;
    if (attrs.confidence === "AMBIGUOUS") {
      const uAttrs = getNodeAttributes(graph, u);
      const vAttrs = getNodeAttributes(graph, v);
      const ul = (uAttrs.label as string) || u;
      const vl = (vAttrs.label as string) || v;
      const relation = (attrs.relation as string) || "related to";
      questions.push({
        type: "ambiguous_edge" as QuestionType,
        question: `What is the exact relationship between \`${ul}\` and \`${vl}\`?`,
        why: `Edge tagged AMBIGUOUS (relation: ${relation}) - confidence is low.`,
      });
    }
  });

  // 2. Bridge nodes (high betweenness)
  if (graph.size > 0) {
    const betweenness = betweennessCentrality(graph);
    const bridges = Object.entries(betweenness)
      .filter(([n, s]) => !isFileNode(graph, n) && !isConceptNode(graph, n) && s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    for (const [nodeId, score] of bridges) {
      const attrs = getNodeAttributes(graph, nodeId);
      const label = (attrs.label as string) || nodeId;
      const cid = nodeCommunity[nodeId];
      const commLabel = cid !== undefined ? (labels[cid] || `Community ${cid}`) : "unknown";
      const nbrs = neighbors(graph, nodeId);
      const neighborComms = new Set<number>();
      for (const n of nbrs) {
        const nc = nodeCommunity[n];
        if (nc !== undefined && nc !== cid) neighborComms.add(nc);
      }
      if (neighborComms.size > 0) {
        const otherLabels = [...neighborComms].map((c) => labels[c] || `Community ${c}`);
        questions.push({
          type: "bridge_node" as QuestionType,
          question: `Why does \`${label}\` connect \`${commLabel}\` to ${otherLabels.map((l) => `\`${l}\``).join(", ")}?`,
          why: `High betweenness centrality (${score.toFixed(3)}) - this node is a cross-community bridge.`,
        });
      }
    }
  }

  // 3. God nodes with many INFERRED edges → verification questions
  const degMap: Record<string, number> = {};
  graph.forEachNode((node) => { degMap[node] = degree(graph, node); });
  const topNodes = Object.entries(degMap)
    .filter(([n]) => !isFileNode(graph, n))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  for (const [nodeId] of topNodes) {
    const inferred: Array<{ u: string; v: string; attrs: Record<string, unknown> }> = [];
    graph.forEachEdge((_edge, edgeAttrs, eu, ev) => {
      const attrs = edgeAttrs as Record<string, unknown>;
      if (attrs.confidence === "INFERRED" && (eu === nodeId || ev === nodeId)) {
        inferred.push({ u: eu, v: ev, attrs });
      }
    });

    if (inferred.length >= 2) {
      const attrs = getNodeAttributes(graph, nodeId);
      const label = (attrs.label as string) || nodeId;
      const others: string[] = [];
      for (const inf of inferred.slice(0, 2)) {
        const srcId = (inf.attrs._src as string) || inf.u;
        const tgtId = (inf.attrs._tgt as string) || inf.v;
        const finalSrcId = hasNode(graph, srcId) ? srcId : inf.u;
        const finalTgtId = hasNode(graph, tgtId) ? tgtId : inf.v;
        const otherId = finalSrcId === nodeId ? finalTgtId : finalSrcId;
        const otherAttrs = getNodeAttributes(graph, otherId);
        others.push((otherAttrs.label as string) || otherId);
      }
      questions.push({
        type: "verify_inferred" as QuestionType,
        question: `Are the ${inferred.length} inferred relationships involving \`${label}\` (e.g. with \`${others[0]}\` and \`${others[1]}\`) actually correct?`,
        why: `\`${label}\` has ${inferred.length} INFERRED edges - model-reasoned connections that need verification.`,
      });
    }
  }

  // 4. Isolated or weakly-connected nodes
  const isolated: string[] = [];
  graph.forEachNode((node) => {
    if (degree(graph, node) <= 1 && !isFileNode(graph, node) && !isConceptNode(graph, node)) {
      isolated.push(node);
    }
  });
  if (isolated.length > 0) {
    const labels = isolated.slice(0, 3).map((n) => {
      const attrs = getNodeAttributes(graph, n);
      return (attrs.label as string) || n;
    });
    questions.push({
      type: "isolated_nodes" as QuestionType,
      question: `What connects ${labels.map((l) => `\`${l}\``).join(", ")} to the rest of the system?`,
      why: `${isolated.length} weakly-connected nodes found - possible documentation gaps or missing edges.`,
    });
  }

  // 5. Low-cohesion communities
  const groups = communityGroups(communities);
  for (const [cid, nodes] of Object.entries(groups)) {
    const score = cohesionScore(graph, nodes);
    if (score < 0.15 && nodes.length >= 5) {
      const label = labels[Number(cid)] || `Community ${cid}`;
      questions.push({
        type: "low_cohesion" as QuestionType,
        question: `Should \`${label}\` be split into smaller, more focused modules?`,
        why: `Cohesion score ${score} - nodes in this community are weakly interconnected.`,
      });
    }
  }

  if (questions.length === 0) {
    return [{
      type: "no_signal" as QuestionType,
      question: null,
      why: "Not enough signal to generate questions. This usually means the corpus has no AMBIGUOUS edges, no bridge nodes, no INFERRED relationships, and all communities are tightly cohesive. Add more files or run with --mode deep to extract richer edges.",
    }];
  }

  return questions.slice(0, topN);
}

/** Compare two graph snapshots and return what changed. */
export function graphDiff(gOld: Graph, gNew: Graph): GraphDiff {
  const oldNodes = new Set<string>();
  const newNodes = new Set<string>();
  gOld.forEachNode((node) => { oldNodes.add(node); });
  gNew.forEachNode((node) => { newNodes.add(node); });

  const addedNodeIds = new Set<string>();
  const removedNodeIds = new Set<string>();
  for (const n of newNodes) { if (!oldNodes.has(n)) addedNodeIds.add(n); }
  for (const n of oldNodes) { if (!newNodes.has(n)) removedNodeIds.add(n); }

  const newNodesList: DiffNodeEntry[] = [];
  const removedNodesList: DiffNodeEntry[] = [];
  for (const n of addedNodeIds) {
    const attrs = getNodeAttributes(gNew, n);
    newNodesList.push({ id: n, label: (attrs.label as string) || n });
  }
  for (const n of removedNodeIds) {
    const attrs = getNodeAttributes(gOld, n);
    removedNodesList.push({ id: n, label: (attrs.label as string) || n });
  }

  const isDirected = (g: Graph): boolean => g.type === "directed";

  const edgeKey = (g: Graph, u: string, v: string, attrs: Record<string, unknown>): string => {
    const rel = (attrs.relation as string) || "";
    if (isDirected(g)) return `${u}\0${v}\0${rel}`;
    return u < v ? `${u}\0${v}\0${rel}` : `${v}\0${u}\0${rel}`;
  };

  const oldEdgeKeys = new Set<string>();
  const oldEdgeData = new Map<string, { u: string; v: string; attrs: Record<string, unknown> }>();
  gOld.forEachEdge((_edge, edgeAttrs, u, v) => {
    const attrs = edgeAttrs as Record<string, unknown>;
    const key = edgeKey(gOld, u, v, attrs);
    oldEdgeKeys.add(key);
    oldEdgeData.set(key, { u, v, attrs });
  });

  const newEdgeKeys = new Set<string>();
  const newEdgeData = new Map<string, { u: string; v: string; attrs: Record<string, unknown> }>();
  gNew.forEachEdge((_edge, edgeAttrs, u, v) => {
    const attrs = edgeAttrs as Record<string, unknown>;
    const key = edgeKey(gNew, u, v, attrs);
    newEdgeKeys.add(key);
    newEdgeData.set(key, { u, v, attrs });
  });

  const addedEdgeKeys = new Set<string>();
  const removedEdgeKeys = new Set<string>();
  for (const k of newEdgeKeys) { if (!oldEdgeKeys.has(k)) addedEdgeKeys.add(k); }
  for (const k of oldEdgeKeys) { if (!newEdgeKeys.has(k)) removedEdgeKeys.add(k); }

  const newEdgesList: DiffEdgeEntry[] = [];
  for (const k of addedEdgeKeys) {
    const data = newEdgeData.get(k)!;
    newEdgesList.push({
      source: data.u,
      target: data.v,
      relation: (data.attrs.relation as string) || "",
      confidence: (data.attrs.confidence as string) || "",
    });
  }

  const removedEdgesList: DiffEdgeEntry[] = [];
  for (const k of removedEdgeKeys) {
    const data = oldEdgeData.get(k)!;
    removedEdgesList.push({
      source: data.u,
      target: data.v,
      relation: (data.attrs.relation as string) || "",
      confidence: (data.attrs.confidence as string) || "",
    });
  }

  const parts: string[] = [];
  if (newNodesList.length > 0) {
    parts.push(`${newNodesList.length} new node${newNodesList.length !== 1 ? "s" : ""}`);
  }
  if (newEdgesList.length > 0) {
    parts.push(`${newEdgesList.length} new edge${newEdgesList.length !== 1 ? "s" : ""}`);
  }
  if (removedNodesList.length > 0) {
    parts.push(`${removedNodesList.length} node${removedNodesList.length !== 1 ? "s" : ""} removed`);
  }
  if (removedEdgesList.length > 0) {
    parts.push(`${removedEdgesList.length} edge${removedEdgesList.length !== 1 ? "s" : ""} removed`);
  }
  const summary = parts.length > 0 ? parts.join(", ") : "no changes";

  return {
    newNodes: newNodesList,
    removedNodes: removedNodesList,
    newEdges: newEdgesList,
    removedEdges: removedEdgesList,
    summary,
  };
}

/** Detect circular import dependencies at the file level. */
export function findImportCycles(
  graph: Graph,
  maxCycleLength: number = 5,
  topN: number = 20,
): ImportCycle[] {
  const endpointSourceFile = (nodeId: string): string => {
    if (!hasNode(graph, nodeId)) return "";
    const attrs = getNodeAttributes(graph, nodeId);
    const sf = attrs.source_file;
    return typeof sf === "string" ? sf : "";
  };

  // Step 1: Build a directed file-level graph from import/re-export edges
  const fileGraph = new DirectedGraph();

  graph.forEachEdge((_edge, edgeAttrs, u, v) => {
    const attrs = edgeAttrs as Record<string, unknown>;
    const rel = (attrs.relation as string) || "";
    if (rel !== "imports_from" && rel !== "re_exports") return;

    const srcFileAttr = attrs.source_file;
    if (typeof srcFileAttr !== "string" || !srcFileAttr) return;

    const uFile = endpointSourceFile(u);
    const vFile = endpointSourceFile(v);

    let tgtFile: string;
    if (uFile === srcFileAttr) {
      tgtFile = vFile;
    } else if (vFile === srcFileAttr) {
      tgtFile = uFile;
    } else {
      // Fallback
      tgtFile = (vFile && vFile !== srcFileAttr) ? vFile : uFile;
    }

    if (!tgtFile) return;

    if (!fileGraph.hasNode(srcFileAttr)) fileGraph.addNode(srcFileAttr);
    if (!fileGraph.hasNode(tgtFile)) fileGraph.addNode(tgtFile);
    if (!fileGraph.hasEdge(srcFileAttr, tgtFile)) {
      fileGraph.addEdge(srcFileAttr, tgtFile);
    }
  });

  if (fileGraph.size === 0) return [];

  // Step 2: Find simple cycles
  const rawCycles = simpleCycles(fileGraph, maxCycleLength, topN);

  // Step 3: Sort by length, deduplicate rotations
  rawCycles.sort((a, b) => a.length - b.length);

  const seen = new Set<string>();
  const uniqueCycles: string[][] = [];
  for (const cycle of rawCycles) {
    // cycle includes the start node repeated at the end; the "core" is without the last element
    const core = cycle.slice(0, -1);
    if (core.length === 0) continue;
    const minIdx = core.indexOf(core.reduce((a, b) => a < b ? a : b));
    const normalized = [...core.slice(minIdx), ...core.slice(0, minIdx)];
    const key = normalized.join("\0");
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCycles.push(normalized);
      if (uniqueCycles.length >= topN) break;
    }
  }

  return uniqueCycles.map((cycle) => ({
    cycle,
    length: cycle.length,
    why: "circular dependency",
  }));
}
