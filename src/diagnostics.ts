// Read-only diagnostics for MultiDiGraph readiness

import * as fs from "fs";
import * as path from "path";

import Graph from "graphology";
import { buildFromJson } from "./build.js";
import { checkGraphFileSizeCap } from "./security.js";

const _SUPPRESSION_DECL_RE = /^\s*(?<name>seen_[A-Za-z0-9_]+)\s*[:=]/;
const _TYPE_TUPLE_RE = /set\[tuple\[(?<inside>[^\]]+)\]\]/;

export interface ProducerSuppressionResult {
  path: string;
  total_sites: number;
  sites: any[];
  error: string;
}

export interface DiagnoseOptions {
  directed?: boolean | null;
  root?: string;
  max_examples?: number;
  extractPath?: string;
}

export interface DiagnoseFileOptions {
  directed?: boolean | null;
  root?: string;
  max_examples?: number;
  extractPath?: string;
}

export interface DiagnosticSummary extends Record<string, any> {}

function _safeText(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, Object.keys(value).sort(), 0);
}

function _edgeList(extraction: Record<string, any>): any[] {
  let edges = extraction.edges;
  if (edges === undefined || edges === null) {
    edges = extraction.links;
  }
  return Array.isArray(edges) ? edges : [];
}

function _nodeIds(extraction: Record<string, any>): Set<string> {
  const nodes = extraction.nodes;
  if (!Array.isArray(nodes)) {
    return new Set();
  }
  const ids = new Set<string>();
  for (const node of nodes) {
    if (typeof node === "object" && node !== null && !Array.isArray(node) && "id" in node && node.id != null) {
      ids.add(String(node.id));
    }
  }
  return ids;
}

function _canonicalEdge(edge: any): Record<string, string> {
  if (typeof edge !== "object" || edge === null || Array.isArray(edge)) {
    return {
      source: "",
      target: "",
      relation: "",
      confidence: "",
      source_file: "",
      source_location: "",
      context: "",
      _invalid: "non_object_edge",
    };
  }
  const source = edge.source ?? edge.from;
  const target = edge.target ?? edge.to;
  return {
    source: _safeText(source),
    target: _safeText(target),
    relation: _safeText(edge.relation),
    confidence: _safeText(edge.confidence),
    source_file: _safeText(edge.source_file),
    source_location: _safeText(edge.source_location),
    context: _safeText(edge.context),
    _invalid: "",
  };
}

function _exactSignature(edge: any): string {
  if (typeof edge !== "object" || edge === null || Array.isArray(edge)) {
    return "<non-object>";
  }
  const normalized: Record<string, any> = { ...edge };
  if (!("source" in normalized) && "from" in normalized) {
    normalized.source = normalized.from;
  }
  if (!("target" in normalized) && "to" in normalized) {
    normalized.target = normalized.to;
  }
  delete normalized.from;
  delete normalized.to;
  const keys = Object.keys(normalized).sort();
  const sorted: Record<string, any> = {};
  for (const k of keys) {
    sorted[k] = normalized[k];
  }
  return JSON.stringify(sorted);
}

function _countExtra(counter: Map<string, number>): number {
  let extra = 0;
  for (const count of counter.values()) {
    if (count > 1) extra += count - 1;
  }
  return extra;
}

function _variantGroupCount(
  groupedEdges: Map<string, any[]>,
  field: string,
  options: { relationSensitive?: boolean } = {}
): number {
  let groups = 0;
  for (const edges of groupedEdges.values()) {
    if (options.relationSensitive) {
      const byRelation: Map<string, Set<string>> = new Map();
      for (const edge of edges) {
        const rel = edge.relation || "";
        if (!byRelation.has(rel)) byRelation.set(rel, new Set());
        byRelation.get(rel)!.add(edge[field] || "");
      }
      for (const values of byRelation.values()) {
        if (values.size > 1) groups++;
      }
    } else {
      const values = new Set(edges.map((e: any) => e[field] || ""));
      if (values.size > 1) groups++;
    }
  }
  return groups;
}

function _tupleArityFromAnnotation(line: string): number {
  const match = _TYPE_TUPLE_RE.exec(line);
  if (!match || !match.groups) return 0;
  const inside = (match.groups.inside || "").trim();
  if (!inside) return 0;
  return inside.split(",").length;
}

export function scanProducerSuppressionSites(filePath: string): ProducerSuppressionResult {
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      total_sites: 0,
      sites: [],
      error: "file not found",
    };
  }

  const sites: any[] = [];
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n|\r/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = _SUPPRESSION_DECL_RE.exec(line);
    if (!match || !match.groups) continue;
    sites.push({
      line: i + 1,
      name: match.groups.name,
      tuple_arity: _tupleArityFromAnnotation(line),
      sample: line.trim().slice(0, 120),
    });
  }

  return {
    path: filePath,
    total_sites: sites.length,
    sites,
    error: "",
  };
}

export function diagnoseExtraction(
  extraction: Record<string, any>,
  options: DiagnoseOptions = {}
): DiagnosticSummary {
  const directed = options.directed !== null && options.directed !== undefined ? options.directed : true;
  const maxExamples = options.max_examples ?? 5;

  const nodeIds = _nodeIds(extraction);
  const rawEdges = _edgeList(extraction);
  const canonicalEdges = rawEdges.map((e: any) => _canonicalEdge(e));

  const exactCounts: Map<string, number> = new Map();
  for (const edge of rawEdges) {
    const sig = _exactSignature(edge);
    exactCounts.set(sig, (exactCounts.get(sig) || 0) + 1);
  }

  const directedPairs: Map<string, number> = new Map();
  const undirectedPairs: Map<string, number> = new Map();
  const grouped: Map<string, any[]> = new Map();

  let nonObjectEdges = 0;
  let missingEndpointEdges = 0;
  let danglingEndpointEdges = 0;
  let selfLoopEdges = 0;
  let validCandidateEdges = 0;

  for (const edge of canonicalEdges) {
    if (edge._invalid) {
      nonObjectEdges++;
      continue;
    }
    const source = edge.source;
    const target = edge.target;
    if (!source || !target) {
      missingEndpointEdges++;
      continue;
    }
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      danglingEndpointEdges++;
      continue;
    }
    if (source === target) {
      selfLoopEdges++;
    }
    validCandidateEdges++;

    const directedKey = `${source}\0${target}`;
    directedPairs.set(directedKey, (directedPairs.get(directedKey) || 0) + 1);

    const undirectedKey = source <= target ? `${source}\0${target}` : `${target}\0${source}`;
    undirectedPairs.set(undirectedKey, (undirectedPairs.get(undirectedKey) || 0) + 1);

    if (!grouped.has(directedKey)) grouped.set(directedKey, []);
    grouped.get(directedKey)!.push(edge);
  }

  // Sort directed pairs by count descending for examples
  const sortedPairs = [...directedPairs.entries()].sort((a, b) => b[1] - a[1]);

  const examples: any[] = [];
  if (maxExamples > 0) {
    for (const [key, count] of sortedPairs) {
      if (count < 2) continue;
      const [source, target] = key.split("\0");
      const edges = grouped.get(key) || [];
      examples.push({
        source,
        target,
        edge_count: count,
        relations: [...new Set(edges.map((e: any) => e.relation))].sort(),
        source_files: [...new Set(edges.map((e: any) => e.source_file))].sort(),
        source_locations: [...new Set(edges.map((e: any) => e.source_location))].sort(),
        contexts: [...new Set(edges.map((e: any) => e.context))].sort(),
      });
      if (examples.length >= maxExamples) break;
    }
  }

  let buildError = "";
  let graphType = "";
  let postBuildEdgeCount: number | null = null;
  let postBuildNodeCount: number | null = null;
  try {
    const graphInput = JSON.parse(JSON.stringify(extraction));
    const graph: Graph = buildFromJson(graphInput, { directed, root: options.root });
    graphType = graph.type || "directed";
    postBuildEdgeCount = graph.size;
    postBuildNodeCount = graph.order;
  } catch (exc: any) {
    buildError = `${exc.constructor?.name || "Error"}: ${exc.message || exc}`;
  }

  const suppressionPath = options.extractPath || "";

  const suppression = suppressionPath
    ? scanProducerSuppressionSites(suppressionPath)
    : { path: "", total_sites: 0, sites: [], error: "no extract path provided" };

  return {
    node_count: nodeIds.size,
    raw_edge_count: rawEdges.length,
    non_object_edges: nonObjectEdges,
    missing_endpoint_edges: missingEndpointEdges,
    dangling_endpoint_edges: danglingEndpointEdges,
    self_loop_edges: selfLoopEdges,
    valid_candidate_edges: validCandidateEdges,
    exact_duplicate_edges: _countExtra(exactCounts),
    directed_unique_endpoint_pairs: directedPairs.size,
    directed_same_endpoint_collapsed_edges: _countExtra(directedPairs),
    undirected_unique_endpoint_pairs: undirectedPairs.size,
    undirected_same_endpoint_collapsed_edges: _countExtra(undirectedPairs),
    same_endpoint_group_count: [...directedPairs.values()].filter((c) => c > 1).length,
    relation_variant_groups: _variantGroupCount(grouped, "relation"),
    source_file_variant_groups: _variantGroupCount(grouped, "source_file", { relationSensitive: true }),
    source_location_variant_groups: _variantGroupCount(grouped, "source_location", { relationSensitive: true }),
    context_variant_groups: _variantGroupCount(grouped, "context", { relationSensitive: true }),
    post_build_graph_type: graphType,
    post_build_node_count: postBuildNodeCount,
    post_build_edge_count: postBuildEdgeCount,
    post_build_error: buildError,
    producer_suppression: suppression,
    examples,
  };
}

function _readJsonFile(filePath: string): Record<string, any> {
  checkGraphFileSizeCap(filePath);
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("diagnostic input must be a JSON object");
  }
  return data;
}

export function diagnoseFile(
  filePath: string,
  options: DiagnoseFileOptions = {}
): DiagnosticSummary {
  const data = _readJsonFile(filePath);
  let effectiveDirected: boolean;
  if (options.directed === null || options.directed === undefined) {
    const rawDirected = data.directed;
    effectiveDirected = typeof rawDirected === "boolean" ? rawDirected : true;
  } else {
    effectiveDirected = options.directed;
  }

  const summary = diagnoseExtraction(data, {
    directed: effectiveDirected,
    root: options.root,
    max_examples: options.max_examples,
    extractPath: options.extractPath,
  });
  summary.input_path = filePath;
  summary.effective_directed = effectiveDirected;
  return summary;
}

export function formatDiagnosticJson(summary: Record<string, any>): Record<string, any> {
  return {
    schema_version: 1,
    summary: Object.fromEntries(
      Object.entries(summary).filter(
        ([key]) => key !== "examples" && key !== "producer_suppression"
      )
    ),
    examples: summary.examples || [],
    producer_suppression: summary.producer_suppression || {},
    notes: [
      "Diagnostics are read-only.",
      "A normal graph.json is already post-build and cannot recover raw producer edges.",
      "Producer suppression sites are heuristic source-code evidence.",
    ],
  };
}

export function formatDiagnosticReport(summary: Record<string, any>): string {
  const suppression = summary.producer_suppression || {};
  const lines: string[] = [
    "[graphify] MultiDiGraph edge-collapse diagnostic",
    `input: ${summary.input_path || "<in-memory>"}`,
    "input_stage: provided JSON (normal graph.json is post-build)",
    `effective_directed: ${summary.effective_directed ?? "<direct-call>"}`,
    `nodes: ${summary.node_count}`,
    `raw_edges: ${summary.raw_edge_count}`,
    `valid_candidate_edges: ${summary.valid_candidate_edges}`,
    `missing_endpoint_edges: ${summary.missing_endpoint_edges}`,
    `dangling_endpoint_edges: ${summary.dangling_endpoint_edges}`,
    `self_loop_edges: ${summary.self_loop_edges}`,
    `exact_duplicate_edges: ${summary.exact_duplicate_edges}`,
    `directed_unique_endpoint_pairs: ${summary.directed_unique_endpoint_pairs}`,
    `directed_same_endpoint_collapsed_edges: ${summary.directed_same_endpoint_collapsed_edges}`,
    `undirected_unique_endpoint_pairs: ${summary.undirected_unique_endpoint_pairs}`,
    `undirected_same_endpoint_collapsed_edges: ${summary.undirected_same_endpoint_collapsed_edges}`,
    `same_endpoint_group_count: ${summary.same_endpoint_group_count}`,
    `relation_variant_groups: ${summary.relation_variant_groups}`,
    `source_file_variant_groups: ${summary.source_file_variant_groups}`,
    `source_location_variant_groups: ${summary.source_location_variant_groups}`,
    `context_variant_groups: ${summary.context_variant_groups}`,
    `post_build_graph_type: ${summary.post_build_graph_type}`,
    `post_build_edges: ${summary.post_build_edge_count}`,
    `producer_suppression_sites: ${suppression.total_sites || 0}`,
  ];
  if (summary.post_build_error) {
    lines.push(`post_build_error: ${summary.post_build_error}`);
  }
  if (suppression.error) {
    lines.push(`producer_suppression_error: ${suppression.error}`);
  }
  if (suppression.sites && suppression.sites.length > 0) {
    lines.push("producer_suppression_examples:");
    for (const site of suppression.sites.slice(0, 8)) {
      lines.push(
        `  - L${site.line} ${site.name} arity=${site.tuple_arity || "unknown"}`
      );
    }
  }
  if (summary.examples && summary.examples.length > 0) {
    lines.push("examples:");
    for (const example of summary.examples) {
      lines.push(
        `  - ${example.source} -> ${example.target} ` +
          `edges=${example.edge_count} ` +
          `relations=${example.relations} ` +
          `locations=${example.source_locations} ` +
          `contexts=${example.contexts}`
      );
    }
  }
  lines.push(
    "note: normal graph.json is post-build; raw producer loss must be measured earlier."
  );
  return lines.join("\n");
}
