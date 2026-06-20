// assemble node+edge dicts into a Graphology graph, preserving edge direction
//
// Node deduplication — three layers:
//
// 1. Within a file (AST): each extractor tracks a `seen_ids` set. A node ID is
//    emitted at most once per file, so duplicate class/function definitions in
//    the same source file are collapsed to the first occurrence.
//
// 2. Between files (build): Graphology addNode() is idempotent — calling it
//    twice with the same ID merges the attributes. Nodes are added in extraction
//    order (AST first, then semantic), so if the same entity is extracted by both
//    passes the semantic node silently overwrites the AST node. This is intentional:
//    semantic nodes carry richer labels and cross-file context, while AST nodes have
//    precise source_location. If you need to change the priority, reorder extractions
//    passed to build().
//
// 3. Semantic merge (skill): before calling build(), the skill merges cached
//    and new semantic results using an explicit `seen` set keyed on node["id"],
//    so duplicates across cache hits and new extractions are resolved there
//    before any graph construction happens.

import * as fs from "fs";
import * as path from "path";
import type Graph from "graphology";
import { createGraph } from "./graph/factory.js";
import { validateExtraction } from "./validate.js";

// Synonym mapper for known invalid file_type values that LLM subagents commonly
// emit. Keeps semantic intent close (markdown→document, tool→code) and falls
// back to "concept" for any other invalid value (see #840).
const FILE_TYPE_SYNONYMS: Record<string, string> = {
  markdown: "document",
  text: "document",
  tool: "code",
  library: "code",
  pattern: "concept",
  principle: "concept",
  constraint: "concept",
  tech: "concept",
  technology: "concept",
  "data-source": "concept",
  data_source: "concept",
  gotcha: "concept",
  framework: "concept",
};

const VALID_FILE_TYPE_SET = new Set<string>([
  "code",
  "document",
  "paper",
  "image",
  "rationale",
  "concept",
]);

// Language family mapping for cross-language INFERRED calls edge filtering
const LANG_FAMILY: Record<string, string> = {
  ".py": "py", ".pyi": "py",
  ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "js",
  ".ts": "js", ".tsx": "js",
  ".go": "go", ".rs": "rs",
  ".java": "jvm", ".kt": "jvm", ".scala": "jvm", ".groovy": "jvm",
  ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".hpp": "cpp",
  ".rb": "rb", ".php": "php", ".cs": "cs", ".swift": "swift", ".lua": "lua",
};

export function normalizeId(s: string): string {
  let cleaned = s.normalize("NFKC");
  cleaned = cleaned.replace(/[^\w]+/gu, "_");
  cleaned = cleaned.replace(/_+/g, "_");
  return cleaned.replace(/^_+|_+$/g, "").toLowerCase();
}

export function normSourceFile(
  p: string | null | undefined,
  root?: string | null
): string | null {
  if (!p) return p ?? null;
  p = p.replace(/\\/g, "/");
  if (root && path.isAbsolute(p)) {
    try {
      p = path.relative(root, p).replace(/\\/g, "/");
    } catch {
      // path.relative can throw on Windows with different drives; leave as-is
    }
  }
  return p;
}

export function edgeData(
  graph: Graph,
  u: string,
  v: string
): Record<string, unknown> {
  if (!graph.hasEdge(u, v)) return {};
  const edgeKey = graph.edge(u, v);
  if (edgeKey === undefined) return {};
  return graph.getEdgeAttributes(edgeKey) as Record<string, unknown>;
}

export function edgeDatas(
  graph: Graph,
  u: string,
  v: string
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  if (!graph.hasEdge(u, v)) return result;
  // For simple graphs, one edge per (u,v); for multi, collect all
  const edgeKey = graph.edge(u, v);
  if (edgeKey !== undefined) {
    result.push(graph.getEdgeAttributes(edgeKey) as Record<string, unknown>);
  }
  return result;
}

export function dedupeNodes(
  nodes: Record<string, unknown>[]
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const n of nodes) {
    const nid = n["id"] as string | undefined;
    if (nid === undefined || nid === null) continue;
    byId.set(nid, n);
  }
  return [...byId.values()];
}

export function dedupeEdges(
  edges: Record<string, unknown>[]
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const e of edges) {
    const key = `${e["source"]}\0${e["target"]}\0${e["relation"]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export function buildFromJson(
  extraction: Record<string, unknown>,
  options?: { directed?: boolean; root?: string }
): Graph {
  const directed = options?.directed ?? false;
  const root = options?.root;
  const _root = root ? path.resolve(root) : null;

  // NetworkX <= 3.1 serialised edges as "links"; remap to "edges" for compatibility.
  const extractionNodes = (extraction["nodes"] as Record<string, unknown>[]) ?? [];
  const extractionEdges = (() => {
    if (extraction["edges"] && Array.isArray(extraction["edges"])) {
      return extraction["edges"] as Record<string, unknown>[];
    }
    if (extraction["links"] && Array.isArray(extraction["links"])) {
      return extraction["links"] as Record<string, unknown>[];
    }
    return [];
  })();

  // Canonicalize legacy node/edge schema before validation.
  for (const node of extractionNodes) {
    if (typeof node !== "object" || node === null) continue;
    if ("source" in node && !("source_file" in node)) {
      const nodeId = (node["id"] as string) ?? "?";
      const affectedEdges = extractionEdges.filter(
        (e) => e["source"] === nodeId || e["target"] === nodeId
      );
      console.warn(
        `[graphify] WARNING: node '${nodeId}' uses field 'source' instead of ` +
          `'source_file' — ${affectedEdges.length} edge(s) may be misrouted. ` +
          `Rename the field to 'source_file' to silence this warning.`
      );
      node["source_file"] = node["source"];
      delete node["source"];
    }
    if (
      node["file_type"] === null ||
      node["file_type"] === undefined ||
      node["file_type"] === ""
    ) {
      node["file_type"] = "concept";
    }
    const ft = node["file_type"] as string;
    if (ft && !VALID_FILE_TYPE_SET.has(ft)) {
      node["file_type"] = FILE_TYPE_SYNONYMS[ft] ?? "concept";
    }
  }

  const validationExtraction: Record<string, unknown> = {
    ...extraction,
    nodes: extractionNodes,
    edges: extractionEdges,
  };
  const errors = validateExtraction(validationExtraction);
  const realErrors = errors.filter((e) => !e.includes("does not match any node id"));
  if (realErrors.length > 0) {
    console.warn(
      `[graphify] Extraction warning (${realErrors.length} issues): ${realErrors[0]}`
    );
  }

  const G = createGraph(directed);
  for (const node of extractionNodes) {
    const nodeId = node["id"] as string;
    if ("source_file" in node) {
      node["source_file"] = normSourceFile(node["source_file"] as string, _root);
    }
    const { id: _id, ...attrs } = node;
    if (!G.hasNode(nodeId)) {
      G.addNode(nodeId, attrs);
    } else {
      G.mergeNodeAttributes(nodeId, attrs);
    }
  }
  const nodeSet = new Set(G.nodes());

  // #1145 (extended): merge LLM ghost-duplicate nodes into AST canonical nodes.
  const _locNodes = new Map<string, string>(); // (basename, label) -> canonical node id
  const _locCollisions = new Set<string>(); // keys shared by 2+ AST nodes
  const _nolocNodes = new Map<string, string>(); // (basename, label) -> ghost node id

  // Pass 1: collect canonical nodes — AST-origin nodes take precedence.
  for (const nid of nodeSet) {
    const attrs = G.getNodeAttributes(nid);
    const label = String(attrs["label"] ?? "").trim();
    const sf = String(attrs["source_file"] ?? "");
    const basename = sf ? path.basename(sf) : "";
    if (!label || !basename) continue;
    const isAst = attrs["_origin"] === "ast";
    const key = `${basename}\0${label}`;
    if (attrs["source_location"] || isAst) {
      if (isAst) {
        if (
          _locNodes.has(key) &&
          G.getNodeAttributes(_locNodes.get(key)!)["_origin"] === "ast"
        ) {
          _locCollisions.add(key);
        }
        _locNodes.set(key, nid);
      } else if (!_locNodes.has(key)) {
        _locNodes.set(key, nid);
      }
    }
  }

  // Pass 2: find ghosts — non-AST nodes that have an AST canonical twin.
  for (const nid of nodeSet) {
    const attrs = G.getNodeAttributes(nid);
    if (attrs["_origin"] === "ast") continue;
    const label = String(attrs["label"] ?? "").trim();
    const sf = String(attrs["source_file"] ?? "");
    const basename = sf ? path.basename(sf) : "";
    if (!label || !basename) continue;
    const key = `${basename}\0${label}`;
    if (_locCollisions.has(key)) continue;
    if (_locNodes.has(key) && _locNodes.get(key) !== nid) {
      _nolocNodes.set(key, nid);
    }
  }

  const _ghostRemap = new Map<string, string>(); // ghost_id -> canonical_id
  for (const [key, semId] of _nolocNodes) {
    const astId = _locNodes.get(key);
    if (astId !== undefined) {
      _ghostRemap.set(semId, astId);
    }
  }

  for (const ghostId of _ghostRemap.keys()) {
    G.dropNode(ghostId);
    nodeSet.delete(ghostId);
  }

  const normToId = new Map<string, string>();
  for (const nid of nodeSet) {
    normToId.set(normalizeId(nid), nid);
  }
  for (const [ghostId, canonicalId] of _ghostRemap) {
    normToId.set(normalizeId(ghostId), canonicalId);
    normToId.set(ghostId, canonicalId);
  }

  const sortedEdges = [...extractionEdges].sort((a, b) => {
    const aSrc = String(a["source"] ?? a["from"] ?? "");
    const bSrc = String(b["source"] ?? b["from"] ?? "");
    const aTgt = String(a["target"] ?? a["to"] ?? "");
    const bTgt = String(b["target"] ?? b["to"] ?? "");
    const aRel = String(a["relation"] ?? "");
    const bRel = String(b["relation"] ?? "");
    if (aSrc !== bSrc) return aSrc < bSrc ? -1 : 1;
    if (aTgt !== bTgt) return aTgt < bTgt ? -1 : 1;
    if (aRel !== bRel) return aRel < bRel ? -1 : 1;
    return 0;
  });

  for (const edge of sortedEdges) {
    if (!("source" in edge) && "from" in edge) {
      edge["source"] = edge["from"];
    }
    if (!("target" in edge) && "to" in edge) {
      edge["target"] = edge["to"];
    }
    if (!("source" in edge) || !("target" in edge)) continue;

    let src = edge["source"] as string;
    let tgt = edge["target"] as string;

    if (!nodeSet.has(src)) {
      src = normToId.get(normalizeId(src)) ?? src;
    }
    if (!nodeSet.has(tgt)) {
      tgt = normToId.get(normalizeId(tgt)) ?? tgt;
    }
    if (!nodeSet.has(src) || !nodeSet.has(tgt)) continue;

    const attrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(edge)) {
      if (k !== "source" && k !== "target") {
        attrs[k] = v;
      }
    }

    // Backfill source_file from the endpoint nodes.
    if (!attrs["source_file"]) {
      attrs["source_file"] =
        G.getNodeAttributes(src)["source_file"] ??
        G.getNodeAttributes(tgt)["source_file"] ??
        "";
    }
    if ("source_file" in attrs) {
      attrs["source_file"] = normSourceFile(attrs["source_file"] as string, _root);
    }

    // Drop cross-language INFERRED `calls` edges
    if (attrs["relation"] === "calls" && attrs["confidence"] === "INFERRED") {
      const srcSf = (G.getNodeAttributes(src)["source_file"] as string) ?? "";
      const tgtSf = (G.getNodeAttributes(tgt)["source_file"] as string) ?? "";
      const srcExt = path.extname(srcSf).toLowerCase();
      const tgtExt = path.extname(tgtSf).toLowerCase();
      if (srcExt && tgtExt && LANG_FAMILY[srcExt] !== LANG_FAMILY[tgtExt]) {
        continue;
      }
    }

    // Preserve original edge direction
    attrs["_src"] = src;
    attrs["_tgt"] = tgt;

    // When the graph is undirected and the same node pair appears twice with
    // the same relation but opposite directions, first-seen direction wins.
    const isUndirected = G.type !== "directed";
    if (isUndirected && G.hasEdge(src, tgt)) {
      const existingKey = G.edge(src, tgt);
      if (existingKey !== undefined) {
        const existing = G.getEdgeAttributes(existingKey) as Record<string, unknown>;
        if (
          existing["relation"] === attrs["relation"] &&
          existing["_src"] === tgt &&
          existing["_tgt"] === src
        ) {
          continue;
        }
      }
    }

    if (G.hasEdge(src, tgt)) {
      const existingKey = G.edge(src, tgt);
      if (existingKey !== undefined) {
        G.mergeEdgeAttributes(existingKey, attrs);
      }
    } else {
      G.addEdge(src, tgt, attrs);
    }
  }

  const hyperedges = extraction["hyperedges"] as unknown[];
  if (hyperedges && hyperedges.length > 0) {
    G.setAttribute("hyperedges", hyperedges);
  }

  return G;
}

export function build(
  extractions: Record<string, unknown>[],
  options?: { directed?: boolean; root?: string }
): Graph {
  const combined: Record<string, unknown> = {
    nodes: [] as Record<string, unknown>[],
    edges: [] as Record<string, unknown>[],
    hyperedges: [] as unknown[],
    input_tokens: 0,
    output_tokens: 0,
  };
  for (const ext of extractions) {
    (combined["nodes"] as Record<string, unknown>[]).push(
      ...((ext["nodes"] as Record<string, unknown>[]) ?? [])
    );
    (combined["edges"] as Record<string, unknown>[]).push(
      ...((ext["edges"] as Record<string, unknown>[]) ?? [])
    );
    (combined["hyperedges"] as unknown[]).push(
      ...((ext["hyperedges"] as unknown[]) ?? [])
    );
    combined["input_tokens"] =
      (combined["input_tokens"] as number) +
      ((ext["input_tokens"] as number) ?? 0);
    combined["output_tokens"] =
      (combined["output_tokens"] as number) +
      ((ext["output_tokens"] as number) ?? 0);
  }
  return buildFromJson(combined, options);
}

function normLabel(label: string | null | undefined): string {
  if (typeof label !== "string") {
    label = label === null || label === undefined ? "" : String(label);
  }
  label = label.normalize("NFKC");
  return label
    .toLowerCase()
    .replace(/[\W_ ]+/gu, " ")
    .trim();
}

const CHUNK_SUFFIX = /_c\d+$/;

export function deduplicateByLabel(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[]
): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  const canonical = new Map<string, Record<string, unknown>>();
  const remap = new Map<string, string>();

  for (const node of nodes) {
    const key = normLabel(
      (node["label"] as string) ?? (node["id"] as string) ?? ""
    );
    if (!key) continue;
    const existing = canonical.get(key);
    if (existing === undefined) {
      canonical.set(key, node);
    } else {
      const hasSuffix = CHUNK_SUFFIX.test(node["id"] as string);
      const existingHasSuffix = CHUNK_SUFFIX.test(existing["id"] as string);
      if (hasSuffix && !existingHasSuffix) {
        remap.set(node["id"] as string, existing["id"] as string);
      } else if (existingHasSuffix && !hasSuffix) {
        remap.set(existing["id"] as string, node["id"] as string);
        canonical.set(key, node);
      } else if ((node["id"] as string).length < (existing["id"] as string).length) {
        remap.set(existing["id"] as string, node["id"] as string);
        canonical.set(key, node);
      } else {
        remap.set(node["id"] as string, existing["id"] as string);
      }
    }
  }

  if (remap.size === 0) return { nodes, edges };

  console.warn(
    `[graphify] Deduplicated ${remap.size} duplicate node(s) by label.`
  );
  const dedupedNodes = [...canonical.values()];
  const dedupedEdges: Record<string, unknown>[] = [];
  for (const edge of edges) {
    const e = { ...edge };
    e["source"] = remap.get(e["source"] as string) ?? e["source"];
    e["target"] = remap.get(e["target"] as string) ?? e["target"];
    if (e["source"] !== e["target"]) {
      dedupedEdges.push(e);
    }
  }
  return { nodes: dedupedNodes, edges: dedupedEdges };
}

export function buildMerge(
  newChunks: Record<string, unknown>[],
  existingPath: string,
  options?: {
    directed?: boolean;
    root?: string;
    pruneSources?: string[];
  }
): Graph {
  const directed = options?.directed ?? false;
  const root = options?.root;
  const pruneSources = options?.pruneSources;
  const _root = root ? path.resolve(root) : null;

  let existingNodes: Record<string, unknown>[] = [];
  let existingEdges: Record<string, unknown>[] = [];
  let hadGraph = false;

  if (fs.existsSync(existingPath)) {
    const data = JSON.parse(
      fs.readFileSync(existingPath, { encoding: "utf-8" })
    ) as Record<string, unknown>;
    const linksKey = "links" in data ? "links" : "edges";
    existingNodes = [...((data["nodes"] as Record<string, unknown>[]) ?? [])];
    existingEdges = [...((data[linksKey] as Record<string, unknown>[]) ?? [])];
    hadGraph = true;
  }

  // Re-extracted files REPLACE their prior contribution.
  const _replaceRoot = root ? path.resolve(root) : null;
  const newSources = new Set<string>();
  for (const ch of newChunks) {
    for (const n of (ch["nodes"] as Record<string, unknown>[]) ?? []) {
      const sf = n["source_file"] as string | undefined;
      if (!sf) continue;
      newSources.add(sf);
      const norm = normSourceFile(sf, _replaceRoot);
      if (norm) newSources.add(norm);
    }
  }
  if (newSources.size > 0) {
    const keptSimple = (item: Record<string, unknown>): boolean => {
      const sf = item["source_file"] as string | undefined;
      if (sf && newSources.has(sf)) return false;
      const norm = normSourceFile(sf, _replaceRoot);
      if (norm && newSources.has(norm)) return false;
      return true;
    };
    existingNodes = existingNodes.filter(keptSimple);
    existingEdges = existingEdges.filter(keptSimple);
  }

  const base: Record<string, unknown>[] = hadGraph
    ? [{ nodes: existingNodes, edges: existingEdges }]
    : [];
  const allChunks = [...base, ...newChunks];
  const G = build(allChunks, { directed, root });

  // Prune nodes and edges from deleted source files
  if (pruneSources && pruneSources.length > 0) {
    const _rootStr = root ? path.resolve(root) : null;
    const pruneSet = new Set<string>();
    for (const p of pruneSources) {
      if (!p) continue;
      pruneSet.add(p);
      const norm = normSourceFile(p, _rootStr);
      if (norm) pruneSet.add(norm);
    }

    const toRemove: string[] = [];
    G.forEachNode((nid: string, attrs: Record<string, unknown>) => {
      if (pruneSet.has(attrs["source_file"] as string)) {
        toRemove.push(nid);
      }
    });
    for (const nid of toRemove) {
      G.dropNode(nid);
    }
    const nFiles = pruneSources.length;
    const nNodes = toRemove.length;
    if (nNodes > 0) {
      console.warn(
        `[graphify] Pruned ${nNodes} node(s) from ${nFiles} deleted source file(s).`
      );
    }

    const edgesToRemove: string[] = [];
    G.forEachEdge((edgeKey: string, attrs: Record<string, unknown>) => {
      if (pruneSet.has(attrs["source_file"] as string)) {
        edgesToRemove.push(edgeKey);
      }
    });
    for (const ek of edgesToRemove) {
      G.dropEdge(ek);
    }
    if (edgesToRemove.length > 0) {
      console.warn(
        `[graphify] Pruned ${edgesToRemove.length} edge(s) from deleted source file(s).`
      );
    }

    if (nNodes === 0 && edgesToRemove.length === 0) {
      console.warn(
        `[graphify] ${nFiles} source file(s) deleted since last run — ` +
          `no matching nodes or edges in graph, already clean.`
      );
    }
  }

  // Safety check: refuse to shrink the graph silently (#479)
  // Skip when pruneSources is active — shrinkage is intentional there.
  if (fs.existsSync(existingPath) && !pruneSources) {
    const existingN = existingNodes.length;
    const newN = G.order;
    if (newN < existingN) {
      throw new Error(
        `graphify: build_merge would shrink graph from ${existingN} → ${newN} nodes. ` +
          `Pass pruneSources explicitly if you intend to remove nodes.`
      );
    }
  }

  return G;
}

export function prefixGraphForGlobal(graph: Graph, prefix: string): Graph {
  const H = createGraph(graph.type === "directed");

  graph.forEachNode((node: string, attrs: Record<string, unknown>) => {
    const newId = `${prefix}::${node}`;
    H.addNode(newId, {
      ...attrs,
      repo: prefix,
      local_id: node,
    });
  });

  graph.forEachEdge(
    (
      _edge: string,
      attrs: Record<string, unknown>,
      source: string,
      target: string
    ) => {
      const newSource = `${prefix}::${source}`;
      const newTarget = `${prefix}::${target}`;
      if (H.hasNode(newSource) && H.hasNode(newTarget)) {
        H.addEdge(newSource, newTarget, attrs);
      }
    }
  );

  return H;
}

export function pruneRepoFromGraph(
  graph: Graph,
  repoName: string
): number {
  const toRemove: string[] = [];
  graph.forEachNode((nid: string, attrs: Record<string, unknown>) => {
    if (attrs["repo"] === repoName) {
      toRemove.push(nid);
    }
  });
  for (const nid of toRemove) {
    graph.dropNode(nid);
  }
  return toRemove.length;
}
