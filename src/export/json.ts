import type Graph from "graphology";
import { createHash } from "crypto";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { nodeCommunityMap } from "../analyze.js";
import { stripDiacritics } from "./obsidian.js";

// Artifacts worth preserving across rebuilds (non-regenerable without LLM or curation).
const _BACKUP_ARTIFACTS = [
  "graph.json",
  "GRAPH_REPORT.md",
  ".graphify_labels.json",
  ".graphify_analysis.json",
  "manifest.json",
  ".graphify_semantic_marker",
  "cost.json",
];

const _CONFIDENCE_SCORE_DEFAULTS: Record<string, number> = {
  EXTRACTED: 1.0,
  INFERRED: 0.5,
  AMBIGUOUS: 0.2,
};

/** Snapshot graph artifacts to a dated subfolder before an overwrite.
 *
 * Triggers when graph.json exists AND either:
 * - .graphify_semantic_marker is present (graph cost real LLM tokens), or
 * - .graphify_labels.json contains at least one non-default community label
 *   (graph has been curated by a human or skill).
 *
 * Returns the backup folder path, or None if no backup was taken.
 * Never raises — backup failure prints a warning but never blocks the write.
 * Set GRAPHIFY_NO_BACKUP=1 to disable.
 */
export function backupIfProtected(outDir: string): string | null {
  if (process.env.GRAPHIFY_NO_BACKUP) return null;
  const out = outDir;
  if (!fs.existsSync(path.join(out, "graph.json"))) return null;

  const isSemantic = fs.existsSync(path.join(out, ".graphify_semantic_marker"));
  let isCurated = false;
  const labelsFile = path.join(out, ".graphify_labels.json");
  if (fs.existsSync(labelsFile)) {
    try {
      const labels = JSON.parse(fs.readFileSync(labelsFile, "utf-8"));
      isCurated = Object.entries(labels).some(
        ([k, v]) => v !== `Community ${k}`
      );
    } catch {
      // ignore
    }
  }

  if (!isSemantic && !isCurated) return null;

  const reason = [
    isSemantic ? "semantic" : "",
    isCurated ? "curated" : "",
  ].filter(Boolean).join("+");
  const today = new Date().toISOString().slice(0, 10);
  const backupDir = path.join(out, today);
  const graphSrc = path.join(out, "graph.json");

  // Skip re-copying if today's backup already has identical graph.json content.
  if (fs.existsSync(backupDir) && fs.existsSync(path.join(backupDir, "graph.json"))) {
    const srcHash = createHash("sha256").update(fs.readFileSync(graphSrc)).digest("hex");
    const bakHash = createHash("sha256").update(fs.readFileSync(path.join(backupDir, "graph.json"))).digest("hex");
    if (srcHash === bakHash) return backupDir;
  }

  try {
    fs.mkdirSync(backupDir, { recursive: true });
    let copied = 0;
    for (const name of _BACKUP_ARTIFACTS) {
      const src = path.join(out, name);
      if (fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, path.join(backupDir, name));
          copied++;
        } catch {
          // ignore per-file copy failure
        }
      }
    }
    if (copied) {
      console.log(`[graphify] backed up ${reason} graph (${copied} files) -> ${path.basename(backupDir)}/`);
    }
    return backupDir;
  } catch (exc: unknown) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    console.error(`[graphify] warning: backup failed (${msg}) - continuing with overwrite`);
    return null;
  }
}

/** Store hyperedges in the graph's metadata dict. */
export function attachHyperedges(graph: Graph, hyperedges: Record<string, unknown>[]): void {
  const existing: Record<string, unknown>[] = (graph.getAttribute("hyperedges") as Record<string, unknown>[]) ?? [];
  const seenIds = new Set(existing.map((h: Record<string, unknown>) => h["id"]));
  for (const h of hyperedges) {
    if (h["id"] && !seenIds.has(h["id"])) {
      existing.push(h);
      seenIds.add(h["id"] as string);
    }
  }
  graph.setAttribute("hyperedges", existing);
}

/** Return the current git HEAD commit hash, or null if not in a git repo. */
export function gitHead(): string | null {
  try {
    const result = execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/** Convert a graphology Graph to node-link JSON format (matching NetworkX node_link_data). */
function nodeLinkData(graph: Graph): Record<string, unknown> {
  const nodes: Record<string, unknown>[] = [];
  const links: Record<string, unknown>[] = [];

  graph.forEachNode((node: string, attrs: Record<string, unknown>) => {
    nodes.push({ id: node, ...attrs });
  });

  graph.forEachEdge(
    (_edge: string, attrs: Record<string, unknown>, source: string, target: string) => {
      links.push({ source, target, ...attrs });
    }
  );

  return {
    directed: graph.type === "directed",
    multigraph: graph.multi,
    graph: graph.getAttributes(),
    nodes,
    links,
  };
}

/** Export graph as graph.json.
 *
 * @returns true if write succeeded, false if refused (node shrink protection).
 */
export function toJson(
  graph: Graph,
  communities: Record<number, string[]>,
  outputPath: string,
  options?: {
    force?: boolean;
    builtAtCommit?: string;
    communityLabels?: Record<number, string>;
  }
): boolean {
  const { force = false, builtAtCommit, communityLabels } = options ?? {};

  // Safety check: refuse to silently shrink an existing graph (#479)
  if (!force && fs.existsSync(outputPath)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
      const existingN = (existingData.nodes ?? []).length;
      const newN = graph.order;
      if (newN < existingN) {
        console.error(
          `[graphify] WARNING: new graph has ${newN} nodes but existing ` +
          `graph.json has ${existingN} (net -${existingN - newN}). ` +
          `Refusing to overwrite. Possible causes: missing chunk files from ` +
          `a previous session, or fuzzy dedup collapsed same-named symbols ` +
          `across files during an --update on an already-current graph. ` +
          `Run a full rebuild (/graphify .) to be safe, or pass force=true ` +
          `only if you have verified the reduction is legitimate.`
        );
        return false;
      }
    } catch {
      // unreadable existing file — proceed with write
    }
  }

  const nodeCommunity = nodeCommunityMap(communities);
  const labels: Record<number, string> = {};
  if (communityLabels) {
    for (const [k, v] of Object.entries(communityLabels)) {
      labels[Number(k)] = v;
    }
  }

  const data = nodeLinkData(graph) as Record<string, unknown> & {
    nodes: Record<string, unknown>[];
    links: Record<string, unknown>[];
  };

  for (const node of data.nodes) {
    const cid = nodeCommunity[node["id"] as string];
    node["community"] = cid;
    if (cid !== undefined && Object.keys(labels).length > 0) {
      node["community_name"] = labels[cid] ?? `Community ${cid}`;
    }
    node["norm_label"] = stripDiacritics((node["label"] as string) ?? "").toLowerCase();
  }

  for (const link of data.links) {
    if (!("confidence_score" in link)) {
      const conf = (link["confidence"] as string) ?? "EXTRACTED";
      link["confidence_score"] = _CONFIDENCE_SCORE_DEFAULTS[conf] ?? 1.0;
    }
    // Restore original edge direction from _src/_tgt
    const trueSrc = link["_src"] as string | undefined;
    const trueTgt = link["_tgt"] as string | undefined;
    if (trueSrc !== undefined && trueTgt !== undefined) {
      link["source"] = trueSrc;
      link["target"] = trueTgt;
    }
    delete link["_src"];
    delete link["_tgt"];
  }

  data["hyperedges"] = (graph.getAttribute("hyperedges") as Record<string, unknown>[]) ?? [];

  const commit = builtAtCommit !== undefined ? builtAtCommit : gitHead();
  if (commit) {
    data["built_at_commit"] = commit;
  }

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");
  return true;
}

/** Remove edges whose source or target node is not in the node set.
 *
 * Returns the cleaned graph_data dict and the number of pruned edges.
 */
export function pruneDanglingEdges(graphData: Record<string, unknown>): { data: Record<string, unknown>; pruned: number } {
  const nodeIds = new Set(
    ((graphData["nodes"] as Record<string, unknown>[]) ?? []).map((n: Record<string, unknown>) => n["id"] as string)
  );
  const linksKey = "links" in graphData ? "links" : "edges";
  const before = ((graphData[linksKey] as Record<string, unknown>[]) ?? []).length;
  graphData[linksKey] = ((graphData[linksKey] as Record<string, unknown>[]) ?? []).filter(
    (e: Record<string, unknown>) => nodeIds.has(e["source"] as string) && nodeIds.has(e["target"] as string)
  );
  return { data: graphData, pruned: before - (graphData[linksKey] as Record<string, unknown>[]).length };
}
