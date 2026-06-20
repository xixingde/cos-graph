/** Markdown report generation — the human-readable audit trail.
 *
 *  Ported from graphify/report.py (218 lines).
 */
import type Graph from "graphology";

import { isFileNode, isConceptNode, findImportCycles } from "./analyze.js";
import { degree } from "./graph/operations.js";
import type {
  GodNode,
  SurprisingConnection,
  SuggestedQuestion,
  ImportCycle,
  ConfidenceLevel,
} from "./types/report.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Mirrors export.safeName so community hub filenames and report wikilinks always agree. */
export function safeCommunityName(label: string): string {
  let cleaned = label
    .replace(/\r\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/[\\/*?:"<>|#^[\]]/g, "")
    .trim();
  cleaned = cleaned.replace(/\.(md|mdx|markdown)$/i, "");
  return cleaned || "unnamed";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// ── generate ─────────────────────────────────────────────────────────────────

export interface DetectionResult {
  warning?: string;
  totalFiles?: number;
  totalWords?: number;
}

export interface GenerateOptions {
  graph: Graph;
  communities: Record<number, string[]>;
  cohesionScores: Record<number, number>;
  communityLabels: Record<number, string>;
  godNodeList: GodNode[];
  surpriseList: SurprisingConnection[];
  detectionResult: DetectionResult;
  tokenCost: { input?: number; output?: number };
  root: string;
  suggestedQuestions?: SuggestedQuestion[];
  minCommunitySize?: number;
  builtAtCommit?: string;
}

export function generate(opts: GenerateOptions): string {
  const {
    graph,
    communities,
    cohesionScores,
    communityLabels: rawLabels,
    godNodeList,
    surpriseList,
    detectionResult,
    tokenCost,
    root,
    suggestedQuestions,
    minCommunitySize = 3,
    builtAtCommit,
  } = opts;

  const today = new Date().toISOString().split("T")[0];

  // JSON deserialization may produce string keys; normalize to int so .get(cid) works.
  const communityLabels: Record<number, string> = {};
  for (const [k, v] of Object.entries(rawLabels)) {
    communityLabels[Number(k)] = v;
  }

  // ── confidence stats ─────────────────────────────────────────────────────
  const confidences: ConfidenceLevel[] = [];
  graph.forEachEdge((_edge, attrs) => {
    confidences.push((attrs?.confidence as ConfidenceLevel) || "EXTRACTED");
  });
  const total = confidences.length || 1;
  const extCount = confidences.filter((c) => c === "EXTRACTED").length;
  const infCount = confidences.filter((c) => c === "INFERRED").length;
  const ambCount = confidences.filter((c) => c === "AMBIGUOUS").length;
  const extPct = Math.round((extCount / total) * 100);
  const infPct = Math.round((infCount / total) * 100);
  const ambPct = Math.round((ambCount / total) * 100);

  // INFERRED edge stats
  const infEdgeAttrs: Array<Record<string, unknown>> = [];
  graph.forEachEdge((_edge, attrs) => {
    if (attrs?.confidence === "INFERRED") {
      infEdgeAttrs.push(attrs as Record<string, unknown>);
    }
  });
  const infScores = infEdgeAttrs.map((a) => (a.confidence_score as number) ?? 0.5);
  const infAvg =
    infScores.length > 0
      ? Math.round((infScores.reduce((s, v) => s + v, 0) / infScores.length) * 100) / 100
      : null;

  // ── start building report ────────────────────────────────────────────────
  const lines: string[] = [
    `# Graph Report - ${root}  (${today})`,
    "",
    "## Corpus Check",
  ];

  if (detectionResult.warning) {
    lines.push(`- ${detectionResult.warning}`);
  } else {
    lines.push(
      `- ${fmt(detectionResult.totalFiles ?? 0)} files · ~${fmt(detectionResult.totalWords ?? 0)} words`
    );
    lines.push("- Verdict: corpus is large enough that graph structure adds value.");
  }

  // ── non-empty communities & thin count ───────────────────────────────────
  const nonEmpty: Record<number, string[]> = {};
  for (const [cid, nodes] of Object.entries(communities)) {
    if (nodes.some((n) => !isFileNode(graph, n))) {
      nonEmpty[Number(cid)] = nodes;
    }
  }

  const thinCountSummary = Object.values(communities).filter((nodes) => {
    const realCount = nodes.filter((n) => !isFileNode(graph, n)).length;
    return realCount > 0 && realCount < minCommunitySize;
  }).length;

  const shownCount = Object.keys(communities).length - thinCountSummary;

  // ── Summary ──────────────────────────────────────────────────────────────
  lines.push("");
  lines.push("## Summary");
  let summaryLine1 = `- ${fmt(graph.order)} nodes · ${fmt(graph.size)} edges · ${fmt(Object.keys(communities).length)} communities`;
  if (thinCountSummary) {
    summaryLine1 += ` (${fmt(shownCount)} shown, ${fmt(thinCountSummary)} thin omitted)`;
  }
  lines.push(summaryLine1);

  let summaryLine2 = `- Extraction: ${extPct}% EXTRACTED · ${infPct}% INFERRED · ${ambPct}% AMBIGUOUS`;
  if (infAvg !== null) {
    summaryLine2 += ` · INFERRED: ${fmt(infEdgeAttrs.length)} edges (avg confidence: ${infAvg})`;
  }
  lines.push(summaryLine2);

  lines.push(
    `- Token cost: ${fmt(tokenCost.input ?? 0)} input · ${fmt(tokenCost.output ?? 0)} output`
  );

  // ── Graph Freshness ──────────────────────────────────────────────────────
  if (builtAtCommit) {
    lines.push("", "## Graph Freshness");
    lines.push(`- Built from commit: \`${builtAtCommit.slice(0, 8)}\``);
    lines.push("- Run `git rev-parse HEAD` and compare to check if the graph is stale.");
    lines.push("- Run `graphify update .` after code changes (no API cost).");
  }

  // ── Community Hubs ───────────────────────────────────────────────────────
  if (Object.keys(nonEmpty).length > 0) {
    lines.push("", "## Community Hubs (Navigation)");
    for (const cid of Object.keys(nonEmpty).map(Number)) {
      const label = communityLabels[cid] ?? `Community ${cid}`;
      const safe = safeCommunityName(label);
      lines.push(`- [[_COMMUNITY_${safe}|${label}]]`);
    }
  }

  // ── God Nodes ────────────────────────────────────────────────────────────
  lines.push("", "## God Nodes (most connected - your core abstractions)");
  for (let i = 0; i < godNodeList.length; i++) {
    const node = godNodeList[i];
    lines.push(`${i + 1}. \`${node.label}\` - ${node.degree} edges`);
  }

  // ── Surprising Connections ───────────────────────────────────────────────
  lines.push("", "## Surprising Connections (you probably didn't know these)");
  if (surpriseList.length > 0) {
    for (const s of surpriseList) {
      const relation = s.relation || "related_to";
      const note = s.note || "";
      const files = s.sourceFiles || ["", ""];
      const conf = s.confidence || "EXTRACTED";
      const cscore = s.confidenceScore;
      const confTag =
        conf === "INFERRED" && cscore != null
          ? `INFERRED ${cscore.toFixed(2)}`
          : conf;
      const semTag = relation === "semantically_similar_to" ? " [semantically similar]" : "";
      lines.push(
        `- \`${s.source}\` --${relation}--> \`${s.target}\`  [${confTag}]${semTag}`
      );
      lines.push(
        `  ${files[0]} → ${files[1]}` + (note ? `  _${note}_` : "")
      );
    }
  } else {
    lines.push("- None detected - all connections are within the same source files.");
  }

  // ── Import Cycles ────────────────────────────────────────────────────────
  const cycles: ImportCycle[] = findImportCycles(graph);
  lines.push("", "## Import Cycles");
  if (cycles.length > 0) {
    for (const c of cycles) {
      const cycle = c.cycle || [];
      const length = c.length ?? cycle.length;
      if (!cycle.length) continue;
      const cyclePath = [...cycle, cycle[0]].join(" -> ");
      lines.push(`- ${length}-file cycle: \`${cyclePath}\``);
    }
  } else {
    lines.push("- None detected.");
  }

  // ── Hyperedges ──────────────────────────────────────────────────────────
  const hyperedges = (graph.getAttribute("hyperedges") ?? []) as Array<Record<string, unknown>>;
  if (hyperedges.length > 0) {
    lines.push("", "## Hyperedges (group relationships)");
    for (const h of hyperedges) {
      const nodeLabels = (h.nodes as string[] || []).join(", ");
      const conf = (h.confidence as string) || "INFERRED";
      const cscore = h.confidence_score as number | undefined;
      const confTag = cscore != null ? `${conf} ${cscore.toFixed(2)}` : conf;
      const hLabel = (h.label as string) || (h.id as string) || "";
      lines.push(`- **${hLabel}** — ${nodeLabels} [${confTag}]`);
    }
  }

  // ── Communities detail ──────────────────────────────────────────────────
  lines.push(
    "",
    `## Communities (${fmt(Object.keys(communities).length)} total, ${fmt(thinCountSummary)} thin omitted)`
  );
  for (const [cid, nodes] of Object.entries(communities)) {
    const cidNum = Number(cid);
    const label = communityLabels[cidNum] ?? `Community ${cidNum}`;
    const score = cohesionScores[cidNum] ?? 0.0;
    const realNodes = nodes.filter((n) => !isFileNode(graph, n));
    if (realNodes.length === 0) continue;
    if (realNodes.length < minCommunitySize) continue;

    const display = realNodes.slice(0, 8).map((n) => {
      const attrs = graph.getNodeAttributes(n);
      return (attrs?.label as string) || n;
    });
    const suffix = realNodes.length > 8 ? ` (+${realNodes.length - 8} more)` : "";

    lines.push("");
    lines.push(`### Community ${cidNum} - "${label}"`);
    lines.push(`Cohesion: ${score.toFixed(2)}`);
    lines.push(`Nodes (${fmt(realNodes.length)}): ${display.join(", ")}${suffix}`);
  }

  // ── Ambiguous Edges ─────────────────────────────────────────────────────
  const ambiguous: Array<{ u: string; v: string; attrs: Record<string, unknown> }> = [];
  graph.forEachEdge((_edge, attrs, src, tgt) => {
    if (attrs?.confidence === "AMBIGUOUS") {
      ambiguous.push({ u: src as string, v: tgt as string, attrs: attrs as Record<string, unknown> });
    }
  });

  if (ambiguous.length > 0) {
    lines.push("", "## Ambiguous Edges - Review These");
    for (const { u, v, attrs } of ambiguous) {
      const uAttrs = graph.getNodeAttributes(u);
      const vAttrs = graph.getNodeAttributes(v);
      const ul = (uAttrs?.label as string) || u;
      const vl = (vAttrs?.label as string) || v;
      lines.push(`- \`${ul}\` → \`${vl}\`  [AMBIGUOUS]`);
      lines.push(
        `  ${(attrs.source_file as string) || ""} · relation: ${(attrs.relation as string) || "unknown"}`
      );
    }
  }

  // ── Knowledge Gaps ──────────────────────────────────────────────────────
  const isolated: string[] = [];
  for (const n of graph.nodes()) {
    if (
      degree(graph, n) <= 1 &&
      !isFileNode(graph, n) &&
      !isConceptNode(graph, n) &&
      (graph.getNodeAttributes(n)?.file_type as string) !== "rationale"
    ) {
      isolated.push(n);
    }
  }

  const thinCommunities: Record<number, string[]> = {};
  for (const [cid, nodes] of Object.entries(communities)) {
    const realCount = nodes.filter((n) => !isFileNode(graph, n)).length;
    if (realCount > 0 && realCount < 3) {
      thinCommunities[Number(cid)] = nodes;
    }
  }

  const gapCount = isolated.length + Object.keys(thinCommunities).length;

  if (gapCount > 0 || ambPct > 20) {
    lines.push("", "## Knowledge Gaps");
    if (isolated.length > 0) {
      const isolatedLabels = isolated.slice(0, 5).map((n) => {
        const attrs = graph.getNodeAttributes(n);
        return `\`${(attrs?.label as string) || n}\``;
      });
      const suffix = isolated.length > 5 ? ` (+${isolated.length - 5} more)` : "";
      lines.push(
        `- **${fmt(isolated.length)} isolated node(s):** ${isolatedLabels.join(", ")}${suffix}`
      );
      lines.push(
        "  These have ≤1 connection - possible missing edges or undocumented components."
      );
    }
    if (Object.keys(thinCommunities).length > 0) {
      lines.push(
        `- **${fmt(Object.keys(thinCommunities).length)} thin communities (<${minCommunitySize} nodes) omitted from report** — run \`graphify query\` to explore isolated nodes.`
      );
    }
    if (ambPct > 20) {
      lines.push(
        `- **High ambiguity: ${ambPct}% of edges are AMBIGUOUS.** Review the Ambiguous Edges section above.`
      );
    }
  }

  // ── Suggested Questions ──────────────────────────────────────────────────
  if (suggestedQuestions && suggestedQuestions.length > 0) {
    lines.push("", "## Suggested Questions");
    const noSignal =
      suggestedQuestions.length === 1 && suggestedQuestions[0].type === "no_signal";
    if (noSignal) {
      lines.push(`_${suggestedQuestions[0].why}_`);
    } else {
      lines.push("_Questions this graph is uniquely positioned to answer:_");
      lines.push("");
      for (const q of suggestedQuestions) {
        if (q.question) {
          lines.push(`- **${q.question}**`);
          lines.push(`  _${q.why}_`);
        }
      }
    }
  }

  return lines.join("\n");
}
