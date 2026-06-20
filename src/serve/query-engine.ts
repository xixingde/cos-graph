// Graph query engine -- search, score, traverse, and render knowledge-graph subgraphs.
// Ported from graphify/serve.py lines 1-510.

import Graph from "graphology";
import { DirectedGraph } from "graphology";
import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";

import { graphFromJSON } from "../graph/factory.js";
import { sanitizeLabel, checkGraphFileSizeCap } from "../security.js";
import { logQuery } from "../querylog.js";

// ── Stop words for English query filtering ──────────────────────────────────

const STOP_WORDS: Set<string> = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "but", "and", "or", "if", "while", "about", "up",
  "it", "its", "this", "that", "these", "those", "what", "which", "who",
  "whom", "i", "me", "my", "we", "us", "our", "you", "your", "he",
  "him", "his", "she", "her", "they", "them", "their",
]);

// ── Scoring constants ──────────────────────────────────────────────────────

const EXACT_MATCH_BONUS = 1000.0;
const PREFIX_MATCH_BONUS = 100.0;
const SUBSTRING_MATCH_BONUS = 1.0;
const SOURCE_MATCH_BONUS = 0.5;

// ── Graph loading ──────────────────────────────────────────────────────────

/** Load a graph from a JSON file, returning an empty graph on error. */
export function loadGraph(graphPath: string): Graph {
  try {
    const resolved = path.resolve(graphPath);
    if (path.extname(resolved) !== ".json") {
      throw new ValueError(`Graph path must be a .json file, got: ${JSON.stringify(graphPath)}`);
    }
    if (!fs.existsSync(resolved)) {
      throw new FileNotFoundError(`Graph file not found: ${resolved}`);
    }
    checkGraphFileSizeCap(resolved);
    const raw = fs.readFileSync(resolved, "utf-8");
    const data = JSON.parse(raw);
    if (!data.links && data.edges) {
      data.links = data.edges;
    }
    data.directed = true;
    return graphFromJSON(data);
  } catch (exc: any) {
    if (exc instanceof ValueError || exc instanceof FileNotFoundError) {
      process.stderr.write(`error: ${exc.message}\n`);
    } else if (exc instanceof SyntaxError) {
      process.stderr.write(`error: graph.json is corrupted (${exc.message}). Re-run /graphify to rebuild.\n`);
    } else {
      process.stderr.write(`error: ${exc}\n`);
    }
    return new Graph();
  }
}

/** Custom error types mirroring Python's ValueError/FileNotFoundError. */
class ValueError extends Error { constructor(m: string) { super(m); } }
class FileNotFoundError extends Error { constructor(m: string) { super(m); } }

// ── Community extraction ───────────────────────────────────────────────────

/** Reconstruct community dict from community property stored on nodes. */
export function communitiesFromGraph(graph: Graph): Record<number, string[]> {
  const communities: Record<number, string[]> = {};
  graph.forEachNode((nid, attrs) => {
    const cid = attrs.community;
    if (cid !== undefined && cid !== null) {
      const key = Number(cid);
      if (!communities[key]) communities[key] = [];
      communities[key].push(nid);
    }
  });
  return communities;
}

// ── Diacritics / text normalization ────────────────────────────────────────

/** Strip combining diacritical marks (NFD decomposition, remove marks). */
export function stripDiacritics(text: string | null): string {
  if (text === null) return "";
  if (typeof text !== "string") text = String(text);
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Split text into word tokens, stripping punctuation and diacritics. */
function searchTokens(text: string): string[] {
  return (stripDiacritics(String(text)).toLowerCase().match(/\w+/g) || []);
}

// ── Chinese segmentation ───────────────────────────────────────────────────

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/** Segment Chinese text; without jieba, uses character-level bigrams.
 *  TODO: integrate jieba-style segmentation for better CJK support. */
function segmentChinese(text: string): string[] {
  // No jieba in Node; use character-level bigrams as fallback
  const segments: string[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    segments.push(text.substring(i, i + 2));
  }
  if (segments.length === 0 && text.length > 0) {
    segments.push(text);
  }
  // Keep the original term for exact matching
  if (text.length > 1 && !segments.includes(text)) {
    segments.push(text);
  }
  return segments;
}

// ── Searchability check ────────────────────────────────────────────────────

/** True if term is Chinese, non-English, or an English word longer than 2 chars. */
export function isSearchable(term: string): boolean {
  if (/^[a-z]+$/.test(term)) {
    return term.length > 2;
  }
  return true;
}

// ── Query terms ────────────────────────────────────────────────────────────

/** Split a query into searchable terms, segmenting Chinese text. */
export function queryTerms(question: string): string[] {
  const terms: string[] = [];
  for (const raw of question.split(/\s+/)) {
    if (hasChinese(raw)) {
      for (const seg of segmentChinese(raw.toLowerCase().trim())) {
        const s = seg.trim();
        if (s && isSearchable(s)) {
          terms.push(s);
        }
      }
    } else {
      for (const tok of (raw.toLowerCase().match(/\w+/g) || [])) {
        if (isSearchable(tok)) {
          terms.push(tok);
        }
      }
    }
  }
  return terms;
}

// ── IDF computation ────────────────────────────────────────────────────────

/** IDF weights for query terms, cached on the graph object itself.
 *  Cache auto-invalidates when maybeReload() replaces the graph. */
export function computeIdf(graph: Graph, terms: string[]): Record<string, number> {
  const gAttr = graph.getAttributes() as any;
  if (!gAttr._idfCache) gAttr._idfCache = {};
  const cache: Record<string, number> = gAttr._idfCache;
  const N = graph.order || 1;
  const uncached = terms.filter(t => !(t in cache));
  if (uncached.length > 0) {
    const df: Record<string, number> = {};
    for (const t of uncached) df[t] = 0;
    graph.forEachNode((_nid, data) => {
      const normLabel = (data.norm_label || stripDiacritics(data.label || "")).toLowerCase();
      for (const t of uncached) {
        if (normLabel.includes(t)) df[t]++;
      }
    });
    for (const t of uncached) {
      cache[t] = Math.log(1 + N / (1 + df[t]));
    }
  }
  const result: Record<string, number> = {};
  for (const t of terms) {
    result[t] = cache[t] ?? Math.log(1 + N);
  }
  return result;
}

// ── Node scoring ───────────────────────────────────────────────────────────

/** Score nodes against query terms using TF-IDF-like weighting.
 *  Returns sorted [score, nodeId][] (highest score first). */
export function scoreNodes(graph: Graph, terms: string[]): [number, string][] {
  const scored: [number, string][] = [];
  const normTerms = terms.flatMap(t => searchTokens(t));
  const idf = computeIdf(graph, normTerms);
  const joined = normTerms.join(" ");
  const joinedW = Math.max(1.0, ...normTerms.map(t => idf[t] ?? 1.0));

  graph.forEachNode((nid, data) => {
    const normLabel = (data.norm_label || stripDiacritics(data.label || "")).toLowerCase();
    const bareLabel = normLabel.replace(/\(\)$/, "");
    const labelTokens = searchTokens(data.label || "").join(" ");
    const source = (data.source_file || "").toLowerCase();
    let score = 0.0;

    // Full-query tier: a multi-word query that equals/starts-with the whole
    // label must dominate per-token sums so path/query resolve the same node.
    if (joined) {
      const nidLower = nid.toLowerCase();
      if (joined === normLabel || joined === bareLabel || joined === labelTokens || joined === nidLower) {
        score += EXACT_MATCH_BONUS * 10 * joinedW;
      } else if (
        normLabel.startsWith(joined) ||
        bareLabel.startsWith(joined) ||
        labelTokens.startsWith(joined)
      ) {
        score += PREFIX_MATCH_BONUS * 10 * joinedW;
      }
    }

    for (const t of normTerms) {
      const w = idf[t] ?? 1.0;
      // Three-tier precedence: exact > prefix > substring
      if (t === normLabel || t === bareLabel) {
        score += EXACT_MATCH_BONUS * w;
      } else if (normLabel.startsWith(t) || bareLabel.startsWith(t)) {
        score += PREFIX_MATCH_BONUS * w;
      } else if (normLabel.includes(t)) {
        score += SUBSTRING_MATCH_BONUS * w;
      }
      if (source.includes(t)) {
        score += SOURCE_MATCH_BONUS * w;
      }
    }

    if (score > 0) {
      scored.push([score, nid]);
    }
  });

  // Sort by score desc; break ties toward shorter label, then by node id
  scored.sort((a, b) => {
    if (b[0] !== a[0]) return b[0] - a[0];
    const la = graph.getNodeAttributes(a[1]).label || a[1];
    const lb = graph.getNodeAttributes(b[1]).label || b[1];
    if (la.length !== lb.length) return la.length - lb.length;
    return a[1].localeCompare(b[1]);
  });
  return scored;
}

// ── Seed selection ──────────────────────────────────────────────────────────

/** Select BFS seed nodes, stopping when score drops too far below the top. */
export function pickSeeds(
  scored: [number, string][],
  maxK: number = 3,
  gapRatio: number = 0.2
): string[] {
  if (scored.length === 0) return [];
  const topScore = scored[0][0];
  const seeds: string[] = [];
  for (const [score, nid] of scored.slice(0, maxK)) {
    if (seeds.length > 0 && score < topScore * gapRatio) break;
    seeds.push(nid);
  }
  return seeds;
}

// ── Context filters ────────────────────────────────────────────────────────

export const CONTEXT_HINTS: [string, string[]][] = [
  ["call", ["call", "calls", "called", "invoke", "invokes", "invoked"]],
  ["import", ["import", "imports", "imported", "module", "modules"]],
  ["field", ["field", "fields", "member", "members", "property", "properties"]],
  ["parameter_type", ["parameter", "parameters", "param", "params", "argument", "arguments"]],
  ["return_type", ["return", "returns", "returned"]],
  ["generic_arg", ["generic", "generics", "template", "templates"]],
];

export const CONTEXT_FILTER_ALIASES: Record<string, string> = {
  param: "parameter_type",
  params: "parameter_type",
  parameter: "parameter_type",
  parameters: "parameter_type",
  argument: "parameter_type",
  arguments: "parameter_type",
  arg: "parameter_type",
  args: "parameter_type",
  return: "return_type",
  returns: "return_type",
  returned: "return_type",
  generic: "generic_arg",
  generics: "generic_arg",
  template: "generic_arg",
  templates: "generic_arg",
  annotation: "attribute",
  annotations: "attribute",
  decorator: "attribute",
  decorators: "attribute",
  calls: "call",
  called: "call",
  invoke: "call",
  invocation: "call",
  fields: "field",
  property: "field",
  properties: "field",
  member: "field",
  members: "field",
  imports: "import",
  imported: "import",
  module: "import",
  modules: "import",
  exports: "export",
  exported: "export",
};

/** Normalize and deduplicate context filter aliases. */
export function normalizeContextFilters(filters: string[] | null): string[] {
  if (!filters) return [];
  const normalized: string[] = [];
  const seen: Set<string> = new Set();
  for (const value of filters) {
    let key = stripDiacritics(String(value)).trim().toLowerCase();
    if (!key) continue;
    key = CONTEXT_FILTER_ALIASES[key] ?? key;
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(key);
    }
  }
  return normalized;
}

/** Infer context filters from the question text using hint mapping. */
export function inferContextFilters(question: string): string[] {
  const lowered = new Set(
    question.replace(/\?/g, " ").replace(/,/g, " ").split(/\s+/)
      .map(t => stripDiacritics(t).toLowerCase())
  );
  const inferred: string[] = [];
  for (const [context, hints] of CONTEXT_HINTS) {
    if (hints.some(hint => lowered.has(hint))) {
      inferred.push(context);
    }
  }
  return inferred;
}

/** Resolve context filters: prefer explicit, fall back to heuristic inference. */
export function resolveContextFilters(
  question: string,
  explicitFilters?: string[] | null
): [string[], string | null] {
  const normalized = normalizeContextFilters(explicitFilters ?? null);
  if (normalized.length > 0) return [normalized, "explicit"];
  const inferred = inferContextFilters(question);
  if (inferred.length > 0) return [inferred, "heuristic"];
  return [[], null];
}

/** Filter graph edges by context, keeping all nodes but only matching edges. */
export function filterGraphByContext(
  graph: Graph,
  contextFilters: string[] | null
): Graph {
  const filters = new Set(normalizeContextFilters(contextFilters));
  if (filters.size === 0) return graph;

  const H = new DirectedGraph();
  // Copy all nodes
  graph.forEachNode((nid, attrs) => {
    H.addNode(nid, { ...attrs });
  });
  // Copy only edges whose context matches a filter
  graph.forEachEdge((_key, attrs, src, tgt) => {
    if (filters.has(attrs.context)) {
      if (H.hasNode(src) && H.hasNode(tgt)) {
        H.addEdge(src, tgt, { ...attrs });
      }
    }
  });
  return H;
}

// ── Traversal (BFS / DFS) ──────────────────────────────────────────────────

/** Helper: compute hub threshold from degree distribution (p99, floored at 50). */
function hubThreshold(graph: Graph): number {
  const degrees: number[] = [];
  graph.forEachNode((nid) => {
    degrees.push(graph.degree(nid));
  });
  if (degrees.length === 0) return 50;
  degrees.sort((a, b) => a - b);
  const p99Idx = Math.floor(degrees.length * 0.99);
  return Math.max(50, degrees[p99Idx]);
}

/** Get edge data between two nodes, handling multi-edges. */
export function edgeData(graph: Graph, u: string, v: string): Record<string, unknown> {
  if (graph.hasEdge(u, v)) {
    const edges = graph.edges(u, v);
    if (edges.length > 0) {
      return graph.getEdgeAttributes(edges[0]);
    }
  }
  // Try reverse direction for undirected traversal
  if (graph.hasEdge(v, u)) {
    const edges = graph.edges(v, u);
    if (edges.length > 0) {
      return graph.getEdgeAttributes(edges[0]);
    }
  }
  return {};
}

/** BFS traversal from start nodes. Hub nodes (degree >= threshold) are not
 *  expanded except when they are seed nodes. Returns visited set + edge list. */
export function bfs(
  graph: Graph,
  startNodes: string[],
  depth: number
): [Set<string>, [string, string, Record<string, unknown>][]] {
  const threshold = hubThreshold(graph);
  const seedSet = new Set(startNodes);
  const visited = new Set(startNodes);
  const frontier = new Set(startNodes);
  const edgesSeen: [string, string, Record<string, unknown>][] = [];

  for (let i = 0; i < depth; i++) {
    const nextFrontier = new Set<string>();
    for (const n of frontier) {
      if (!seedSet.has(n) && graph.degree(n) >= threshold) continue;
      for (const neighbor of graph.neighbors(n)) {
        if (!visited.has(neighbor)) {
          nextFrontier.add(neighbor);
          edgesSeen.push([n, neighbor, edgeData(graph, n, neighbor)]);
        }
      }
    }
    for (const n of nextFrontier) visited.add(n);
    frontier.clear();
    for (const n of nextFrontier) frontier.add(n);
  }
  return [visited, edgesSeen];
}

/** DFS traversal from start nodes. Hub threshold applies same as BFS. */
export function dfs(
  graph: Graph,
  startNodes: string[],
  depth: number
): [Set<string>, [string, string, Record<string, unknown>][]] {
  const threshold = hubThreshold(graph);
  const seedSet = new Set(startNodes);
  const visited = new Set<string>();
  const edgesSeen: [string, string, Record<string, unknown>][] = [];
  // Stack entries: [nodeId, currentDepth]
  const stack: [string, number][] = [...startNodes].reverse().map(n => [n, 0]);

  while (stack.length > 0) {
    const [node, d] = stack.pop()!;
    if (visited.has(node) || d > depth) continue;
    visited.add(node);
    if (!seedSet.has(node) && graph.degree(node) >= threshold) continue;
    for (const neighbor of graph.neighbors(node)) {
      if (!visited.has(neighbor)) {
        stack.push([neighbor, d + 1]);
        edgesSeen.push([node, neighbor, edgeData(graph, node, neighbor)]);
      }
    }
  }
  return [visited, edgesSeen];
}

// ── Subgraph to text ───────────────────────────────────────────────────────

/** Render subgraph as text, cutting at tokenBudget (approx 3 chars/token).
 *  Seeds are rendered first before degree-sorted expansion.
 *  All LLM-derived fields are sanitized via sanitizeLabel (F-010). */
export function subgraphToText(
  graph: Graph,
  nodes: Set<string>,
  edges: [string, string, Record<string, unknown>][],
  tokenBudget: number = 2000,
  seeds?: string[]
): string {
  const charBudget = tokenBudget * 3;
  const lines: string[] = [];
  const seedSet = new Set(seeds || []);
  const ordered = [
    ...(seeds || []).filter(n => nodes.has(n)),
    ...sortedByDegreeDesc(graph, setDifference(nodes, seedSet)),
  ];

  for (const nid of ordered) {
    const d = graph.getNodeAttributes(nid);
    // Every LLM-derived field passes through sanitizeLabel (F-010)
    const line =
      `NODE ${sanitizeLabel(d.label || nid)} ` +
      `[src=${sanitizeLabel(String(d.source_file || ""))} ` +
      `loc=${sanitizeLabel(String(d.source_location || ""))} ` +
      `community=${sanitizeLabel(String(d.community_name || d.community || ""))}]`;
    lines.push(line);
  }

  for (const [u, v, ed] of edges) {
    if (nodes.has(u) && nodes.has(v)) {
      const ctx = ed.context;
      const contextSuffix = ctx ? ` context=${sanitizeLabel(String(ctx))}` : "";
      const line =
        `EDGE ${sanitizeLabel(graph.getNodeAttributes(u).label || u)} ` +
        `--${sanitizeLabel(String(ed.relation || ""))} ` +
        `[${sanitizeLabel(String(ed.confidence || ""))}${contextSuffix}]--> ` +
        `${sanitizeLabel(graph.getNodeAttributes(v).label || v)}`;
      lines.push(line);
    }
  }

  let output = lines.join("\n");
  if (output.length > charBudget) {
    const cutAt = output.lastIndexOf("\n", charBudget) || charBudget;
    const totalNodes = lines.filter(l => l.startsWith("NODE ")).length;
    const shownNodes = output.substring(0, cutAt).split("\n").filter(l => l.startsWith("NODE ")).length;
    const cutCount = totalNodes - shownNodes;
    output =
      output.substring(0, cutAt) +
      `\n... (truncated -- ${cutCount} more nodes cut by ~${tokenBudget}-token budget.` +
      ` Narrow with context_filter=['call'] or use get_node for a specific symbol)`;
  }
  return output;
}

/** Sort nodes by degree descending. */
function sortedByDegreeDesc(graph: Graph, nodeIds: Iterable<string>): string[] {
  return [...nodeIds].sort((a, b) => graph.degree(b) - graph.degree(a));
}

/** Set difference: A - B. */
function setDifference(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const item of a) {
    if (!b.has(item)) result.add(item);
  }
  return result;
}

// ── Full query pipeline ────────────────────────────────────────────────────

/** Complete graph query: resolve context -> score -> seed -> traverse -> render. */
export function queryGraphText(
  graph: Graph,
  communities: Record<number, string[]>,
  question: string,
  contextFilters?: string[] | null,
  mode: string = "bfs",
  depth: number = 3,
  tokenBudget: number = 2000
): string {
  const terms = queryTerms(question);
  const scored = scoreNodes(graph, terms);
  const startNodes = pickSeeds(scored);
  if (startNodes.length === 0) return "No matching nodes found.";

  const [resolvedFilters, filterSource] = resolveContextFilters(question, contextFilters);
  const traversalGraph = filterGraphByContext(graph, resolvedFilters);
  const [nodes, edges] = mode === "dfs"
    ? dfs(traversalGraph, startNodes, depth)
    : bfs(traversalGraph, startNodes, depth);

  const headerParts = [
    `Traversal: ${mode.toUpperCase()} depth=${depth}`,
    `Start: [${startNodes.map(n => graph.getNodeAttributes(n).label || n).join(", ")}]`,
  ];
  if (resolvedFilters.length > 0) {
    headerParts.push(`Context: ${resolvedFilters.join(", ")} (${filterSource})`);
  }
  headerParts.push(`${nodes.size} nodes found`);
  const header = headerParts.join(" | ") + "\n\n";

  return header + subgraphToText(traversalGraph, nodes, edges, tokenBudget, startNodes);
}

// ── Node finding ───────────────────────────────────────────────────────────

/** Return node IDs whose label or ID matches the search term (diacritic-insensitive).
 *  Results ordered by three-tier precedence: exact, prefix, substring. */
export function findNode(graph: Graph, label: string): string[] {
  const term = searchTokens(label).join(" ");
  if (!term) return [];
  const exact: string[] = [];
  const prefix: string[] = [];
  const substring: string[] = [];

  graph.forEachNode((nid, d) => {
    const normLabel = (d.norm_label || stripDiacritics(d.label || "")).toLowerCase();
    const bareLabel = normLabel.replace(/\(\)$/, "");
    const labelTokens = searchTokens(d.label || "").join(" ");
    const nidLower = nid.toLowerCase();
    if (term === normLabel || term === bareLabel || term === labelTokens || term === nidLower) {
      exact.push(nid);
    } else if (
      normLabel.startsWith(term) ||
      bareLabel.startsWith(term) ||
      labelTokens.startsWith(term) ||
      nidLower.startsWith(term)
    ) {
      prefix.push(nid);
    } else if (normLabel.includes(term) || labelTokens.includes(term)) {
      substring.push(nid);
    }
  });

  return [...exact, ...prefix, ...substring];
}
