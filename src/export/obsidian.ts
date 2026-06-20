import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type Graph from "graphology";
import { nodeCommunityMap } from "../analyze.js";
import { degree, neighbors, getNodeAttributes } from "../graph/operations.js";

/** Sanitize a community name for use as an Obsidian tag.
 *
 * Obsidian tags only allow alphanumerics, hyphens, underscores, and slashes.
 * Spaces become underscores; everything else is stripped.
 */
export function obsidianTag(name: string): string {
  return name.replace(/ /g, "_").replace(/[^a-zA-Z0-9_\-/]/g, "");
}

/** Unicode NFKD de-diacritics — strip combining marks. */
export function stripDiacritics(text: string | null | undefined): string {
  if (text === null || text === undefined) {
    return "";
  }
  const nfkd = text.normalize("NFKD");
  return Array.from(nfkd).filter((c) => {
    const cp = c.codePointAt(0)!;
    // Filter out combining diacritical marks (U+0300–U+036F) and similar
    return cp < 0x0300 || cp > 0x036F;
  }).join("");
}

/** Escape a value for safe embedding in a YAML double-quoted scalar (F-009).
 *
 * Handles backslash, double-quote, all line breaks, tab, NUL, and other
 * C0/DEL control characters.
 */
export function yamlStr(s: string | null | undefined): string {
  if (s === null || s === undefined) return "";
  const out: string[] = [];
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") {
      out.push("\\\\");
    } else if (ch === '"') {
      out.push('\\"');
    } else if (ch === "\n") {
      out.push("\\n");
    } else if (ch === "\r") {
      out.push("\\r");
    } else if (ch === "\t") {
      out.push("\\t");
    } else if (ch === "\0") {
      out.push("\\0");
    } else if (cp === 0x2028) {
      out.push("\\L");
    } else if (cp === 0x2029) {
      out.push("\\P");
    } else if (cp < 0x20 || cp === 0x7f) {
      out.push(`\\x${cp.toString(16).padStart(2, "0")}`);
    } else {
      out.push(ch);
    }
  }
  return out.join("");
}

/** Cap a filename stem to `limit` UTF-8 bytes so it stays under the 255-byte
 * filesystem limit even after the `.md` extension and dedup suffix are added.
 * The cap is on BYTES, not chars. When truncation happens, an 8-char hash of
 * the full label is appended so two distinct labels sharing a long prefix
 * produce distinct, deterministic filenames instead of colliding. */
export function capFilename(s: string, limit: number = 200): string {
  const b = Buffer.from(s, "utf-8");
  if (b.length <= limit) return s;
  const digest = createHash("sha1").update(s, "utf-8").digest("hex").slice(0, 8);
  const keep = limit - 9; // "_" + 8 hex chars
  const truncated = b.slice(0, keep).toString("utf-8"); // drops split trailing char
  return `${truncated}_${digest}`;
}

/** Clean a label for use as a safe Obsidian filename (no extension). */
export function safeName(label: string): string {
  let cleaned = label
    .replace(/\r\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/[\\/*?:"<>|#^[\]]/g, "")
    .trim();
  // Strip trailing .md/.mdx/.markdown so "CLAUDE.md" doesn't become "CLAUDE.md.md"
  cleaned = cleaned.replace(/\.(md|mdx|qmd|markdown)$/i, "");
  return cleaned ? capFilename(cleaned) : "unnamed";
}

/** Simple implementation of sanitize_label: strip control chars + cap length (200 chars). */
export function sanitizeLabel(s: string): string {
  // Strip control characters except tab and newline
  let cleaned = Array.from(s).filter((ch) => {
    const cp = ch.codePointAt(0)!;
    return cp >= 0x20 || ch === "\t" || ch === "\n";
  }).join("");
  if (cleaned.length > 200) {
    cleaned = cleaned.slice(0, 200);
  }
  return cleaned;
}

/** Export graph as an Obsidian vault - one .md file per node with [[wikilinks]],
 * plus one _COMMUNITY_name.md overview note per community.
 *
 * Returns the number of node notes + community notes written.
 */
export function toObsidian(
  graph: Graph,
  communities: Record<number, string[]>,
  outputDir: string,
  options?: {
    communityLabels?: Record<number, string>;
    cohesion?: Record<number, number>;
  }
): number {
  const { communityLabels, cohesion } = options ?? {};
  const out = outputDir;
  fs.mkdirSync(out, { recursive: true });

  const nodeCommunity = nodeCommunityMap(communities);

  // Map node_id → safe filename so wikilinks stay consistent.
  // Deduplicate: if two nodes produce the same filename, append a numeric suffix.
  const nodeFilename: Record<string, string> = {};
  const seenNames: Record<string, number> = {};
  graph.forEachNode((nodeId: string, attrs: Record<string, unknown>) => {
    const base = safeName((attrs["label"] as string) ?? nodeId);
    if (base in seenNames) {
      seenNames[base] += 1;
      nodeFilename[nodeId] = `${base}_${seenNames[base]}`;
    } else {
      seenNames[base] = 0;
      nodeFilename[nodeId] = base;
    }
  });

  // Helper: compute dominant confidence for a node across all its edges
  function dominantConfidence(nodeId: string): string {
    const confs: string[] = [];
    graph.forEachEdge(nodeId, (_edge: string, attrs: Record<string, unknown>) => {
      confs.push((attrs["confidence"] as string) ?? "EXTRACTED");
    });
    if (!confs.length) return "EXTRACTED";
    // Simple Counter via Map
    const counts = new Map<string, number>();
    for (const c of confs) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let best = "EXTRACTED";
    let bestCount = 0;
    for (const [c, n] of counts) {
      if (n > bestCount) { best = c; bestCount = n; }
    }
    return best;
  }

  // Map file_type → graphify tag
  const FTYPE_TAG: Record<string, string> = {
    code: "graphify/code",
    document: "graphify/document",
    paper: "graphify/paper",
    image: "graphify/image",
  };

  // Write one .md file per node
  for (const nodeId of graph.nodes()) {
    const data = graph.getNodeAttributes(nodeId);
    const label = (data["label"] as string) ?? nodeId;
    const cid = nodeCommunity[nodeId];
    const communityName = communityLabels && cid !== undefined
      ? (communityLabels[cid] ?? `Community ${cid}`)
      : `Community ${cid}`;

    // Build tags for this node
    const ftype = (data["file_type"] as string) ?? "";
    const ftypeTag = FTYPE_TAG[ftype] ?? (ftype ? `graphify/${ftype}` : "graphify/document");
    const domConf = dominantConfidence(nodeId);
    const confTag = `graphify/${domConf}`;
    const commTag = `community/${obsidianTag(communityName)}`;
    const nodeTags = [ftypeTag, confTag, commTag];

    const lines: string[] = [];

    // YAML frontmatter
    lines.push("---");
    lines.push(`source_file: "${yamlStr((data["source_file"] as string) ?? "")}"`);
    lines.push(`type: "${yamlStr(ftype)}"`);
    lines.push(`community: "${yamlStr(communityName)}"`);
    if (data["source_location"]) {
      lines.push(`location: "${yamlStr(String(data["source_location"]))}"`);
    }
    lines.push("tags:");
    for (const tag of nodeTags) {
      lines.push(`  - ${tag}`);
    }
    lines.push("---");
    lines.push("");
    lines.push(`# ${label}`);
    lines.push("");

    // Outgoing edges as wikilinks
    const neighborIds = neighbors(graph, nodeId);
    if (neighborIds.length) {
      lines.push("## Connections");
      const sorted = [...neighborIds].sort((a, b) => {
        const la = (graph.getNodeAttributes(a)["label"] as string) ?? a;
        const lb = (graph.getNodeAttributes(b)["label"] as string) ?? b;
        return la.localeCompare(lb);
      });
      for (const neighbor of sorted) {
        const edgeAttrs = graph.getEdgeAttributes(nodeId, neighbor);
        const neighborLabel = nodeFilename[neighbor];
        const relation = (edgeAttrs["relation"] as string) ?? "";
        const confidence = (edgeAttrs["confidence"] as string) ?? "EXTRACTED";
        lines.push(`- [[${neighborLabel}]] - \`${relation}\` [${confidence}]`);
      }
      lines.push("");
    }

    // Inline tags at bottom of note body
    const inlineTags = nodeTags.map((t) => `#${t}`).join(" ");
    lines.push(inlineTags);

    const fname = nodeFilename[nodeId] + ".md";
    fs.writeFileSync(path.join(out, fname), lines.join("\n"), "utf-8");
  }

  // Write one _COMMUNITY_name.md overview note per community
  // Build inter-community edge counts
  const interCommunityEdges: Record<number, Record<number, number>> = {};
  for (const cid of Object.keys(communities).map(Number)) {
    interCommunityEdges[cid] = {};
  }
  graph.forEachEdge((_edge: string, _attrs: Record<string, unknown>, u: string, v: string) => {
    const cu = nodeCommunity[u];
    const cv = nodeCommunity[v];
    if (cu !== undefined && cv !== undefined && cu !== cv) {
      if (!interCommunityEdges[cu]) interCommunityEdges[cu] = {};
      if (!interCommunityEdges[cv]) interCommunityEdges[cv] = {};
      interCommunityEdges[cu][cv] = (interCommunityEdges[cu][cv] ?? 0) + 1;
      interCommunityEdges[cv][cu] = (interCommunityEdges[cv][cu] ?? 0) + 1;
    }
  });

  // Precompute per-node community reach
  function communityReach(nodeId: string): number {
    const neighborCids = new Set<number>();
    for (const nb of neighbors(graph, nodeId)) {
      const nbCid = nodeCommunity[nb];
      if (nbCid !== undefined && nbCid !== nodeCommunity[nodeId]) {
        neighborCids.add(nbCid);
      }
    }
    return neighborCids.size;
  }

  let communityNotesWritten = 0;
  for (const [cidStr, allMembers] of Object.entries(communities)) {
    const cid = Number(cidStr);
    const communityName = communityLabels
      ? (communityLabels[cid] ?? `Community ${cid}`)
      : `Community ${cid}`;

    // Skip dangling members (ids with no backing node in graph)
    const members = allMembers.filter((m) => graph.hasNode(m) && m in nodeFilename);
    const nMembers = members.length;
    const cohValue = cohesion?.[cid] ?? null;

    const lines: string[] = [];

    // YAML frontmatter
    lines.push("---");
    lines.push("type: community");
    if (cohValue !== null) {
      lines.push(`cohesion: ${cohValue.toFixed(2)}`);
    }
    lines.push(`members: ${nMembers}`);
    lines.push("---");
    lines.push("");
    lines.push(`# ${communityName}`);
    lines.push("");

    // Cohesion + member count summary
    if (cohValue !== null) {
      const cohesionDesc =
        cohValue >= 0.7 ? "tightly connected"
        : cohValue >= 0.4 ? "moderately connected"
        : "loosely connected";
      lines.push(`**Cohesion:** ${cohValue.toFixed(2)} - ${cohesionDesc}`);
    }
    lines.push(`**Members:** ${nMembers} nodes`);
    lines.push("");

    // Members section
    lines.push("## Members");
    const sortedMembers = [...members].sort((a, b) => {
      const la = (graph.getNodeAttributes(a)["label"] as string) ?? a;
      const lb = (graph.getNodeAttributes(b)["label"] as string) ?? b;
      return la.localeCompare(lb);
    });
    for (const nodeId of sortedMembers) {
      const data = graph.getNodeAttributes(nodeId);
      const nodeLabel = nodeFilename[nodeId];
      const ftype = (data["file_type"] as string) ?? "";
      const source = (data["source_file"] as string) ?? "";
      let entry = `- [[${nodeLabel}]]`;
      if (ftype) entry += ` - ${ftype}`;
      if (source) entry += ` - ${source}`;
      lines.push(entry);
    }
    lines.push("");

    // Dataview live query
    const commTagName = obsidianTag(communityName);
    lines.push("## Live Query (requires Dataview plugin)");
    lines.push("");
    lines.push("```dataview");
    lines.push(`TABLE source_file, type FROM #community/${commTagName}`);
    lines.push("SORT file.name ASC");
    lines.push("```");
    lines.push("");

    // Connections to other communities
    const cross = interCommunityEdges[cid] ?? {};
    if (Object.keys(cross).length) {
      lines.push("## Connections to other communities");
      const sorted = Object.entries(cross).sort(([, a], [, b]) => b - a);
      for (const [otherCidStr, edgeCount] of sorted) {
        const otherCid = Number(otherCidStr);
        const otherName = communityLabels
          ? (communityLabels[otherCid] ?? `Community ${otherCid}`)
          : `Community ${otherCid}`;
        const otherSafe = safeName(otherName);
        lines.push(`- ${edgeCount} edge${edgeCount !== 1 ? "s" : ""} to [[_COMMUNITY_${otherSafe}]]`);
      }
      lines.push("");
    }

    // Top bridge nodes
    const bridgeNodes: [string, number, number][] = [];
    for (const nodeId of members) {
      const reach = communityReach(nodeId);
      if (reach > 0) {
        bridgeNodes.push([nodeId, degree(graph, nodeId), reach]);
      }
    }
    bridgeNodes.sort((a, b) => b[2] - a[2] || b[1] - a[1]);
    const topBridges = bridgeNodes.slice(0, 5);
    if (topBridges.length) {
      lines.push("## Top bridge nodes");
      for (const [nodeId, deg, reach] of topBridges) {
        const nodeLabel = nodeFilename[nodeId];
        lines.push(
          `- [[${nodeLabel}]] - degree ${deg}, connects to ${reach} ` +
          `${reach === 1 ? "community" : "communities"}`
        );
      }
    }

    const communitySafe = safeName(communityName);
    const fname = `_COMMUNITY_${communitySafe}.md`;
    fs.writeFileSync(path.join(out, fname), lines.join("\n"), "utf-8");
    communityNotesWritten++;
  }

  // Write .obsidian/graph.json for community colors in graph view
  const obsidianDir = path.join(out, ".obsidian");
  fs.mkdirSync(obsidianDir, { recursive: true });
  const COMMUNITY_COLORS = [
    "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F",
    "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC",
  ];
  const graphConfig = {
    colorGroups: Object.entries(communityLabels ?? {})
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([cidStr, label]) => ({
        query: `tag:#community/${(label as string).replace(/ /g, "_")}`,
        color: { a: 1, rgb: parseInt(COMMUNITY_COLORS[Number(cidStr) % COMMUNITY_COLORS.length].replace("#", ""), 16) },
      })),
  };
  fs.writeFileSync(path.join(obsidianDir, "graph.json"), JSON.stringify(graphConfig, null, 2), "utf-8");

  return graph.order + communityNotesWritten;
}
