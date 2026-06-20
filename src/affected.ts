import type Graph from "graphology";
import type { AffectedHit } from "./types/affected.js";

export type { AffectedHit } from "./types/affected.js";

export const DEFAULT_AFFECTED_RELATIONS = [
  "calls",
  "references",
  "imports",
  "imports_from",
  "re_exports",
  "inherits",
  "extends",
  "implements",
  "uses",
  "mixes_in",
  "embeds",
] as const;

function _nodeLabel(graph: Graph, nodeId: string): string {
  const attrs = graph.getNodeAttributes(nodeId);
  return String(attrs.label ?? nodeId);
}

function _formatLocation(attrs: Record<string, unknown>): string {
  const sourceFile = String(attrs.source_file ?? "-");
  const sourceLocation = attrs.source_location;
  if (sourceLocation) {
    return `${sourceFile}:${sourceLocation}`;
  }
  return sourceFile;
}

function _normalizeLabel(label: string): string {
  return label.normalize("NFC").toLowerCase();
}

function _bareName(label: string): string {
  const normalized = _normalizeLabel(label);
  return normalized.endsWith("()") ? normalized.slice(0, -2) : normalized;
}

export function resolveSeed(
  graph: Graph,
  query: string,
): string | null {
  // 1. Exact node ID match
  if (graph.hasNode(query)) {
    return query;
  }

  const queryLower = _normalizeLabel(query);

  // 2. Exact label match (unique)
  const exactLabelMatches: string[] = [];
  graph.forEachNode((node, attrs) => {
    if (_normalizeLabel(String(attrs.label ?? "")) === queryLower) {
      exactLabelMatches.push(node);
    }
  });
  if (exactLabelMatches.length === 1) {
    return exactLabelMatches[0];
  }

  // 3. Bare name match (strips trailing "()" from callable labels)
  const queryBare = _bareName(queryLower);
  const bareNameMatches: string[] = [];
  graph.forEachNode((node, attrs) => {
    if (_bareName(String(attrs.label ?? "")) === queryBare) {
      bareNameMatches.push(node);
    }
  });
  if (bareNameMatches.length === 1) {
    return bareNameMatches[0];
  }

  // 4. Exact source_file match
  const exactSourceMatches: string[] = [];
  graph.forEachNode((node, attrs) => {
    if (_normalizeLabel(String(attrs.source_file ?? "")) === queryLower) {
      exactSourceMatches.push(node);
    }
  });
  if (exactSourceMatches.length === 1) {
    return exactSourceMatches[0];
  }

  // 5. Contains match (label contains query string)
  const containsMatches: string[] = [];
  graph.forEachNode((node, attrs) => {
    if (_normalizeLabel(String(attrs.label ?? "")).includes(queryLower)) {
      containsMatches.push(node);
    }
  });
  if (containsMatches.length === 1) {
    return containsMatches[0];
  }

  return null;
}

export function affectedNodes(
  graph: Graph,
  seed: string,
  options?: {
    relations?: readonly string[];
    depth?: number;
  },
): AffectedHit[] {
  const relations = options?.relations ?? DEFAULT_AFFECTED_RELATIONS;
  const depth = options?.depth ?? 2;
  const relationSet = new Set<string>(relations);
  const seen = new Set<string>([seed]);
  const queue: Array<[string, number]> = [[seed, 0]];
  const hits: AffectedHit[] = [];

  while (queue.length > 0) {
    const [current, currentDepth] = queue.shift()!;
    if (currentDepth >= depth) {
      continue;
    }
    // In graphology, forEachEdge gives us (key, attrs, source, target)
    // We need incoming edges: edges where target === current
    graph.forEachEdge(
      (key, attrs, source, target) => {
        if (target !== current) return;
        const relation = String(attrs.relation ?? "");
        if (!relationSet.has(relation)) return;
        if (seen.has(source)) return;
        seen.add(source);
        hits.push({
          nodeId: source,
          depth: currentDepth + 1,
          viaRelation: relation,
        });
        queue.push([source, currentDepth + 1]);
      },
    );
  }

  return hits;
}

export function formatAffected(
  graph: Graph,
  query: string,
  options?: {
    relations?: readonly string[];
    depth?: number;
  },
): string {
  const relations = options?.relations ?? DEFAULT_AFFECTED_RELATIONS;
  const depth = options?.depth ?? 2;
  const relationList = Array.from(relations);

  const seed = resolveSeed(graph, query);
  if (seed === null) {
    return `No unique node match for ${query}`;
  }

  const hits = affectedNodes(graph, seed, { relations, depth });
  const lines: string[] = [
    `Affected nodes for ${_nodeLabel(graph, seed)}`,
    `Relations: ${relationList.join(", ")}`,
    `Depth: ${depth}`,
  ];
  if (hits.length === 0) {
    lines.push("No affected nodes found.");
    return lines.join("\n");
  }

  for (const hit of hits) {
    const attrs = graph.getNodeAttributes(hit.nodeId);
    lines.push(
      `- ${_nodeLabel(graph, hit.nodeId)} [${hit.viaRelation}] ${_formatLocation(attrs)}`,
    );
  }
  return lines.join("\n");
}
