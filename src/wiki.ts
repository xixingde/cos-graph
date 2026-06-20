// Wiki export -- Wikipedia-style markdown articles from the knowledge graph
// Generates an agent-crawlable wiki: index.md + one article per community + god node articles
// Ported from graphify/wiki.py (283 lines)

import * as fs from "fs";
import * as path from "path";
import Graph from "graphology";

import { degree, neighbors, getNodeAttributes } from "./graph/operations.js";
import { edgeData } from "./build.js";

// ── safe filename ──────────────────────────────────────────────────────────────

export function safeFilename(name: string): string {
  let s = name.replace(/\//g, "-").replace(/ /g, "_").replace(/:/g, "-");
  s = s.replace(/[<>:"/\\|?*]/g, "_");
  s = s.replace(/^[. ]+|[. ]+$/g, "");
  return s.length > 200 ? s.slice(0, 200) : (s || "unnamed");
}

// ── cross-community links ──────────────────────────────────────────────────────

export function crossCommunityLinks(
  G: Graph,
  nodes: string[],
  ownCid: number,
  labels: Record<number, string>,
  nodeCommunity: Record<string, number>,
): [string, number][] {
  const counts = new Map<string, number>();
  for (const nid of nodes) {
    for (const neighbor of neighbors(G, nid)) {
      const ncid = nodeCommunity[neighbor];
      if (ncid !== undefined && ncid !== ownCid) {
        const lbl = labels[ncid] ?? `Community ${ncid}`;
        counts.set(lbl, (counts.get(lbl) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// ── community article ──────────────────────────────────────────────────────────

export function communityArticle(
  G: Graph,
  cid: number,
  nodes: string[],
  label: string,
  labels: Record<number, string>,
  cohesion: number | null,
  nodeCommunity: Record<string, number> = {},
): string {
  const topNodes = [...nodes]
    .sort((a, b) => degree(G, b) - degree(G, a))
    .slice(0, 25);
  const cross = crossCommunityLinks(G, nodes, cid, labels, nodeCommunity);

  // Edge confidence breakdown
  const confCounts = new Map<string, number>();
  for (const nid of nodes) {
    for (const neighbor of neighbors(G, nid)) {
      const ed = edgeData(G, nid, neighbor);
      const conf = (ed.confidence as string) ?? "EXTRACTED";
      confCounts.set(conf, (confCounts.get(conf) ?? 0) + 1);
    }
  }
  let totalEdges = 0;
  for (const v of confCounts.values()) totalEdges += v;
  if (totalEdges === 0) totalEdges = 1;

  const sourceSet = new Set<string>();
  for (const n of nodes) {
    const d = getNodeAttributes(G, n);
    const src = (d.source_file as string) ?? "";
    if (src) sourceSet.add(src);
  }
  const sources = [...sourceSet].sort();

  const lines: string[] = [];
  lines.push(`# ${label}`, "");

  const metaParts = [`${nodes.length} nodes`];
  if (cohesion !== null) metaParts.push(`cohesion ${cohesion.toFixed(2)}`);
  lines.push(`> ${metaParts.join(" · ")}`, "");

  lines.push("## Key Concepts", "");
  for (const nid of topNodes) {
    const d = getNodeAttributes(G, nid);
    const nodeLabel = (d.label as string) ?? nid;
    const src = (d.source_file as string) ?? "";
    const deg = degree(G, nid);
    const srcStr = src ? ` -- \`${src}\`` : "";
    lines.push(`- **${nodeLabel}** (${deg} connections)${srcStr}`);
  }
  const remaining = nodes.length - topNodes.length;
  if (remaining > 0) {
    lines.push(`- *... and ${remaining} more nodes in this community*`);
  }
  lines.push("");

  lines.push("## Relationships", "");
  if (cross.length > 0) {
    for (const [otherLabel, count] of cross.slice(0, 12)) {
      lines.push(`- [[${otherLabel}]] (${count} shared connections)`);
    }
  } else {
    lines.push("- No strong cross-community connections detected");
  }
  lines.push("");

  if (sources.length > 0) {
    lines.push("## Source Files", "");
    for (const src of sources.slice(0, 20)) {
      lines.push(`- \`${src}\``);
    }
    lines.push("");
  }

  lines.push("## Audit Trail", "");
  for (const conf of ["EXTRACTED", "INFERRED", "AMBIGUOUS"] as const) {
    const n = confCounts.get(conf) ?? 0;
    const pct = Math.round((n / totalEdges) * 100);
    lines.push(`- ${conf}: ${n} (${pct}%)`);
  }
  lines.push("");

  lines.push("---", "", "*Part of the graphify knowledge wiki. See [[index]] to navigate.*");
  return lines.join("\n");
}

// ── god node article ────────────────────────────────────────────────────────────

export function godNodeArticle(
  G: Graph,
  nid: string,
  labels: Record<number, string>,
  nodeCommunity: Record<string, number> = {},
): string {
  const d = getNodeAttributes(G, nid);
  const nodeLabel = (d.label as string) ?? nid;
  const src = (d.source_file as string) ?? "";
  const cid = nodeCommunity[nid];
  const communityName = cid !== undefined ? (labels[cid] ?? `Community ${cid}`) : null;

  const lines: string[] = [];
  lines.push(`# ${nodeLabel}`, "");
  lines.push(`> God node · ${degree(G, nid)} connections · \`${src}\``, "");

  if (communityName) {
    lines.push(`**Community:** [[${communityName}]]`, "");
  }

  // Group neighbors by relation type
  const byRelation: Record<string, string[]> = {};
  const sortedNeighbors = [...neighbors(G, nid)].sort(
    (a, b) => degree(G, b) - degree(G, a),
  );
  for (const neighbor of sortedNeighbors) {
    const nd = getNodeAttributes(G, neighbor);
    const ed = edgeData(G, nid, neighbor);
    const rel = (ed.relation as string) ?? "related";
    const neighborLabel = (nd.label as string) ?? neighbor;
    const conf = (ed.confidence as string) ?? "";
    const confStr = conf ? ` \`${conf}\`` : "";
    if (!byRelation[rel]) byRelation[rel] = [];
    byRelation[rel].push(`[[${neighborLabel}]]${confStr}`);
  }

  lines.push("## Connections by Relation", "");
  for (const rel of Object.keys(byRelation).sort()) {
    lines.push(`### ${rel}`);
    for (const t of byRelation[rel].slice(0, 20)) {
      lines.push(`- ${t}`);
    }
    lines.push("");
  }

  lines.push("---", "", "*Part of the graphify knowledge wiki. See [[index]] to navigate.*");
  return lines.join("\n");
}

// ── index.md ────────────────────────────────────────────────────────────────────

export function indexMd(
  communities: Record<number, string[]>,
  labels: Record<number, string>,
  godNodesData: Array<Record<string, unknown>>,
  totalNodes: number,
  totalEdges: number,
): string {
  const lines: string[] = [
    "# Knowledge Graph Index",
    "",
    "> Auto-generated by graphify. Start here -- read community articles for context, then drill into god nodes for detail.",
    "",
    `**${totalNodes} nodes · ${totalEdges} edges · ${Object.keys(communities).length} communities**`,
    "",
    "---",
    "",
    "## Communities",
    "(sorted by size, largest first)",
    "",
  ];

  const sortedCommunities = Object.entries(communities)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [cidStr, nodes] of sortedCommunities) {
    const cid = Number(cidStr);
    const label = labels[cid] ?? `Community ${cid}`;
    lines.push(`- [[${label}]] -- ${nodes.length} nodes`);
  }
  lines.push("");

  if (godNodesData.length > 0) {
    lines.push("## God Nodes", "(most connected concepts -- the load-bearing abstractions)", "");
    for (const node of godNodesData) {
      lines.push(`- [[${node["label"]}]] -- ${node["degree"]} connections`);
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "*Generated by [graphify](https://github.com/safishamsi/graphify)*",
  );
  return lines.join("\n");
}

// ── toWiki (main entry) ───────────────────────────────────────────────────────

export function toWiki(
  G: Graph,
  communities: Record<number, string[]>,
  outputDir: string,
  communityLabels?: Record<number, string>,
  cohesion?: Record<number, number>,
  godNodesData?: Array<Record<string, unknown>>,
): number {
  fs.mkdirSync(outputDir, { recursive: true });

  if (!communities || Object.keys(communities).length === 0) {
    throw new Error(
      "communities dict is empty -- refusing to clear wiki/. " +
      "Run `graphify extract .` or `graphify cluster-only .` first.",
    );
  }

  // Filter stale node IDs
  const gNodeSet = new Set(G.nodes());
  let origTotal = 0;
  for (const nodes of Object.values(communities)) origTotal += nodes.length;
  const filteredCommunities: Record<number, string[]> = {};
  for (const [cid, nodes] of Object.entries(communities)) {
    const kept = nodes.filter((n) => gNodeSet.has(n));
    if (kept.length > 0) filteredCommunities[Number(cid)] = kept;
  }
  let keptTotal = 0;
  for (const nodes of Object.values(filteredCommunities)) keptTotal += nodes.length;
  if (keptTotal < origTotal) {
    console.error(
      `wiki: dropped ${origTotal - keptTotal} stale node ID(s) not in graph ` +
      `(${Object.keys(filteredCommunities).length} communities remaining)`,
    );
  }

  if (Object.keys(filteredCommunities).length === 0) {
    throw new Error(
      "all community node IDs are stale -- none exist in the graph. " +
      "Re-run `graphify extract .` to regenerate .graphify_analysis.json.",
    );
  }

  // Clear stale .md files
  const existingFiles = fs.readdirSync(outputDir).filter((f) => f.endsWith(".md"));
  for (const f of existingFiles) {
    fs.unlinkSync(path.join(outputDir, f));
  }

  const labels = communityLabels ?? {};
  // Fill missing labels
  for (const cid of Object.keys(filteredCommunities)) {
    const nCid = Number(cid);
    if (!labels[nCid]) labels[nCid] = `Community ${nCid}`;
  }
  const cohesionMap = cohesion ?? {};
  const godData = godNodesData ?? [];

  // Build node->community lookup
  const nodeCommunity: Record<string, number> = {};
  for (const [cid, nodes] of Object.entries(filteredCommunities)) {
    for (const n of nodes) {
      nodeCommunity[n] = Number(cid);
    }
  }

  let count = 0;
  const usedSlugs = new Set<string>();

  function uniqueSlug(base: string): string {
    let slug = base;
    let n = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}_${n}`;
      n++;
    }
    usedSlugs.add(slug);
    return slug;
  }

  // Community articles
  for (const [cid, nodes] of Object.entries(filteredCommunities)) {
    const nCid = Number(cid);
    const label = labels[nCid] ?? `Community ${nCid}`;
    const article = communityArticle(G, nCid, nodes, label, labels, cohesionMap[nCid] ?? null, nodeCommunity);
    const slug = uniqueSlug(safeFilename(label));
    fs.writeFileSync(path.join(outputDir, `${slug}.md`), article, "utf-8");
    count++;
  }

  // God node articles
  for (const nodeData of godData) {
    const nid = nodeData["id"] as string | undefined;
    if (nid && G.hasNode(nid)) {
      const article = godNodeArticle(G, nid, labels, nodeCommunity);
      const slug = uniqueSlug(safeFilename(nodeData["label"] as string));
      fs.writeFileSync(path.join(outputDir, `${slug}.md`), article, "utf-8");
      count++;
    }
  }

  // Index
  const indexContent = indexMd(
    filteredCommunities,
    labels,
    godData,
    G.order,
    G.size,
  );
  fs.writeFileSync(path.join(outputDir, "index.md"), indexContent, "utf-8");

  return count;
}
