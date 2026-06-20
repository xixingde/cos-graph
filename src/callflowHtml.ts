// callflowHtml.ts -- Generate call-flow architecture HTML from graphify knowledge graph outputs.
// Ported from graphify/callflow_html.py (2021 lines).

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

// ──────────────────────────────────────────────
// 1. CSS template (fixed, project-agnostic)
// ──────────────────────────────────────────────

export const CSS = `:root {
  --bg: #0f172a; --surface: #1e293b; --border: #334155;
  --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8;
  --warn: #fbbf24; --err: #f87171; --ok: #34d399;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; }
.container { max-width: 1200px; margin: 0 auto; padding: 40px 24px; }
h1 { font-size: 2.4rem; margin-bottom: 8px; background: linear-gradient(135deg, var(--accent), #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
h2 { font-size: 1.7rem; margin: 48px 0 16px; padding-bottom: 8px; border-bottom: 2px solid var(--accent); }
h3 { font-size: 1.25rem; margin: 32px 0 12px; color: var(--accent); }
h4 { font-size: 1.05rem; margin: 20px 0 8px; color: var(--warn); }
p { margin: 8px 0; color: var(--muted); }
.subtitle { color: var(--muted); font-size: 1.1rem; margin-bottom: 32px; }
.mermaid { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin: 20px 0; overflow-x: auto; position: relative; }
.mermaid.is-enhanced { padding: 0; overflow: hidden; min-height: 260px; }
.mermaid-viewport { padding: 54px 24px 24px; overflow: hidden; cursor: grab; touch-action: none; min-height: 260px; }
.mermaid-viewport.is-dragging { cursor: grabbing; }
.mermaid-viewport svg { max-width: none !important; height: auto; transform-origin: 0 0; transition: transform 120ms ease; }
.mermaid-toolbar { position: absolute; top: 10px; right: 10px; z-index: 3; display: flex; align-items: center; gap: 6px; padding: 6px; background: rgba(15,23,42,0.92); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.28); }
.mermaid-toolbar button, .mermaid-toolbar .zoom-level { height: 28px; min-width: 32px; border: 1px solid var(--border); border-radius: 6px; background: #1e293b; color: var(--text); font: 600 0.78rem system-ui, sans-serif; display: inline-flex; align-items: center; justify-content: center; }
.mermaid-toolbar button { cursor: pointer; }
.mermaid-toolbar button:hover { border-color: var(--accent); color: var(--accent); }
.mermaid-toolbar .zoom-level { min-width: 52px; color: var(--muted); background: transparent; }
.call-table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.92rem; }
.call-table th { background: #1a2744; color: var(--accent); text-align: left; padding: 10px 14px; border: 1px solid var(--border); }
.call-table td { padding: 8px 14px; border: 1px solid var(--border); vertical-align: top; }
.call-table tr:nth-child(even) { background: rgba(255,255,255,0.02); }
.tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }
.tag-async { background: #7c3aed33; color: #a78bfa; }
.tag-class { background: #05966933; color: var(--ok); }
.tag-func { background: #2563eb33; color: var(--accent); }
.tag-cmd { background: #d9770633; color: var(--warn); }
.tag-endpoint { background: #dc262633; color: var(--err); }
.tag-hook { background: #db277733; color: #f472b6; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin: 16px 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin: 16px 0; }
.arrow-chain { font-family: 'Fira Code', monospace; font-size: 0.85rem; color: var(--accent); padding: 10px; background: rgba(56,189,248,0.06); border-radius: 6px; }
code { font-family: 'Fira Code', 'Cascadia Code', monospace; background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 3px; font-size: 0.88em; }
ul, ol { margin: 8px 0 8px 24px; color: var(--muted); }
li { margin: 4px 0; }
a { color: var(--accent); }
hr { border: none; border-top: 1px solid var(--border); margin: 40px 0; }
.nav { position: sticky; top: 0; background: var(--bg); z-index: 10; padding: 12px 0; border-bottom: 1px solid var(--border); display: flex; gap: 20px; flex-wrap: wrap; font-size: 0.9rem; }
.nav a { text-decoration: none; }
.nav a:hover { text-decoration: underline; }
@media (max-width: 768px) { .container { padding: 16px; } h1 { font-size: 1.8rem; } }
`;

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface NormalizedNode extends Record<string, unknown> {
  id: string;
  label: string;
  community: unknown;
  source_file: string;
  node_type: string;
  file_type: string;
}

export interface NormalizedEdge extends Record<string, unknown> {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: string;
  confidence_score: number;
}

export interface Section {
  id: string;
  name: string;
  communities: unknown[];
}

export interface SectionArchetype {
  id: string;
  zhName: string;
  enName: string;
  keywords: Set<string>;
}

export interface ResolvedPaths {
  base: string;
  graphify_out: string;
  graph: string;
  report: string;
  labels: string;
  sections: string | undefined;
}

export interface CallflowOptions {
  project?: string;
  graphify_out?: string;
  graph?: string;
  report?: string;
  labels?: string;
  sections?: string;
  output?: string;
  lang: string;
  max_sections: number;
  diagram_scale: number;
  max_diagram_nodes: number;
  max_diagram_edges: number;
}

// ──────────────────────────────────────────────
// 2. Data loading and normalization helpers
// ──────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function readJson(p: string | undefined, defaultValue?: unknown): unknown {
  if (!p) return defaultValue;
  if (!fs.existsSync(p)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (exc: any) {
    throw new Error(`ERROR: invalid JSON in ${p}: ${exc.message}`);
  }
}

export function firstPresent(
  mapping: Record<string, unknown>,
  keys: string[],
  defaultValue?: unknown,
): unknown {
  for (const key of keys) {
    if (key in mapping && mapping[key] !== null && mapping[key] !== "") {
      return mapping[key];
    }
  }
  return defaultValue;
}

export function firstList(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function toFloat(value: unknown, defaultValue = 0.0): number {
  try {
    return parseFloat(String(value));
  } catch {
    return defaultValue;
  }
}

export function endpointId(value: unknown): string {
  if (isObj(value)) {
    value = firstPresent(value, ["id", "node_id", "key", "name", "qualified_name"]);
  }
  return String(value ?? "");
}

export function normalizeNode(raw: Record<string, unknown>, index: number): NormalizedNode {
  const node: Record<string, unknown> = { ...raw };
  const nodeId = firstPresent(
    node,
    ["id", "node_id", "key", "uid", "name", "qualified_name", "fqname", "symbol"],
    `node_${index + 1}`,
  );
  const sourceFile = firstPresent(
    node,
    ["source_file", "file", "file_path", "filepath", "path", "module_path", "defined_in"],
    "",
  );
  const label = firstPresent(
    node,
    ["label", "display_name", "title", "name", "qualified_name", "fqname", "symbol"],
    nodeId,
  );
  const community = firstPresent(
    node,
    ["community", "community_id", "cluster", "cluster_id", "group", "group_id", "modularity_class"],
    "unknown",
  );
  const nodeType = firstPresent(node, ["node_type", "kind", "type", "category"], "");
  let fileType = firstPresent(node, ["file_type", "content_type", "artifact_type"], "");

  if (!fileType) {
    const suffix = path.extname(String(sourceFile)).toLowerCase();
    fileType = [".md", ".mdx", ".rst", ".txt"].includes(suffix) ? "document" : "code";
  }

  node["id"] = String(nodeId);
  node["label"] = String(label);
  node["community"] = community;
  node["source_file"] = String(sourceFile ?? "");
  node["node_type"] = String(nodeType ?? "");
  node["file_type"] = String(fileType ?? "code");
  return node as NormalizedNode;
}

export function normalizeEdge(raw: Record<string, unknown>, index: number): NormalizedEdge | null {
  const edge: Record<string, unknown> = { ...raw };
  const source = endpointId(firstPresent(edge, ["source", "src", "from", "from_id", "start", "u"]));
  const target = endpointId(firstPresent(edge, ["target", "dst", "to", "to_id", "end", "v"]));
  if (!source || !target) return null;

  const relation = firstPresent(edge, ["relation", "type", "kind", "label", "predicate"], "relates");
  const confidence = firstPresent(edge, ["confidence", "evidence", "provenance"], "EXTRACTED");
  const score = firstPresent(edge, ["confidence_score", "score", "weight", "probability"], 1.0);

  edge["id"] = String(firstPresent(edge, ["id", "edge_id"], `edge_${index + 1}`));
  edge["source"] = source;
  edge["target"] = target;
  edge["relation"] = String(relation ?? "relates").toLowerCase();
  edge["confidence"] = String(confidence ?? "EXTRACTED").toUpperCase();
  edge["confidence_score"] = toFloat(score, 1.0);
  return edge as NormalizedEdge;
}

function nodeLinkPayload(data: Record<string, unknown>): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | null {
  if (!Array.isArray(data["nodes"])) return null;
  if (!Array.isArray(data["links"]) && !Array.isArray(data["edges"])) return null;

  // Simple node-link parser (no networkx dependency)
  try {
    const rawNodes = data["nodes"] as Record<string, unknown>[];
    const edgeList = (Array.isArray(data["links"]) ? data["links"] : data["edges"]) as Record<string, unknown>[];
    const nodes = rawNodes.map((n) => {
      const nodeId = n["id"] ?? n["node_id"] ?? n["key"] ?? n["name"] ?? "?";
      return { ...n, id: nodeId };
    });
    const edges = edgeList.map((e, i) => {
      const source = e["_src"] ?? e["source"] ?? e["src"] ?? e["from"];
      const target = e["_tgt"] ?? e["target"] ?? e["dst"] ?? e["to"];
      const edge: Record<string, unknown> = { ...e, source, target };
      if (!edge["id"]) edge["id"] = `edge_${i + 1}`;
      return edge;
    });
    return { nodes, edges };
  } catch {
    return null;
  }
}

export function loadGraph(graphPath: string): { nodes: NormalizedNode[]; edges: NormalizedEdge[]; hyperedges: unknown[]; meta: Record<string, unknown> } {
  if (graphPath) {
    const stat = fs.statSync(graphPath);
    const maxBytes = 200 * 1024 * 1024;
    if (stat.size > maxBytes) {
      throw new Error(`graph file too large (${Math.round(stat.size / 1024 / 1024)} MiB > 200 MiB cap): ${graphPath}`);
    }
  }
  const data = readJson(graphPath) as Record<string, unknown>;
  if (!isObj(data)) {
    throw new Error(`ERROR: graph file must contain a JSON object: ${graphPath}`);
  }

  const graphBlock = isObj(data["graph"]) ? (data["graph"] as Record<string, unknown>) : {};
  const metaBlock = isObj(data["metadata"]) ? (data["metadata"] as Record<string, unknown>) : {};

  const nodeLink = nodeLinkPayload(data);
  let rawNodes: Record<string, unknown>[];
  let rawEdges: Record<string, unknown>[];
  if (nodeLink) {
    rawNodes = nodeLink.nodes;
    rawEdges = nodeLink.edges;
  } else {
    rawNodes = firstList(data["nodes"], data["vertices"], graphBlock["nodes"], graphBlock["vertices"]) as Record<string, unknown>[];
    rawEdges = firstList(data["links"], data["edges"], graphBlock["links"], graphBlock["edges"]) as Record<string, unknown>[];
  }
  const hyperedges = firstList(data["hyperedges"], graphBlock["hyperedges"], data["groups"], graphBlock["groups"]);

  const nodes = rawNodes.filter(isObj).map((n, i) => normalizeNode(n, i));
  const edges: NormalizedEdge[] = [];
  for (let i = 0; i < rawEdges.length; i++) {
    if (!isObj(rawEdges[i])) continue;
    const edge = normalizeEdge(rawEdges[i], i);
    if (edge) edges.push(edge);
  }

  const meta: Record<string, unknown> = { ...graphBlock, ...metaBlock };
  for (const key of ["built_at_commit", "commit", "project_name", "repo", "repository", "language_breakdown"]) {
    if (data[key] && !meta[key]) meta[key] = data[key];
  }
  if (meta["commit"] && !meta["built_at_commit"]) meta["built_at_commit"] = meta["commit"];

  return { nodes, edges, hyperedges, meta };
}

export function loadLabels(p: string | undefined): Record<string, string> {
  const data = readJson(p, {}) as Record<string, unknown>;
  if (!isObj(data)) return {};
  if (isObj(data["labels"])) data["labels"] = (data as Record<string, unknown>)["labels"] as Record<string, unknown>;
  if (isObj(data["communities"])) data["communities"] = (data as Record<string, unknown>)["communities"] as Record<string, unknown>;
  const labels: Record<string, string> = {};
  const inner = isObj(data["labels"]) ? data["labels"] as Record<string, unknown> :
                isObj(data["communities"]) ? data["communities"] as Record<string, unknown> : data;
  for (const [key, value] of Object.entries(inner)) {
    if (isObj(value)) {
      labels[key] = String(firstPresent(value, ["label", "name", "title"], key));
    } else {
      labels[key] = String(value);
    }
  }
  return labels;
}

export function loadSections(p: string | undefined): Section[] {
  const data = readJson(p, []);
  if (isObj(data) && Array.isArray((data as Record<string, unknown>)["sections"])) {
    return (data as Record<string, unknown>)["sections"] as Section[];
  }
  if (!Array.isArray(data)) {
    throw new Error(`ERROR: sections file must contain a JSON array: ${p}`);
  }
  return data as Section[];
}

export function loadReport(p: string | undefined): string {
  if (p && fs.existsSync(p)) {
    return fs.readFileSync(p, "utf-8");
  }
  return "";
}

// ──────────────────────────────────────────────
// 3. Mermaid-safe label helpers
// ──────────────────────────────────────────────

export function safeMermaidText(text: string): string {
  text = String(text ?? "");
  text = text.replace(/"/g, "'");
  text = text.replace(/`/g, "");
  text = text.replace(/#/g, "");
  text = text.replace(/\|/g, " ");
  text = text.replace(/[{}]/g, "");
  text = text.replace(/->>/g, " to ").replace(/-->/g, " to ").replace(/->/g, " to ");
  text = text.replace(/\s+/g, " ").trim();
  return escapeHtml(text);
}

export function htmlCommentText(text: string): string {
  return String(text ?? "").replace(/--/g, "- -").replace(/\n/g, " ");
}

export function stableAsciiId(raw: string, prefix = "node", limit = 48): string {
  raw = String(raw ?? "");
  const digest = createHash("sha1").update(raw, "utf-8").digest("hex").slice(0, 8);
  let slug = raw.replace(/[^A-Za-z0-9_]+/g, "_");
  slug = slug.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!slug) slug = prefix;
  if (/^\d/.test(slug)) slug = `${prefix}_${slug}`;
  return `${slug.slice(0, limit).replace(/_+$/, "")}_${digest}`;
}

export function nodeMermaidId(node: Record<string, unknown>): string {
  return stableAsciiId(node["id"] as string ?? "unknown", "node");
}

export function mermaidSectionId(sectionId: string): string {
  return stableAsciiId(sectionId, "section").toUpperCase();
}

export function safeFilePath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length > 3) return parts.slice(-3).join("/");
  return filePath;
}

export function safeFilename(text: string, fallback = "project"): string {
  const stem = String(text ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  return stem || fallback;
}

export function inferProjectName(graphPath: string, meta: Record<string, unknown>): string {
  if (meta["project_name"]) return meta["project_name"] as string;
  const resolved = path.resolve(graphPath);
  const dir = path.dirname(resolved);
  const parentDir = path.dirname(dir);
  if (path.basename(dir) === "graphify-out" && parentDir !== dir) {
    return path.basename(parentDir);
  }
  return path.basename(dir) || "Project";
}

export function resolveGraphifyPaths(options: CallflowOptions): ResolvedPaths {
  const base = options.project ? path.resolve(options.project) : process.cwd();
  let graphifyOut: string;
  if (options.graphify_out) {
    graphifyOut = path.resolve(options.graphify_out);
  } else if (options.graph) {
    graphifyOut = path.dirname(path.resolve(options.graph));
  } else if (fs.existsSync(path.join(base, "graph.json"))) {
    graphifyOut = base;
  } else {
    graphifyOut = path.join(base, "graphify-out");
  }

  const projectRoot = path.basename(graphifyOut) === "graphify-out" ? path.dirname(graphifyOut) : base;
  const graph = options.graph ? path.resolve(options.graph) : path.join(graphifyOut, "graph.json");
  const report = options.report ? path.resolve(options.report) : path.join(graphifyOut, "GRAPH_REPORT.md");
  const labels = options.labels ? path.resolve(options.labels) : path.join(graphifyOut, ".graphify_labels.json");
  const sections = options.sections ? path.resolve(options.sections) : undefined;
  return { base: projectRoot, graphify_out: graphifyOut, graph, report, labels, sections };
}

export function isZh(lang: string): boolean {
  return (lang ?? "").toLowerCase().startsWith("zh");
}

export function pickText(lang: string, zh: string, en: string): string {
  return isZh(lang) ? zh : en;
}

export function detectLang(lang: string, nodes: NormalizedNode[], labels: Record<string, string>): string {
  if (lang && lang.toLowerCase() !== "auto") return lang;
  const sample = [
    ...Object.values(labels).slice(0, 50),
    ...nodes.slice(0, 200).map((n) => String(n["label"] ?? "")),
    ...nodes.slice(0, 100).map((n) => String(n["source_file"] ?? "")),
  ].join(" ");
  return /[\u4e00-\u9fff]/.test(sample) ? "zh-CN" : "en";
}

export function truncateText(text: string, limit: number): string {
  text = String(text ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - 3)).trimEnd() + "...";
}

export function humanizeLabel(label: string, sourceFile = ""): string {
  label = String(label ?? "").trim();
  if (!label) {
    return sourceFile ? path.basename(sourceFile) : "Unknown";
  }
  if (label.startsWith(".") && label.endsWith("()")) return label.slice(1);
  if (/\.(py|ts|tsx|js|jsx|go|rs|java|rb)$/.test(label)) return path.basename(label);
  if (label.includes("_") && !label.includes(" ") && label.length > 28) {
    const parts = label.split("_").filter(Boolean);
    if (parts.length > 0) label = parts.slice(-3).join(" ");
  }
  return truncateText(label, 42);
}

// ──────────────────────────────────────────────
// Node classification
// ──────────────────────────────────────────────

export function nodeKind(node: Record<string, unknown>): string {
  const label = String(node["label"] ?? node["id"] ?? "").toLowerCase();
  const sourceFile = String(node["source_file"] ?? "").toLowerCase();
  const fileType = String(node["file_type"] ?? "").toLowerCase();
  const nodeType = String(node["node_type"] ?? "").toLowerCase();
  if (["class", "klass", "struct", "interface", "enum", "trait", "model"].includes(nodeType)) return "klass";
  if (["module", "file", "package", "namespace"].includes(nodeType)) return "module";
  if (["endpoint", "route", "api", "handler", "controller"].includes(nodeType)) return "api";
  if (["test", "spec"].includes(nodeType)) return "test";
  if (["component", "hook", "view", "page"].includes(nodeType)) return "ui";
  if (["rationale", "document"].includes(fileType)) return "concept";
  if (sourceFile.includes("test") || label.startsWith("test_") || sourceFile.includes("spec")) return "test";
  if (["endpoint", "router", "api", "route"].some((w) => label.includes(w))) return "api";
  if (["cli", "command", "click", "typer"].some((w) => label.includes(w))) return "entry";
  if (["async", "await", "stream", "sse"].some((w) => label.includes(w))) return "async";
  const rawLabel = String(node["label"] ?? "");
  const hookLike = rawLabel.startsWith("use") && rawLabel.length > 3 && (/[A-Z_-]/.test(rawLabel[3]));
  if (["component", "props", "hook", "store"].some((w) => label.includes(w)) || hookLike || [".tsx", ".jsx", ".vue", ".svelte"].some((ext) => sourceFile.endsWith(ext))) return "ui";
  if (/^[A-Z]/.test(rawLabel) && !rawLabel.endsWith("()")) return "klass";
  if (/\.(py|ts|tsx|js|jsx|go|rs|java|kt|rb|php|cs|swift|vue|svelte)$/.test(rawLabel)) return "module";
  return "function";
}

export function relationLabel(relation: string, lang: string): string {
  relation = String(relation ?? "").trim();
  const zh: Record<string, string> = {
    calls: "调用", uses: "使用", imports: "导入", imports_from: "导入",
    method: "方法", contains: "包含", rationale_for: "说明",
    conceptually_related_to: "相关", participate_in: "参与", form: "组成",
  };
  const en: Record<string, string> = {
    calls: "calls", uses: "uses", imports: "imports", imports_from: "imports",
    method: "method", contains: "contains", rationale_for: "explains",
    conceptually_related_to: "relates", participate_in: "joins", form: "forms",
  };
  const mapped = (isZh(lang) ? zh : en)[relation] ?? relation.replace(/_/g, " ");
  return safeMermaidText(mapped);
}

// ──────────────────────────────────────────────
// Edge analysis
// ──────────────────────────────────────────────

export function preferredEdges(edges: NormalizedEdge[], allowStructure = false): NormalizedEdge[] {
  const primary = new Set(["calls", "uses", "method", "imports", "imports_from"]);
  const secondary = new Set(["contains", "rationale_for", "conceptually_related_to"]);
  const selected: NormalizedEdge[] = [];
  for (const edge of edges) {
    if (!shouldIncludeEdge(edge)) continue;
    const relation = (edge["relation"] as string) ?? "";
    if (primary.has(relation) || (allowStructure && secondary.has(relation))) {
      selected.push(edge);
    }
  }
  if (selected.length > 0) return selected;
  return edges.filter(shouldIncludeEdge);
}

export function edgeScore(edge: NormalizedEdge): number {
  const relation = (edge["relation"] as string) ?? "";
  let score = toFloat(edge["confidence_score"], 1.0);
  if (String(edge["confidence"] ?? "").toUpperCase() === "EXTRACTED") score += 2.0;
  if (["calls", "uses", "method"].includes(relation)) score += 1.0;
  else if (["imports", "imports_from"].includes(relation)) score += 0.6;
  else if (relation === "contains") score -= 0.2;
  else if (relation === "rationale_for") score -= 0.6;
  return score;
}

export function mermaidInit(scale: number, direction = "LR"): string {
  scale = Math.max(0.65, Math.min(parseFloat(String(scale ?? 1.0)), 1.8));
  const config = {
    theme: "dark",
    themeVariables: {
      fontSize: `${(15 * scale).toFixed(1)}px`,
      fontFamily: "Segoe UI, system-ui, sans-serif",
      primaryColor: "#1e293b",
      primaryTextColor: "#e2e8f0",
      primaryBorderColor: "#38bdf8",
      secondaryColor: "#0f172a",
      tertiaryColor: "#334155",
      lineColor: "#64748b",
      textColor: "#e2e8f0",
    },
    flowchart: {
      htmlLabels: true,
      curve: "basis",
      nodeSpacing: Math.round(48 * scale),
      rankSpacing: Math.round(64 * scale),
      padding: Math.round(14 * scale),
      diagramPadding: Math.round(10 * scale),
      useMaxWidth: true,
    },
  };
  return `%%{init: ${JSON.stringify(config)}}%%\nflowchart ${direction}`;
}

export function mermaidClassDefs(): string[] {
  return [
    "    classDef entry fill:#422006,stroke:#fbbf24,color:#fde68a,stroke-width:1px;",
    "    classDef api fill:#450a0a,stroke:#f87171,color:#fee2e2,stroke-width:1px;",
    "    classDef async fill:#2e1065,stroke:#a78bfa,color:#ede9fe,stroke-width:1px;",
    "    classDef klass fill:#064e3b,stroke:#34d399,color:#d1fae5,stroke-width:1px;",
    "    classDef ui fill:#831843,stroke:#f472b6,color:#fce7f3,stroke-width:1px;",
    "    classDef module fill:#172554,stroke:#60a5fa,color:#dbeafe,stroke-width:1px;",
    "    classDef test fill:#3f3f46,stroke:#a1a1aa,color:#f4f4f5,stroke-width:1px;",
    "    classDef concept fill:#292524,stroke:#a8a29e,color:#fafaf9,stroke-dasharray:4 3;",
    "    classDef function fill:#0f172a,stroke:#38bdf8,color:#e0f2fe,stroke-width:1px;",
  ];
}

// ──────────────────────────────────────────────
// 4. Community and section indexing
// ──────────────────────────────────────────────

export function buildCommunityIndex(nodes: NormalizedNode[]): Record<string, NormalizedNode[]> {
  const idx: Record<string, NormalizedNode[]> = {};
  for (const n of nodes) {
    const cid = String(n["community"] ?? "unknown");
    if (!idx[cid]) idx[cid] = [];
    idx[cid].push(n);
  }
  return idx;
}

export function htmlAnchorId(raw: string, fallback: string, used: Set<string>): string {
  raw = String(raw ?? fallback ?? "");
  let base = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!base) base = fallback.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!base) base = "section";
  base = base.slice(0, 48).replace(/-+$/g, "") || "section";
  let candidate = base;
  if (used.has(candidate)) {
    candidate = `${base}-${createHash("sha1").update(raw, "utf-8").digest("hex").slice(0, 6)}`;
  }
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  used.add(candidate);
  return candidate;
}

export function normalizeCommunities(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string") return value.split(",").map((p) => p.trim()).filter(Boolean);
  return [value];
}

export function normalizeSections(sections: Section[], lang: string): Section[] {
  const overviewName = pickText(lang, "架构总览", "Architecture Overview");
  const normalized: Section[] = [{ id: "overview", name: overviewName, communities: [] }];
  const used = new Set(["overview", "hyperedges", "stats"]);

  for (let index = 0; index < (sections ?? []).length; index++) {
    const raw = sections[index];
    if (!isObj(raw)) continue;
    const rawId = String(raw["id"] ?? raw["key"] ?? raw["name"] ?? `section-${index + 1}`);
    const rawName = String(raw["name"] ?? raw["label"] ?? rawId);
    if (rawId.toLowerCase() === "overview") {
      normalized[0]["name"] = rawName || overviewName;
      continue;
    }
    const sid = htmlAnchorId(rawId, `section-${index + 1}`, used);
    normalized.push({
      id: sid,
      name: rawName,
      communities: normalizeCommunities(raw["communities"] ?? raw["community"]),
    });
  }
  return normalized;
}

export function labelForCommunity(cid: string, labels: Record<string, string>, nodes: NormalizedNode[], lang: string): string {
  if (String(cid) in labels && labels[String(cid)]) return labels[String(cid)];
  const keywords = sectionKeywords(nodes, 3);
  if (keywords.length > 0) return keywords.slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return pickText(lang, `社区 ${cid}`, `Community ${cid}`);
}

export const SECTION_ARCHETYPES: SectionArchetype[] = [
  { id: "extract-pipeline", zhName: "提取管线", enName: "Extraction Pipeline", keywords: new Set(["extract", "extractor", "tree", "sitter", "parser", "language", "python", "javascript", "typescript", "rust", "java", "go", "ast", "calls", "imports", "multilang"]) },
  { id: "build-graph", zhName: "图谱构建", enName: "Graph Build", keywords: new Set(["build", "graph", "merge", "dedup", "node", "edge", "hyperedge", "json", "schema", "normalize", "confidence"]) },
  { id: "analysis-clustering", zhName: "分析聚类", enName: "Analysis & Clustering", keywords: new Set(["cluster", "community", "leiden", "cohesion", "analyze", "god", "surprise", "question", "query", "path", "explain", "benchmark"]) },
  { id: "outputs-docs", zhName: "输出文档", enName: "Outputs & Docs", keywords: new Set(["export", "html", "wiki", "obsidian", "canvas", "svg", "graphml", "report", "callflow", "mermaid", "tree", "documentation"]) },
  { id: "cli-skills", zhName: "CLI 与技能安装", enName: "CLI & Skill Installers", keywords: new Set(["main", "install", "uninstall", "skill", "agent", "claude", "codex", "opencode", "aider", "copilot", "kiro", "vscode", "hook", "command"]) },
  { id: "ingest-cache-update", zhName: "摄取与增量更新", enName: "Ingestion & Updates", keywords: new Set(["ingest", "fetch", "download", "url", "html", "markdown", "cache", "manifest", "watch", "update", "incremental", "transcribe", "video", "audio", "google"]) },
  { id: "serve-api", zhName: "服务 API", enName: "Serving API", keywords: new Set(["serve", "api", "request", "response", "endpoint", "router", "handle", "upload", "search", "delete", "enrich"]) },
  { id: "security-global", zhName: "安全与全局图", enName: "Security & Global Graph", keywords: new Set(["security", "safe", "ssrf", "xss", "path", "traversal", "global", "prefix", "prune", "repo", "clone"]) },
  { id: "tests-fixtures", zhName: "测试与样例", enName: "Tests & Fixtures", keywords: new Set(["test", "tests", "fixture", "fixtures", "sample", "assert", "pytest", "mock"]) },
];

function communityText(nodes: NormalizedNode[], label = ""): string {
  const parts = [label];
  for (const node of nodes.slice(0, 80)) {
    parts.push(String(node["label"] ?? ""));
    parts.push(String(node["source_file"] ?? ""));
    parts.push(String(node["node_type"] ?? ""));
    parts.push(String(node["file_type"] ?? ""));
  }
  return parts.join(" ").toLowerCase();
}

function keywordScore(text: string, keywords: Set<string>): number {
  let score = 0;
  for (const keyword of keywords) {
    const re = new RegExp(`(?<![a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "gi");
    const matches = text.match(re);
    score += matches ? matches.length : 0;
  }
  return score;
}

function rankGroupedSections(grouped: Record<string, Record<string, unknown>>, maxSections: number): { selected: Record<string, unknown>[]; overflowCommunities: string[] } {
  const ranked = Object.values(grouped).sort(
    (a, b) => ((a["priority"] as number) - (b["priority"] as number)) ||
               (-(a["node_count"] as number) + (b["node_count"] as number)) ||
               String(a["id"]).localeCompare(String(b["id"])),
  );
  const cap = Math.max(1, Math.round(maxSections ?? 15));
  const selected = ranked.slice(0, cap);
  const overflow = ranked.slice(cap);
  const overflowCommunities: string[] = [];
  for (const sec of overflow) {
    overflowCommunities.push(...(sec["communities"] as string[]));
  }
  return { selected, overflowCommunities };
}

export function deriveSectionsFromCommunities(nodes: NormalizedNode[], labels: Record<string, string>, lang: string, maxSections: number): Section[] {
  const commIdx = buildCommunityIndex(nodes);
  const sections: Section[] = [{ id: "overview", name: pickText(lang, "架构总览", "Architecture Overview"), communities: [] }];
  const grouped: Record<string, Record<string, unknown>> = {};
  const unassigned: Array<[string, NormalizedNode[], string]> = [];

  const sortedComm = Object.entries(commIdx).sort(([ , a], [ , b]) => b.length - a.length);
  for (const [cid, communityNodes] of sortedComm) {
    const lbl = labelForCommunity(cid, labels, communityNodes, lang);
    const text = communityText(communityNodes, lbl);
    let best: { priority: number; sid: string; zhName: string; enName: string } | null = null;
    let bestScore = 0;
    for (let priority = 0; priority < SECTION_ARCHETYPES.length; priority++) {
      const arch = SECTION_ARCHETYPES[priority];
      const score = keywordScore(text, arch.keywords);
      if (score > bestScore) {
        best = { priority, sid: arch.id, zhName: arch.zhName, enName: arch.enName };
        bestScore = score;
      }
    }

    if (best && bestScore >= 2) {
      if (!grouped[best.sid]) {
        grouped[best.sid] = {
          id: best.sid,
          name: pickText(lang, best.zhName, best.enName),
          communities: [],
          node_count: 0,
          priority: best.priority,
        };
      }
      (grouped[best.sid]["communities"] as string[]).push(cid);
      grouped[best.sid]["node_count"] = (grouped[best.sid]["node_count"] as number) + communityNodes.length;
    } else {
      unassigned.push([cid, communityNodes, lbl]);
    }
  }

  const { selected, overflowCommunities } = rankGroupedSections(grouped, Math.max(1, Math.round(maxSections ?? 15)) - 1);
  sections.push(...selected.map((sec) => ({
    id: sec["id"] as string,
    name: sec["name"] as string,
    communities: sec["communities"] as unknown[],
  })));

  const remainingSlots = Math.max(0, Math.round(maxSections ?? 15) - (sections.length - 1) - 1);
  for (const [cid, communityNodes, label] of unassigned.slice(0, remainingSlots)) {
    sections.push({ id: String(label ?? `community-${cid}`), name: label, communities: [cid] });
  }

  const otherCommunities = overflowCommunities.concat(unassigned.slice(remainingSlots).map(([cid]) => cid));
  if (otherCommunities.length > 0) {
    sections.push({
      id: "other",
      name: pickText(lang, "其他", "Other"),
      communities: otherCommunities,
    });
  }
  return sections;
}

export function buildSectionNodeMap(sections: Section[], commIdx: Record<string, NormalizedNode[]>): Record<string, NormalizedNode[]> {
  const sectionNodes: Record<string, NormalizedNode[]> = {};
  for (const sec of sections) {
    const sid = sec["id"];
    if (sid === "overview") { sectionNodes[sid] = []; continue; }
    const nodes: NormalizedNode[] = [];
    for (const cid of (sec["communities"] ?? [])) {
      nodes.push(...(commIdx[String(cid)] ?? []));
    }
    sectionNodes[sid] = nodes;
  }
  return sectionNodes;
}

export function nodeInSection(nodeId: string, sectionNodeIds: Set<string>): boolean {
  return sectionNodeIds.has(nodeId);
}

// ──────────────────────────────────────────────
// 5. Edge analysis
// ──────────────────────────────────────────────

export function classifyEdges(edges: NormalizedEdge[], sectionNodesMap: Record<string, NormalizedNode[]>): Record<string, unknown> {
  const nodeSection: Record<string, string> = {};
  for (const [sid, nodes] of Object.entries(sectionNodesMap)) {
    for (const n of nodes) {
      nodeSection[n["id"] as string] = sid;
    }
  }

  const intra: Record<string, NormalizedEdge[]> = {};
  const inter: NormalizedEdge[] = [];
  const orphan: NormalizedEdge[] = [];

  for (const e of edges) {
    const src = e["source"] as string ?? "";
    const tgt = e["target"] as string ?? "";
    const srcSec = nodeSection[src];
    const tgtSec = nodeSection[tgt];

    if (srcSec === undefined || tgtSec === undefined) {
      orphan.push(e);
    } else if (srcSec === tgtSec) {
      if (!intra[srcSec]) intra[srcSec] = [];
      intra[srcSec].push(e);
    } else {
      inter.push(e);
    }
  }
  return { intra, inter, orphan, node_section: nodeSection };
}

export function shouldIncludeEdge(edge: NormalizedEdge): boolean {
  const conf = String(edge["confidence"] ?? "EXTRACTED").toUpperCase();
  const score = toFloat(edge["confidence_score"], 1.0);
  if (conf === "EXTRACTED") return true;
  if (conf === "INFERRED" && score >= 0.85) return true;
  return false;
}

// ──────────────────────────────────────────────
// 6. Mermaid diagram generators
// ──────────────────────────────────────────────

export function nodeDegreeScores(edges: NormalizedEdge[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const edge of edges) {
    const score = edgeScore(edge);
    const src = edge["source"] as string ?? "";
    const tgt = edge["target"] as string ?? "";
    scores.set(src, (scores.get(src) ?? 0) + score);
    scores.set(tgt, (scores.get(tgt) ?? 0) + score);
  }
  return scores;
}

export function nodeImportance(node: Record<string, unknown>): number {
  for (const key of ["pagerank", "page_rank", "pageRank", "rank", "centrality", "score"]) {
    if (key in node) return toFloat(node[key], 0.0);
  }
  return 0.0;
}

export function selectDiagramNodes(nodes: NormalizedNode[], edges: NormalizedEdge[], maxNodes: number): NormalizedNode[] {
  const nodeById = new Map<string, NormalizedNode>();
  for (const n of nodes) nodeById.set(n["id"] as string, n);

  let usableEdges = preferredEdges(edges, false);
  if (usableEdges.length === 0) usableEdges = preferredEdges(edges, true);
  const scores = nodeDegreeScores(usableEdges);

  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const edge of usableEdges) {
    const src = edge["source"] as string ?? "";
    const tgt = edge["target"] as string ?? "";
    outgoing.set(src, (outgoing.get(src) ?? 0) + 1);
    incoming.set(tgt, (incoming.get(tgt) ?? 0) + 1);
  }

  const selected: NormalizedNode[] = [];
  const seen = new Set<string>();

  function addNode(nid: string): boolean {
    const node = nodeById.get(nid);
    if (!node || seen.has(nid)) return false;
    if (nodeKind(node) === "concept" && selected.length >= Math.max(4, Math.floor(maxNodes / 3))) return false;
    selected.push(node);
    seen.add(nid);
    return selected.length >= maxNodes;
  }

  // Start with entry points
  const entryCandidates = [...nodeById.keys()].sort((a, b) => {
    const diffA = (outgoing.get(a) ?? 0) - (incoming.get(a) ?? 0);
    const diffB = (outgoing.get(b) ?? 0) - (incoming.get(b) ?? 0);
    if (diffB !== diffA) return diffB - diffA;
    const outB = outgoing.get(b) ?? 0;
    const outA = outgoing.get(a) ?? 0;
    if (outB !== outA) return outB - outA;
    return a.localeCompare(b);
  });
  for (const nid of entryCandidates.slice(0, Math.max(3, Math.floor(maxNodes / 3)))) {
    if ((outgoing.get(nid) ?? 0) > 0 && addNode(nid)) return selected;
  }

  // Pull in neighbors from strongest edges
  const sortedEdges = [...usableEdges].sort((a, b) => edgeScore(b) - edgeScore(a));
  for (const edge of sortedEdges) {
    for (const nid of [edge["source"], edge["target"]] as string[]) {
      if (addNode(nid)) return selected;
    }
  }

  // Fallback
  function fallbackKey(node: NormalizedNode): [number, number, number, string, string] {
    const nid = node["id"] as string ?? "";
    const kindPenalty = nodeKind(node) === "concept" ? 1 : 0;
    return [kindPenalty, -(scores.get(nid) ?? 0), -nodeImportance(node), safeFilePath(node["source_file"] as string ?? ""), humanizeLabel(node["label"] as string ?? nid)];
  }
  const fallbackSorted = [...nodes].sort((a, b) => {
    const ka = fallbackKey(a);
    const kb = fallbackKey(b);
    for (let i = 0; i < 5; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
  for (const node of fallbackSorted) {
    const nid = node["id"] as string;
    if (!seen.has(nid)) { selected.push(node); seen.add(nid); }
    if (selected.length >= maxNodes) break;
  }
  return selected;
}

export function nodeLabel(node: Record<string, unknown>): string {
  const label = humanizeLabel(String(node["label"] ?? node["id"] ?? ""), String(node["source_file"] ?? ""));
  const sourceFile = safeFilePath(String(node["source_file"] ?? ""));
  if (sourceFile && !label.endsWith(path.basename(sourceFile))) {
    return `${safeMermaidText(label)}<br/><small>${safeMermaidText(sourceFile)}</small>`;
  }
  return safeMermaidText(label);
}

export function groupNodesByFile(nodes: NormalizedNode[]): Record<string, NormalizedNode[]> {
  const groups: Record<string, NormalizedNode[]> = {};
  for (const node of nodes) {
    const sourceFile = safeFilePath(String(node["source_file"] ?? "")) || "External / generated";
    if (!groups[sourceFile]) groups[sourceFile] = [];
    groups[sourceFile].push(node);
  }
  const sorted = ([...Object.entries(groups)] as [string, NormalizedNode[]][])
    .sort(([, a], [, b]) => b.length - a.length || String(a[0] ?? "").localeCompare(String(b[0] ?? "")));
  const result: Record<string, NormalizedNode[]> = {};
  for (const [key, val] of sorted) result[key] = val;
  return result;
}

export function sectionEdgeSummary(classifiedEdges: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const nodeSection = classifiedEdges["node_section"] as Record<string, string> ?? {};
  const summary: Record<string, Record<string, unknown>> = {};
  const interEdges = (classifiedEdges["inter"] as NormalizedEdge[]) ?? [];
  for (const edge of interEdges) {
    if (!shouldIncludeEdge(edge)) continue;
    const srcSec = nodeSection[edge["source"] as string ?? ""];
    const tgtSec = nodeSection[edge["target"] as string ?? ""];
    if (!srcSec || !tgtSec || srcSec === tgtSec) continue;
    const key = `${srcSec}\0${tgtSec}`;
    if (!summary[key]) summary[key] = { count: 0, relations: new Map<string, number>() };
    summary[key]["count"] = (summary[key]["count"] as number) + 1;
    const relations = summary[key]["relations"] as Map<string, number>;
    const rel = (edge["relation"] as string) ?? "relates";
    relations.set(rel, (relations.get(rel) ?? 0) + 1);
  }
  return summary;
}

export function generateOverviewGraph(
  sections: Section[],
  sectionNodesMap: Record<string, NormalizedNode[]>,
  classifiedEdges: Record<string, unknown>,
  labels: Record<string, string>,
  lang: string,
  diagramScale: number,
): string {
  const lines = [mermaidInit(diagramScale, "LR")];
  const sectionDefs = sections.filter((sec) => sec["id"] !== "overview");

  for (const sec of sectionDefs) {
    const sid = mermaidSectionId(sec["id"]);
    const nodeCount = (sectionNodesMap[sec["id"]] ?? []).length;
    const lbl = `${safeMermaidText(sec["name"] ?? sec["id"])}<br/><small>${nodeCount} ${safeMermaidText("nodes")}</small>`;
    lines.push(`    ${sid}("${lbl}")`);
    lines.push(`    class ${sid} module;`);
  }

  const aggregated = sectionEdgeSummary(classifiedEdges);
  const sortedAgg = Object.entries(aggregated).sort(([ , a], [ , b]) => (b["count"] as number) - (a["count"] as number)).slice(0, 12);
  for (const [key, data] of sortedAgg) {
    const [src, tgt] = key.split("\0");
    const srcId = mermaidSectionId(src);
    const tgtId = mermaidSectionId(tgt);
    const relations = data["relations"] as Map<string, number>;
    let topRel = "relates";
    let topCount = 0;
    for (const [rel, cnt] of relations.entries()) {
      if (cnt > topCount) { topRel = rel; topCount = cnt; }
    }
    let label = relationLabel(topRel, lang);
    if ((data["count"] as number) > 1) label = `${label} x${data["count"]}`;
    lines.push(`    ${srcId} -->|${label}| ${tgtId}`);
  }

  if (sortedAgg.length === 0 && sectionDefs.length > 1) {
    for (let i = 0; i < sectionDefs.length - 1; i++) {
      lines.push(`    ${mermaidSectionId(sectionDefs[i]["id"])} -.-> ${mermaidSectionId(sectionDefs[i + 1]["id"])}`);
    }
  }

  lines.push(...mermaidClassDefs());
  return lines.join("\n");
}

export function generateSectionFlowchart(
  sectionId: string, sectionName: string,
  nodes: NormalizedNode[], edges: NormalizedEdge[],
  lang: string, diagramScale: number,
  maxNodes: number, maxEdges: number,
): string {
  const lines = [mermaidInit(diagramScale, "LR")];
  lines.push(`    %% Section: ${safeMermaidText(sectionName)} (${nodes.length} nodes, ${edges.length} edges)`);

  if (nodes.length === 0) {
    const emptyLabel = pickText(lang, `${sectionName} - 无节点`, `${sectionName} - no nodes`);
    lines.push(`    empty("${safeMermaidText(emptyLabel)}")`);
    lines.push(...mermaidClassDefs());
    return lines.join("\n");
  }

  const selectedNodes = selectDiagramNodes(nodes, edges, maxNodes);
  const selectedIds = new Set(selectedNodes.map((n) => n["id"] as string));
  let visibleEdges = preferredEdges(edges, false).filter(
    (e) => selectedIds.has(e["source"] as string) && selectedIds.has(e["target"] as string),
  );
  if (visibleEdges.length === 0) {
    visibleEdges = preferredEdges(edges, true).filter(
      (e) => selectedIds.has(e["source"] as string) && selectedIds.has(e["target"] as string),
    );
  }

  const groups = groupNodesByFile(selectedNodes);
  const classLines: string[] = [];
  for (const [sourceFile, group] of Object.entries(groups)) {
    const groupId = nodeMermaidId({ id: `${sectionId}_${sourceFile}` });
    if (Object.keys(groups).length > 1 && group.length > 1) {
      lines.push(`    subgraph ${groupId}["${safeMermaidText(sourceFile)}"]`);
    }
    const indent = Object.keys(groups).length > 1 && group.length > 1 ? "        " : "    ";
    for (const node of group) {
      const mid = nodeMermaidId(node);
      lines.push(`${indent}${mid}("${nodeLabel(node)}")`);
      classLines.push(`    class ${mid} ${nodeKind(node)};`);
    }
    if (Object.keys(groups).length > 1 && group.length > 1) {
      lines.push("    end");
    }
  }

  let included = 0;
  const sortedVisible = [...visibleEdges].sort((a, b) => edgeScore(b) - edgeScore(a));
  for (const edge of sortedVisible) {
    if (included >= maxEdges) break;
    const srcId = nodeMermaidId({ id: edge["source"] as string ?? "" });
    const tgtId = nodeMermaidId({ id: edge["target"] as string ?? "" });
    const rel = relationLabel(edge["relation"] as string ?? "", lang);
    lines.push(`    ${srcId} -->|${rel}| ${tgtId}`);
    included++;
  }

  const omittedNodes = Math.max(0, nodes.length - selectedNodes.length);
  const omittedEdges = Math.max(0, visibleEdges.length - included);
  if (omittedNodes || omittedEdges) {
    lines.push(`    %% Omitted for readability: ${omittedNodes} nodes, ${omittedEdges} edges`);
  }
  lines.push(...classLines);
  lines.push(...mermaidClassDefs());
  return lines.join("\n");
}

// ──────────────────────────────────────────────
// 7. HTML generators
// ──────────────────────────────────────────────

export function generateNav(sections: Section[]): string {
  const links: string[] = [];
  for (const sec of sections) {
    links.push(`    <a href="#${escapeHtml(sec["id"])}">${escapeHtml(sec["name"])}</a>`);
  }
  return `<div class="nav">\n${links.join("\n")}\n</div>`;
}

export function nodeDisplayName(node: Record<string, unknown> | null, fallback = ""): string {
  if (!node) return String(fallback ?? "");
  const label = String(node["label"] ?? node["id"] ?? fallback ?? "");
  return humanizeLabel(label, String(node["source_file"] ?? ""));
}

export function formatNodeRefs(nodeIds: Set<string>, nodeById: Map<string, NormalizedNode>, lang: string, emptyText: string, limit = 3): string {
  if (nodeIds.size === 0) return escapeHtml(emptyText);
  const parts: string[] = [];
  const sorted = [...nodeIds].sort((a, b) =>
    nodeDisplayName(nodeById.get(a) ?? null, a).toLowerCase().localeCompare(nodeDisplayName(nodeById.get(b) ?? null, b).toLowerCase()),
  ).slice(0, limit);
  for (const nid of sorted) {
    const node = nodeById.get(nid);
    const label = nodeDisplayName(node ?? null, nid);
    const source = safeFilePath(String((node ?? {})["source_file"] ?? ""));
    if (source) {
      parts.push(`<code>${escapeHtml(label)}</code><br><small style="color:var(--muted)">${escapeHtml(source)}</small>`);
    } else {
      parts.push(`<code>${escapeHtml(label)}</code>`);
    }
  }
  if (nodeIds.size > limit) {
    parts.push(escapeHtml(pickText(lang, `+${nodeIds.size - limit} 个更多`, `+${nodeIds.size - limit} more`)));
  }
  return parts.join("<br>");
}

export function generateCallTableRows(nodes: NormalizedNode[], sectionEdges: NormalizedEdge[], lang: string): string {
  if (nodes.length === 0) return "";

  const nodeById = new Map<string, NormalizedNode>();
  for (const n of nodes) nodeById.set(n["id"] as string, n);

  const callers: Record<string, Set<string>> = {};
  const callees: Record<string, Set<string>> = {};
  for (const e of sectionEdges) {
    const src = e["source"] as string ?? "";
    const tgt = e["target"] as string ?? "";
    if (["calls", "imports", "imports_from", "uses", "method"].includes(e["relation"] as string ?? "")) {
      if (!callers[tgt]) callers[tgt] = new Set();
      callers[tgt].add(src);
      if (!callees[src]) callees[src] = new Set();
      callees[src].add(tgt);
    }
  }

  const rows: string[] = [];
  for (let i = 0; i < Math.min(nodes.length, 30); i++) {
    const n = nodes[i];
    const nid = n["id"] as string ?? "";
    const label = n["label"] as string ?? nid;
    const sourceFile = safeFilePath(String(n["source_file"] ?? ""));
    const fileType = n["file_type"] as string ?? "code";
    const tag = suggestTag(label, fileType, lang, nodeKind(n));
    const callerText = formatNodeRefs(
      callers[nid] ?? new Set(),
      nodeById,
      lang,
      pickText(lang, "外部入口 / 无直接入边", "External entry / no inbound edge"),
    );
    const calleeText = formatNodeRefs(
      callees[nid] ?? new Set(),
      nodeById,
      lang,
      pickText(lang, "无直接出边", "No direct outbound edge"),
    );
    rows.push(`<tr>
  <td>${i + 1}</td>
  <td><code>${escapeHtml(label)}</code><br><small style="color:var(--muted)">${escapeHtml(sourceFile)}</small></td>
  <td>${tag}</td>
  <td>${callerText}</td>
  <td>${calleeText}</td>
  <td>${escapeHtml(describeNode(label, sourceFile, fileType, lang))}</td>
</tr>`);
  }
  return rows.join("\n");
}

function suggestTag(label: string, fileType: string, lang: string, kind = ""): string {
  const lower = label.toLowerCase();
  const names: Record<string, [string, string, string]> = {
    concept: ["概念", "Concept", "tag-func"],
    entry: ["入口", "Entry", "tag-cmd"],
    api: ["API", "API", "tag-endpoint"],
    async: ["异步", "Async", "tag-async"],
    klass: ["类", "Class", "tag-class"],
    ui: ["UI", "UI", "tag-hook"],
    module: ["模块", "Module", "tag-class"],
    test: ["测试", "Test", "tag-func"],
    function: ["函数", "Function", "tag-func"],
  };
  if (kind in names) {
    const [zh, en, cls] = names[kind];
    return `<span class="tag ${cls}">${pickText(lang, zh, en)}</span>`;
  }
  if (fileType === "rationale") return `<span class="tag tag-func">${pickText(lang, "概念", "Concept")}</span>`;
  if (["cli", "command", "scan", "serve", "chat", "config"].some((kw) => lower.includes(kw))) {
    if (lower.includes("group") || lower.includes("command")) return `<span class="tag tag-cmd">${pickText(lang, "CLI命令", "CLI")}</span>`;
  }
  if (["router", "endpoint", "api", "/api/"].some((kw) => lower.includes(kw))) return `<span class="tag tag-endpoint">${pickText(lang, "API端点", "API")}</span>`;
  if (["async", "await", "stream"].some((kw) => lower.includes(kw))) return `<span class="tag tag-async">${pickText(lang, "异步", "Async")}</span>`;
  if (["class", "model", "schema", "dataclass", "pydantic"].some((kw) => lower.includes(kw))) return `<span class="tag tag-class">${pickText(lang, "类", "Class")}</span>`;
  if (["hook", "usestate", "useeffect", "store"].some((kw) => lower.includes(kw))) return '<span class="tag tag-hook">Hook</span>';
  if (["component", "props", "tsx", "jsx", "render"].some((kw) => lower.includes(kw))) return `<span class="tag tag-class">${pickText(lang, "组件", "Component")}</span>`;
  return `<span class="tag tag-func">${pickText(lang, "函数", "Function")}</span>`;
}

function describeNode(label: string, sourceFile: string, fileType: string, lang: string): string {
  const lower = label.toLowerCase();
  const source = sourceFile || pickText(lang, "项目", "project");
  if (fileType === "rationale") return pickText(lang, `设计说明：${label}`, `Design note for ${label}.`);
  if (fileType === "document") return pickText(lang, `文档入口，描述 ${label} 相关能力。`, `Documentation node describing ${label}.`);
  if (/\.(py|tsx|ts)$/.test(label)) return pickText(lang, `${source} 中的模块文件，承载该层主要实现。`, `Module file in ${source}.`);
  if (lower.includes("config")) return pickText(lang, "读取、解析或持久化项目配置。", "Reads, resolves, or persists project configuration.");
  if (lower.includes("scan")) return pickText(lang, "触发项目扫描或处理扫描状态。", "Starts scanning or handles scan status.");
  if (lower.includes("ingest") || lower.includes("clone") || lower.includes("git")) return pickText(lang, "把本地目录或远程仓库转换为分析上下文。", "Turns a local path or remote repository into analysis context.");
  if (lower.includes("prompt")) return pickText(lang, "构造发送给 LLM 的结构化提示。", "Builds structured prompts for model calls.");
  if (lower.includes("analy")) return pickText(lang, "编排分析流程并产出结构化文档数据。", "Orchestrates analysis and returns structured documentation data.");
  if (lower.includes("graph") || lower.includes("dependency")) return pickText(lang, "构建依赖关系并提供排序或图形化数据。", "Builds dependency relationships and graph data.");
  if (lower.includes("export") || lower.includes("markdown") || lower.includes("html")) return pickText(lang, "将文档数据导出为目标格式。", "Exports documentation data to a target format.");
  if (lower.includes("chat") || lower.includes("rag") || lower.includes("retrieve")) return pickText(lang, "支撑检索增强问答或流式聊天。", "Supports retrieval-augmented Q&A or streaming chat.");
  if (lower.includes("wiki") || lower.includes("page") || lower.includes("sidebar")) return pickText(lang, "组织文档页面、侧边栏或内容读取。", "Organizes documentation pages, navigation, or content lookup.");
  if (lower.includes("cache") || lower.includes("hash")) return pickText(lang, "缓存分析结果或生成缓存键。", "Caches analysis results or computes cache keys.");
  if (lower.includes("test")) return pickText(lang, "验证导入、入口点或版本等基础行为。", "Verifies imports, entry points, or version behavior.");
  return pickText(lang, `${source} 中的 ${label} 节点。`, `${label} node in ${source}.`);
}

export function generateHeader(sections: Section[], meta: Record<string, unknown>, lang: string): string {
  const projectName = String(meta["project_name"] ?? "Project");
  const commit = String(meta["built_at_commit"] ?? "unknown").slice(0, 7);

  let title: string;
  let subtitle: string;
  if (lang.startsWith("zh")) {
    title = `${projectName} -- 完整调用流程与架构文档`;
    subtitle = `由 graphify 知识图谱生成：${meta["node_count"] ?? "?"} 个节点、${meta["edge_count"] ?? "?"} 条边、${meta["community_count"] ?? "?"} 个社区。Commit: ${commit}`;
  } else {
    title = `${projectName} -- Complete Call Flow & Architecture Documentation`;
    subtitle = `Generated from graphify knowledge graph: ${meta["node_count"] ?? "?"} nodes, ${meta["edge_count"] ?? "?"} edges, ${meta["community_count"] ?? "?"} communities. Commit: ${commit}`;
  }

  return `<h1>${escapeHtml(title)}</h1>
<p class="subtitle">${escapeHtml(subtitle)}</p>

${generateNav(sections)}
`;
}

export function deriveFlowChain(sections: Section[], classifiedEdges: Record<string, unknown>): string {
  const sectionNames: Record<string, string> = {};
  for (const sec of sections) sectionNames[sec["id"]] = sec["name"] ?? sec["id"];
  const order = sections.filter((sec) => sec["id"] !== "overview").map((sec) => sec["id"]);
  if (order.length === 0) return "Graph nodes -> documentation";

  const outgoing: Record<string, Map<string, number>> = {};
  const incoming = new Map<string, number>();
  for (const [key, data] of Object.entries(sectionEdgeSummary(classifiedEdges))) {
    const [src, tgt] = key.split("\0");
    if (!outgoing[src]) outgoing[src] = new Map();
    outgoing[src].set(tgt, (outgoing[src].get(tgt) ?? 0) + (data["count"] as number));
    incoming.set(tgt, (incoming.get(tgt) ?? 0) + (data["count"] as number));
  }

  const start = order.reduce((a, b) => {
    const aVal = incoming.get(a) ?? 0;
    const bVal = incoming.get(b) ?? 0;
    if (aVal !== bVal) return aVal < bVal ? a : b;
    return order.indexOf(a) < order.indexOf(b) ? a : b;
  });
  const chain = [start];
  const seen = new Set([start]);
  let current = start;
  while (chain.length < Math.min(7, order.length)) {
    const outMap = outgoing[current];
    const candidates = outMap ? [...outMap.entries()].filter(([tgt]) => !seen.has(tgt)) : [];
    let nxt: string;
    if (candidates.length > 0) {
      nxt = candidates.reduce((a, b) => a[1] >= b[1] ? a : b)[0];
    } else {
      const remaining = order.filter((sid) => !seen.has(sid));
      if (remaining.length === 0) break;
      nxt = remaining[0];
    }
    chain.push(nxt);
    seen.add(nxt);
    current = nxt;
  }
  return chain.map((sid) => sectionNames[sid] ?? sid).join(" -> ");
}

export function generateOverviewCards(meta: Record<string, unknown>, reportText: string, sections: Section[], sectionNodesMap: Record<string, NormalizedNode[]>, classifiedEdges: Record<string, unknown>, lang: string): string {
  const rows: string[] = [];
  for (const sec of sections) {
    if (sec["id"] === "overview") continue;
    const communities = (sec["communities"] ?? []).map(String).join(", ");
    const nodeCount = (sectionNodesMap[sec["id"]] ?? []).length;
    rows.push(`<tr><td>${escapeHtml(sec["name"])}</td><td>${nodeCount}</td><td><code>${escapeHtml(communities)}</code></td></tr>`);
  }

  const flow = deriveFlowChain(sections, classifiedEdges);
  const layerTitle = pickText(lang, "架构层次", "Architecture Layers");
  const layerCols = pickText(lang, "<tr><th>层</th><th>节点</th><th>社区</th></tr>", "<tr><th>Layer</th><th>Nodes</th><th>Communities</th></tr>");
  const flowTitle = pickText(lang, "核心数据流", "Core Flow");
  return `<div class="grid">
  <div class="card">
    <h4>${layerTitle}</h4>
    <table style="width:100%;font-size:0.85rem;">
      ${layerCols}
      ${rows.join("")}
    </table>
  </div>
  <div class="card">
    <h4>${flowTitle}</h4>
    <div class="arrow-chain">${escapeHtml(flow)}</div>
  </div>
</div>`;
}

export function sectionKeywords(nodes: NormalizedNode[], limit = 5): string[] {
  const counts = new Map<string, number>();
  const stopwords = new Set(["the", "and", "for", "with", "from", "this", "that", "class", "function", "method", "file", "src", "lib", "core", "index", "main", "init", "py", "ts", "tsx", "js", "jsx", "go", "rs", "java", "html", "css"]);
  for (const node of nodes) {
    const text = `${node["label"] ?? ""} ${node["source_file"] ?? ""}`.replace(/\//g, " ").replace(/_/g, " ").replace(/-/g, " ");
    for (const raw of text.split(/\s+/)) {
      const word = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (word.length < 3 || stopwords.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

export function generateSectionIntro(sec: Section, nodes: NormalizedNode[], edgeCount: number, lang: string): string {
  const fileCounts = new Map<string, number>();
  for (const n of nodes) {
    const sf = String(n["source_file"] ?? "");
    if (sf) fileCounts.set(sf, (fileCounts.get(sf) ?? 0) + 1);
  }
  const topFiles = [...fileCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([p]) => safeFilePath(p));
  const keywords = sectionKeywords(nodes, 4);

  let text: string;
  if (isZh(lang)) {
    const fileText = topFiles.length > 0 ? topFiles.join("、") : "未标注源文件";
    const keywordText = keywords.length > 0 ? keywords.join("、") : sec["name"] ?? sec["id"];
    text = `${sec["name"] ?? sec["id"]} 汇集了与 ${keywordText} 相关的实现，主要分布在 ${fileText}。本节覆盖 ${nodes.length} 个节点、${edgeCount} 条内部边，图中只展示最有代表性的调用关系以保持可读性。`;
  } else {
    const fileText = topFiles.length > 0 ? topFiles.join(", ") : "unmapped files";
    const keywordText = keywords.length > 0 ? keywords.join(", ") : sec["name"] ?? sec["id"];
    text = `${sec["name"] ?? sec["id"]} groups implementation around ${keywordText}, mostly in ${fileText}. This section covers ${nodes.length} nodes and ${edgeCount} internal edges; the diagram shows only representative relationships to stay readable.`;
  }
  return `<p>${escapeHtml(text)}</p>`;
}

export function generateSectionCards(sec: Section, nodes: NormalizedNode[], sectionEdges: NormalizedEdge[], lang: string): string {
  const fileCounts: Record<string, number> = {};
  for (const n of nodes) {
    const sf = String(n["source_file"] ?? "");
    if (sf) fileCounts[sf] = (fileCounts[sf] ?? 0) + 1;
  }
  const topFiles = Object.entries(fileCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  let fileRows: string;
  if (topFiles.length > 0) {
    fileRows = topFiles.map(([p, count]) =>
      `<tr><td><code>${escapeHtml(safeFilePath(p))}</code></td><td>${count} ${escapeHtml(pickText(lang, "个节点", "nodes"))}</td></tr>`,
    ).join("\n");
  } else {
    fileRows = `<tr><td colspan="2">${escapeHtml(pickText(lang, "无源文件映射", "No source file mapping"))}</td></tr>`;
  }

  const relationCounts = new Map<string, number>();
  for (const edge of sectionEdges) {
    if (shouldIncludeEdge(edge)) {
      const rel = (edge["relation"] as string) ?? "relates";
      relationCounts.set(rel, (relationCounts.get(rel) ?? 0) + 1);
    }
  }
  const sortedRels = [...relationCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  let relationText = sortedRels.map(([rel, count]) => `${relationLabel(rel, lang)} x${count}`).join(", ");
  if (!relationText) relationText = pickText(lang, "未检测到高置信调用边", "No high-confidence call edges detected");

  const note = pickText(
    lang,
    `本节由 graphify 社区聚类生成。关系概况：${relationText}。图表优先展示高置信、跨节点调用或使用关系，完整节点清单位于表格中。`,
    `This section comes from graphify community clustering. Relationship summary: ${relationText}. The diagram prioritizes high-confidence calls or usage relationships; the table keeps the broader node inventory.`,
  );
  const keyFiles = pickText(lang, "关键文件", "Key Files");
  const role = pickText(lang, "覆盖节点", "Coverage");
  const designNotes = pickText(lang, "设计备注", "Design Notes");
  return `<div class="grid">
  <div class="card">
    <h4>${keyFiles}</h4>
    <table style="width:100%;font-size:0.85rem;">
      <tr><th>File</th><th>${role}</th></tr>
      ${fileRows}
    </table>
  </div>
  <div class="card">
    <h4>${designNotes}</h4>
    <p>${escapeHtml(note)}</p>
  </div>
</div>`;
}

// ──────────────────────────────────────────────
// 8. Main entry point
// ──────────────────────────────────────────────

function reportHighlights(reportText: string, lang: string): string {
  if (!reportText.trim()) return "";

  const lines = reportText.split("\n");
  const keep: string[] = [];
  let inGods = false;
  let inSummary = false;
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.startsWith("## ")) {
      inSummary = stripped === "## Summary";
      inGods = stripped.startsWith("## God Nodes");
      continue;
    }
    if (inSummary && stripped.startsWith("- ")) {
      keep.push(stripped.slice(2));
    } else if (inGods && /^\d+\./.test(stripped)) {
      keep.push(stripped);
    }
    if (keep.length >= 6) break;
  }

  if (keep.length === 0) return "";

  const title = pickText(lang, "图谱报告摘要", "Graph Report Highlights");
  const items = keep.map((item) => `      <li>${escapeHtml(item)}</li>`).join("\n");
  return `<div class="card">
    <h4>${title}</h4>
    <ul>
${items}
    </ul>
  </div>`;
}

export function writeCallflowHtml(
  project?: string,
  opts?: Partial<CallflowOptions>,
): string {
  const options: CallflowOptions = {
    project,
    graphify_out: opts?.graphify_out,
    graph: opts?.graph,
    report: opts?.report,
    labels: opts?.labels,
    sections: opts?.sections,
    output: opts?.output,
    lang: opts?.lang ?? "auto",
    max_sections: opts?.max_sections ?? 15,
    diagram_scale: opts?.diagram_scale ?? 1.0,
    max_diagram_nodes: opts?.max_diagram_nodes ?? 18,
    max_diagram_edges: opts?.max_diagram_edges ?? 24,
  };

  const paths = resolveGraphifyPaths(options);
  if (!fs.existsSync(paths.graph)) {
    throw new Error(`graphify output not found: ${paths.graph}. Run graphify first or pass --graph /path/to/graph.json.`);
  }

  // Load data
  const { nodes, edges, hyperedges, meta } = loadGraph(paths.graph);
  const labels = loadLabels(paths.labels);
  const lang = detectLang(options.lang, nodes, labels);
  let sections: Section[];
  if (paths.sections) {
    sections = loadSections(paths.sections);
  } else {
    sections = deriveSectionsFromCommunities(nodes, labels, lang, options.max_sections);
  }
  sections = normalizeSections(sections, lang);
  const reportText = loadReport(paths.report);

  if (nodes.length === 0) throw new Error("graph.json contains 0 nodes");
  if (sections.length <= 1) throw new Error("no sections defined");

  meta["project_name"] = inferProjectName(String(paths.graph), meta);
  meta["node_count"] = nodes.length;
  meta["edge_count"] = edges.length;
  meta["hyperedge_count"] = hyperedges.length;

  let outputPath: string;
  if (options.output) {
    outputPath = path.resolve(options.output);
    if (!path.isAbsolute(outputPath)) outputPath = path.join(paths.base, outputPath);
  } else {
    outputPath = path.join(paths.graphify_out, `${safeFilename(meta["project_name"] as string)}-callflow.html`);
  }

  // Build index
  const commIdx = buildCommunityIndex(nodes);
  meta["community_count"] = Object.keys(commIdx).length;
  const sectionNodesMap = buildSectionNodeMap(sections, commIdx);
  const classified = classifyEdges(edges, sectionNodesMap);

  // Build HTML
  const html: string[] = [];
  const docTitle = lang.startsWith("zh")
    ? `${meta["project_name"] ?? "Project"} -- 完整调用流程与架构文档`
    : `${meta["project_name"] ?? "Project"} -- Complete Call Flow & Architecture Documentation`;

  html.push(`<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(docTitle)}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>
${CSS}
</style>
</head>
<body>
<div class="container">
`);

  // Header + nav
  html.push(generateHeader(sections, meta, lang));

  // Architecture Overview
  const overviewName = sections.length > 0 ? sections[0]["name"] ?? "Architecture Overview" : "Architecture Overview";
  html.push(`<!-- ====== Architecture Overview ====== -->
<h2 id="overview">1. ${escapeHtml(String(overviewName))}</h2>

<div class="mermaid">
`);
  html.push(generateOverviewGraph(sections, sectionNodesMap, classified, labels, lang, options.diagram_scale));
  html.push(`</div>
`);
  html.push(generateOverviewCards(meta, reportText, sections, sectionNodesMap, classified, lang));
  const reportCard = reportHighlights(reportText, lang);
  if (reportCard) html.push(`<div class="grid">\n  ${reportCard}\n</div>`);
  html.push("<hr>");

  // Per-section content
  let sectionNum = 1;
  for (const sec of sections) {
    if (sec["id"] === "overview") continue;
    sectionNum++;
    const sid = sec["id"];
    const name = sec["name"] ?? sid;
    const secNodes = sectionNodesMap[sid] ?? [];
    const secEdges = ((classified["intra"] as Record<string, NormalizedEdge[]>) ?? {})[sid] ?? [];

    const edgeCount = secEdges.length;
    const h3Title = pickText(lang, "调用明细", "Call Details");
    const numberHeader = "#";
    const functionHeader = pickText(lang, "节点", "Node");
    const typeHeader = pickText(lang, "类型", "Type");
    const callerHeader = pickText(lang, "调用方", "Caller");
    const calleeHeader = pickText(lang, "被调用/依赖", "Callees");
    const descHeader = pickText(lang, "说明", "Description");

    html.push(`<!-- ====== ${sectionNum}. ${htmlCommentText(name)} ====== -->
<h2 id="${escapeHtml(String(sid))}">${sectionNum}. ${escapeHtml(String(name))}</h2>
${generateSectionIntro(sec, secNodes, edgeCount, lang)}

<div class="mermaid">
${generateSectionFlowchart(sid, name, secNodes, secEdges, lang, options.diagram_scale, options.max_diagram_nodes, options.max_diagram_edges)}
</div>

<h3>${h3Title}</h3>
<table class="call-table">
<tr>
  <th style="width:5%">${numberHeader}</th>
  <th style="width:28%">${functionHeader}</th>
  <th style="width:10%">${typeHeader}</th>
  <th style="width:17%">${callerHeader}</th>
  <th style="width:20%">${calleeHeader}</th>
  <th style="width:20%">${descHeader}</th>
</tr>
${generateCallTableRows(secNodes, secEdges, lang)}
</table>

${generateSectionCards(sec, secNodes, secEdges, lang)}
<hr>
`);
  }

  // Hyperedges
  if (hyperedges.length > 0) {
    html.push(`<h2 id="hyperedges">Group Relationships (Hyperedges)</h2>
<div class="grid">
`);
    for (const he of hyperedges.slice(0, 9)) {
      const hHe = he as Record<string, unknown>;
      const hid = hHe["id"] ?? "?";
      const hlabel = hHe["label"] ?? hid;
      const hnodes = hHe["nodes"] as unknown[] ?? [];
      const hrel = hHe["relation"] ?? "";
      html.push(`  <div class="card">
    <h4>${escapeHtml(String(hlabel))}</h4>
    <p><code>${escapeHtml(String(hrel))}</code> -- ${hnodes.length} participants</p>
    <ul>`);
      for (const hn of hnodes.slice(0, 5)) {
        html.push(`      <li><code>${escapeHtml(String(hn))}</code></li>`);
      }
      if (hnodes.length > 5) html.push(`      <li>... and ${hnodes.length - 5} more</li>`);
      html.push("    </ul>\n  </div>");
    }
    html.push("</div>\n<hr>");
  }

  // Statistics
  const totalSections = sections.filter((s) => s["id"] !== "overview").length;
  html.push(`<h2 id="stats">Project Statistics</h2>

<div class="grid">
  <div class="card">
    <h4>Graph</h4>
    <table style="width:100%;font-size:0.85rem;">
      <tr><td>Nodes</td><td>${nodes.length}</td></tr>
      <tr><td>Edges</td><td>${edges.length}</td></tr>
      <tr><td>Hyperedges</td><td>${hyperedges.length}</td></tr>
      <tr><td>Communities</td><td>${Object.keys(commIdx).length}</td></tr>
      <tr><td>Documented Sections</td><td>${totalSections}</td></tr>
    </table>
  </div>
  <div class="card">
    <h4>Edge Confidence</h4>
    <table style="width:100%;font-size:0.85rem;">
      <tr><td>EXTRACTED</td><td>${edges.filter((e) => e["confidence"] === "EXTRACTED").length}</td></tr>
      <tr><td>INFERRED</td><td>${edges.filter((e) => e["confidence"] === "INFERRED").length}</td></tr>
      <tr><td>AMBIGUOUS</td><td>${edges.filter((e) => e["confidence"] === "AMBIGUOUS").length}</td></tr>
    </table>
  </div>
</div>
`);

  // Footer
  const generatedAt = new Date().toISOString().replace("T", " ").replace(/\.\d+Z/, " UTC");
  html.push(`<div style="text-align:center; padding:40px 0; color: var(--muted); font-size:0.9rem;">
  <p>${escapeHtml(String(meta["project_name"] ?? "Project"))} -- Architecture Documentation</p>
  <p>Generated: ${generatedAt} · graphify callflow-html</p>
</div>
`);

  // Close + Mermaid JS
  html.push(`</div><!-- .container -->

<script>
(function () {
  const mermaidConfig = {
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    flowchart: { htmlLabels: true, useMaxWidth: true },
    themeVariables: {
      primaryColor: '#1e293b',
      primaryTextColor: '#e2e8f0',
      primaryBorderColor: '#38bdf8',
      secondaryColor: '#0f172a',
      tertiaryColor: '#334155',
      lineColor: '#64748b',
      textColor: '#e2e8f0',
    }
  };

  mermaid.initialize(mermaidConfig);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function enhanceMermaidDiagrams() {
    document.querySelectorAll('.mermaid').forEach((container) => {
      if (container.dataset.zoomReady === 'true') return;
      const svg = container.querySelector('svg');
      if (!svg) return;

      container.dataset.zoomReady = 'true';
      container.classList.add('is-enhanced');

      const viewport = document.createElement('div');
      viewport.className = 'mermaid-viewport';
      svg.parentNode.insertBefore(viewport, svg);
      viewport.appendChild(svg);

      const toolbar = document.createElement('div');
      toolbar.className = 'mermaid-toolbar';
      toolbar.innerHTML = [
        '<button type="button" data-action="zoom-out" title="Zoom out">-</button>',
        '<span class="zoom-level" data-role="level">100%</span>',
        '<button type="button" data-action="zoom-in" title="Zoom in">+</button>',
        '<button type="button" data-action="fit" title="Fit width">Fit</button>',
        '<button type="button" data-action="reset" title="Reset view">Reset</button>'
      ].join('');
      container.insertBefore(toolbar, viewport);

      const state = { scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 };
      const level = toolbar.querySelector('[data-role="level"]');

      function applyTransform() {
        svg.style.transform = \`translate(\${state.x}px, \${state.y}px) scale(\${state.scale})\`;
        level.textContent = \`\${Math.round(state.scale * 100)}%\`;
      }

      function zoomBy(delta) {
        state.scale = clamp(state.scale + delta, 0.25, 3);
        applyTransform();
      }

      function reset() {
        state.scale = 1; state.x = 0; state.y = 0;
        applyTransform();
      }

      function fitWidth() {
        const rawWidth = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width
          ? svg.viewBox.baseVal.width
          : svg.getBoundingClientRect().width / state.scale;
        if (!rawWidth) { reset(); return; }
        state.scale = clamp((viewport.clientWidth - 48) / rawWidth, 0.25, 1.4);
        state.x = 0; state.y = 0;
        applyTransform();
      }

      toolbar.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'zoom-in') zoomBy(0.15);
        if (action === 'zoom-out') zoomBy(-0.15);
        if (action === 'fit') fitWidth();
        if (action === 'reset') reset();
      });

      viewport.addEventListener('wheel', (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? 0.1 : -0.1);
      }, { passive: false });

      viewport.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        state.dragging = true;
        state.startX = event.clientX; state.startY = event.clientY;
        state.originX = state.x; state.originY = state.y;
        viewport.classList.add('is-dragging');
        viewport.setPointerCapture(event.pointerId);
      });

      viewport.addEventListener('pointermove', (event) => {
        if (!state.dragging) return;
        state.x = state.originX + event.clientX - state.startX;
        state.y = state.originY + event.clientY - state.startY;
        applyTransform();
      });

      function endDrag(event) {
        if (!state.dragging) return;
        state.dragging = false;
        viewport.classList.remove('is-dragging');
        if (viewport.hasPointerCapture(event.pointerId)) {
          viewport.releasePointerCapture(event.pointerId);
        }
      }

      viewport.addEventListener('pointerup', endDrag);
      viewport.addEventListener('pointercancel', endDrag);
      applyTransform();
    });
  }

  function renderMermaid() {
    const result = mermaid.run
      ? mermaid.run({ querySelector: '.mermaid' })
      : Promise.resolve();
    Promise.resolve(result)
      .then(enhanceMermaidDiagrams)
      .catch((error) => {
        console.error('Mermaid render failed:', error);
        enhanceMermaidDiagrams();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderMermaid);
  } else {
    renderMermaid();
  }
})();
</script>

</body>
</html>`);

  // Write output
  const output = html.join("\n");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, "utf-8");

  return outputPath;
}
