// MCP Server definition -- tool/resource registration, hot-reload.
// Ported from graphify/serve.py lines 513-1038.

import type Graph from "graphology";
import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import { performance } from "node:perf_hooks";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { sanitizeLabel } from "../security.js";
import { logQuery } from "../querylog.js";
import { shortestPath } from "../graph/paths.js";
import { godNodes, surprisingConnections, suggestQuestions } from "../analyze.js";
import type { CommunityMap } from "../types/graph.js";
import {
  fetchPrs, fetchPrFiles, computePrImpact, formatPrsText,
  fetchWorktrees, detectDefaultBranch,
} from "../prs.js";

import {
  loadGraph, communitiesFromGraph, queryGraphText,
  scoreNodes, pickSeeds, findNode, bfs, dfs,
  subgraphToText, stripDiacritics, isSearchable,
  computeIdf, queryTerms, edgeData,
  normalizeContextFilters, inferContextFilters,
  resolveContextFilters, filterGraphByContext,
  CONTEXT_HINTS, CONTEXT_FILTER_ALIASES,
} from "./query-engine.js";

// ── Build the MCP Server ───────────────────────────────────────────────────

export function buildServer(graphPath: string): McpServer {
  let G = loadGraph(graphPath);
  let communities = communitiesFromGraph(G);

  // Build node→cid map (CommunityMap) from cid→nodes for analyze functions
  function communityMapFromGroups(groups: Record<number, string[]>): CommunityMap {
    const cmap: CommunityMap = {};
    for (const [cidStr, nodes] of Object.entries(groups)) {
      const cid = Number(cidStr);
      for (const n of nodes) {
        cmap[n] = cid;
      }
    }
    return cmap;
  }

  // Hot-reload state: mtime+size lets us detect changes without polling
  let _reloadMtime = 0;
  let _reloadSize = 0;
  try {
    const stat = fs.statSync(graphPath);
    _reloadMtime = stat.mtimeMs;
    _reloadSize = stat.size;
  } catch {
    // File not found at startup -- keep defaults
  }

  function maybeReload(): void {
    try {
      const stat = fs.statSync(graphPath);
      if (stat.mtimeMs !== _reloadMtime || stat.size !== _reloadSize) {
        _reloadMtime = stat.mtimeMs;
        _reloadSize = stat.size;
        G = loadGraph(graphPath);
        communities = communitiesFromGraph(G);
      }
    } catch {
      // ignore transient errors
    }
  }

  // ── Community labels ─────────────────────────────────────────────────

  function loadCommunityLabels(): Record<number, string> {
    const labelsPath = path.join(path.dirname(graphPath), ".graphify_labels.json");
    try {
      if (fs.existsSync(labelsPath)) {
        const raw = JSON.parse(fs.readFileSync(labelsPath, "utf-8"));
        const result: Record<number, string> = {};
        for (const [k, v] of Object.entries(raw)) {
          result[Number(k)] = String(v);
        }
        return result;
      }
    } catch { /* ignore */ }
    const fallback: Record<number, string> = {};
    for (const cid of Object.keys(communities)) {
      fallback[Number(cid)] = `Community ${cid}`;
    }
    return fallback;
  }

  // ── Create McpServer ─────────────────────────────────────────────────

  const server = new McpServer({
    name: "graphify",
    version: "0.8.41",
  });

  // ── 10 Tools ─────────────────────────────────────────────────────────

  // 1. query_graph
  server.tool(
    "query_graph",
    "Search the knowledge graph using BFS or DFS. Returns relevant nodes and edges as text context.",
    {
      question: z.string().describe("Natural language question or keyword search"),
      mode: z.enum(["bfs", "dfs"]).default("bfs").describe("bfs=broad context, dfs=trace a specific path"),
      depth: z.number().default(3).describe("Traversal depth (1-6)"),
      token_budget: z.number().default(2000).describe("Max output tokens"),
      context_filter: z.optional(z.array(z.string())).describe("Optional explicit edge-context filter, e.g. ['call', 'field']"),
    },
    async ({ question, mode, depth, token_budget, context_filter }) => {
      maybeReload();
      const t0 = performance.now();
      const clampedDepth = Math.min(depth, 6);
      const result = queryGraphText(
        G, communities, question,
        context_filter ?? null, mode, clampedDepth, token_budget
      );
      logQuery({
        kind: "mcp_query",
        question,
        corpus: graphPath,
        result,
        mode,
        depth: clampedDepth,
        token_budget,
        duration_ms: (performance.now() - t0),
      });
      return { content: [{ type: "text", text: result }] };
    }
  );

  // 2. get_node
  server.tool(
    "get_node",
    "Get full details for a specific node by label or ID.",
    {
      label: z.string().describe("Node label or ID to look up"),
    },
    async ({ label }) => {
      maybeReload();
      const lbl = label.toLowerCase();
      const matches: [string, Record<string, any>][] = [];
      G.forEachNode((nid, d) => {
        if ((d.label || "").toLowerCase().includes(lbl) || nid.toLowerCase() === lbl) {
          matches.push([nid, d]);
        }
      });
      if (matches.length === 0) {
        return { content: [{ type: "text", text: `No node matching '${label}' found.` }] };
      }
      const [nid, d] = matches[0];
      const text = [
        `Node: ${sanitizeLabel(d.label || nid)}`,
        `  ID: ${sanitizeLabel(nid)}`,
        `  Source: ${sanitizeLabel(String(d.source_file || ""))} ${sanitizeLabel(String(d.source_location || ""))}`,
        `  Type: ${sanitizeLabel(String(d.file_type || ""))}`,
        `  Community: ${sanitizeLabel(String(d.community_name || d.community || ""))}`,
        `  Degree: ${G.degree(nid)}`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }
  );

  // 3. get_neighbors
  server.tool(
    "get_neighbors",
    "Get all direct neighbors of a node with edge details.",
    {
      label: z.string().describe("Node label to look up"),
      relation_filter: z.optional(z.string()).describe("Optional: filter by relation type"),
    },
    async ({ label, relation_filter }) => {
      maybeReload();
      const matches = findNode(G, label);
      if (matches.length === 0) {
        return { content: [{ type: "text", text: `No node matching '${label}' found.` }] };
      }
      const nid = matches[0];
      const nd = G.getNodeAttributes(nid);
      const lines: string[] = [`Neighbors of ${sanitizeLabel(nd.label || nid)}:`];
      const relFilter = (relation_filter || "").toLowerCase();

      // Successors (outgoing)
      for (const nb of G.outNeighbors(nid)) {
        const ed = edgeData(G, nid, nb);
        const rel = String(ed.relation || "");
        if (relFilter && !rel.toLowerCase().includes(relFilter)) continue;
        lines.push(
          `  --> ${sanitizeLabel(G.getNodeAttributes(nb).label || nb)} ` +
          `[${sanitizeLabel(rel)}] [${sanitizeLabel(String(ed.confidence || ""))}]`
        );
      }
      // Predecessors (incoming)
      for (const nb of G.inNeighbors(nid)) {
        const ed = edgeData(G, nb, nid);
        const rel = String(ed.relation || "");
        if (relFilter && !rel.toLowerCase().includes(relFilter)) continue;
        lines.push(
          `  <-- ${sanitizeLabel(G.getNodeAttributes(nb).label || nb)} ` +
          `[${sanitizeLabel(rel)}] [${sanitizeLabel(String(ed.confidence || ""))}]`
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // 4. get_community
  server.tool(
    "get_community",
    "Get all nodes in a community by community ID.",
    {
      community_id: z.number().describe("Community ID (0-indexed by size)"),
    },
    async ({ community_id }) => {
      maybeReload();
      const nodes = communities[community_id] || [];
      if (nodes.length === 0) {
        return { content: [{ type: "text", text: `Community ${community_id} not found.` }] };
      }
      const lines = [`Community ${community_id} (${nodes.length} nodes):`];
      for (const n of nodes) {
        const d = G.getNodeAttributes(n);
        lines.push(
          `  ${sanitizeLabel(d.label || n)} ` +
          `[${sanitizeLabel(String(d.source_file || ""))}]`
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // 5. god_nodes
  server.tool(
    "god_nodes",
    "Return the most connected nodes -- the core abstractions of the knowledge graph.",
    {
      top_n: z.number().default(10).describe("Number of top nodes to return"),
    },
    async ({ top_n }) => {
      maybeReload();
      const nodes = godNodes(G, top_n);
      const lines = ["God nodes (most connected):"];
      nodes.forEach((n: any, i: number) => {
        lines.push(`  ${i + 1}. ${sanitizeLabel(n.label)} - ${n.degree} edges`);
      });
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // 6. graph_stats
  server.tool(
    "graph_stats",
    "Return summary statistics: node count, edge count, communities, confidence breakdown.",
    {},
    async () => {
      maybeReload();
      const confs: string[] = [];
      G.forEachEdge((_key, attrs) => {
        confs.push(String(attrs.confidence || "EXTRACTED"));
      });
      const total = confs.length || 1;
      const extracted = confs.filter(c => c === "EXTRACTED").length;
      const inferred = confs.filter(c => c === "INFERRED").length;
      const ambiguous = confs.filter(c => c === "AMBIGUOUS").length;
      const text = [
        `Nodes: ${G.order}`,
        `Edges: ${G.size}`,
        `Communities: ${Object.keys(communities).length}`,
        `EXTRACTED: ${Math.round(extracted / total * 100)}%`,
        `INFERRED: ${Math.round(inferred / total * 100)}%`,
        `AMBIGUOUS: ${Math.round(ambiguous / total * 100)}%`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }
  );

  // 7. shortest_path
  server.tool(
    "shortest_path",
    "Find the shortest path between two concepts in the knowledge graph.",
    {
      source: z.string().describe("Source concept label or keyword"),
      target: z.string().describe("Target concept label or keyword"),
      max_hops: z.number().default(8).describe("Maximum hops to consider"),
    },
    async ({ source, target, max_hops }) => {
      maybeReload();
      const srcScored = scoreNodes(G, source.split(/\s+/).map(t => t.toLowerCase()));
      const tgtScored = scoreNodes(G, target.split(/\s+/).map(t => t.toLowerCase()));
      if (srcScored.length === 0) {
        return { content: [{ type: "text", text: `No node matching source '${source}' found.` }] };
      }
      if (tgtScored.length === 0) {
        return { content: [{ type: "text", text: `No node matching target '${target}' found.` }] };
      }
      const srcNid = srcScored[0][1];
      const tgtNid = tgtScored[0][1];

      // Ambiguity guard: both resolve to the same node
      if (srcNid === tgtNid) {
        return {
          content: [{
            type: "text",
            text: `'${source}' and '${target}' both resolved to the same node '${srcNid}'. Use a more specific label or the exact node ID.`,
          }],
        };
      }

      const warnings: string[] = [];
      for (const [name, scored] of [["source", srcScored], ["target", tgtScored]] as const) {
        if (scored.length >= 2) {
          const top = scored[0][0];
          const runner = scored[1][0];
          if (top > 0 && (top - runner) / top < 0.10) {
            warnings.push(`warning: ${name} match was ambiguous (top score ${top}, runner-up ${runner})`);
          }
        }
      }

      // Use undirected path-finding
      const pathNodes = shortestPath(G, srcNid, tgtNid);
      if (!pathNodes) {
        const srcLabel = G.getNodeAttributes(srcNid).label || srcNid;
        const tgtLabel = G.getNodeAttributes(tgtNid).label || tgtNid;
        return {
          content: [{
            type: "text",
            text: `No path found between '${sanitizeLabel(srcLabel)}' and '${sanitizeLabel(tgtLabel)}'.`,
          }],
        };
      }

      const hops = pathNodes.length - 1;
      if (hops > max_hops) {
        return { content: [{ type: "text", text: `Path exceeds max_hops=${max_hops} (${hops} hops found).` }] };
      }

      const segments: string[] = [];
      for (let i = 0; i < pathNodes.length - 1; i++) {
        const u = pathNodes[i];
        const v = pathNodes[i + 1];
        let ed: Record<string, any>;
        let forward: boolean;
        if (G.hasEdge(u, v)) {
          ed = edgeData(G, u, v);
          forward = true;
        } else {
          ed = edgeData(G, v, u);
          forward = false;
        }
        const rel = String(ed.relation || "");
        const conf = String(ed.confidence || "");
        const confStr = conf ? ` [${conf}]` : "";
        if (i === 0) {
          segments.push(sanitizeLabel(G.getNodeAttributes(u).label || u));
        }
        if (forward) {
          segments.push(`--${sanitizeLabel(rel)}${confStr}--> ${sanitizeLabel(G.getNodeAttributes(v).label || v)}`);
        } else {
          segments.push(`<--${sanitizeLabel(rel)}${confStr}-- ${sanitizeLabel(G.getNodeAttributes(v).label || v)}`);
        }
      }
      const prefix = warnings.length > 0 ? warnings.join("\n") + "\n" : "";
      return {
        content: [{ type: "text", text: `${prefix}Shortest path (${hops} hops):\n  ${segments.join(" ")}` }],
      };
    }
  );

  // 8. list_prs
  server.tool(
    "list_prs",
    "List open GitHub PRs with CI status, review state, and graph impact.",
    {
      repo: z.optional(z.string()).describe("GitHub repo (owner/repo). Defaults to current repo."),
      base: z.optional(z.string()).describe("Base branch to filter PRs by (auto-detected if omitted)"),
    },
    async ({ repo, base }) => {
      maybeReload();
      const effectiveBase = base || detectDefaultBranch(repo);
      try {
        const prs = fetchPrs(repo || undefined, effectiveBase);
        const worktrees = fetchWorktrees();
        for (const pr of prs) {
          (pr as any).worktreePath = (worktrees as any)[(pr as any).branch];
        }
        return { content: [{ type: "text", text: formatPrsText(prs, effectiveBase) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message || e}` }] };
      }
    }
  );

  // 9. get_pr_impact
  server.tool(
    "get_pr_impact",
    "Get detailed graph impact for a specific PR: which files it changes, which communities are affected.",
    {
      pr_number: z.number().describe("PR number to analyse"),
      repo: z.optional(z.string()).describe("GitHub repo (owner/repo). Defaults to current repo."),
    },
    async ({ pr_number, repo }) => {
      maybeReload();
      try {
        const files = fetchPrFiles(pr_number, repo || undefined);
        if (!files || files.length === 0) {
          return { content: [{ type: "text", text: `PR #${pr_number}: no changed files found (may require gh auth).` }] };
        }
        const impact = computePrImpact(files, G);
        const lines = [
          `PR #${pr_number}`,
          `\nGraph impact: ${impact.nodes} nodes across ${impact.communities.length} communities`,
          `Communities touched: ${impact.communities.join(", ")}`,
          `Files changed (${files.length}):`,
        ];
        for (const f of files.slice(0, 20)) {
          lines.push(`  ${f}`);
        }
        if (files.length > 20) {
          lines.push(`  ... and ${files.length - 20} more`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message || e}` }] };
      }
    }
  );

  // 10. triage_prs
  server.tool(
    "triage_prs",
    "Return all actionable open PRs with full graph impact data so you can reason about review priority and merge order.",
    {
      repo: z.optional(z.string()).describe("GitHub repo (owner/repo). Defaults to current repo."),
      base: z.optional(z.string()).describe("Base branch to filter PRs by (auto-detected if omitted)"),
    },
    async ({ repo, base }) => {
      maybeReload();
      const effectiveBase = base || detectDefaultBranch(repo);
      try {
        const prs = fetchPrs(repo || undefined, effectiveBase);
        const worktrees = fetchWorktrees();
        for (const pr of prs) {
          (pr as any).worktreePath = (worktrees as any)[(pr as any).branch];
        }

        // Filter actionable PRs
        const actionable = prs.filter((p: any) =>
          p.baseBranch === effectiveBase &&
          p.status !== "WRONG-BASE" &&
          p.status !== "STALE"
        );

        if (actionable.length === 0) {
          return { content: [{ type: "text", text: `No actionable PRs targeting ${effectiveBase}.` }] };
        }

        // Fetch files for each PR and compute impact
        for (const pr of actionable) {
          try {
            const files = fetchPrFiles((pr as any).number, repo || undefined);
            if (files && files.length > 0) {
              (pr as any).filesChanged = files;
              const impact = computePrImpact(files, G);
              (pr as any).communitiesTouched = impact.communities;
              (pr as any).nodesAffected = impact.nodes;
            }
          } catch {
            // skip PRs whose files cannot be fetched
          }
        }

        const header = `Actionable PRs targeting ${effectiveBase}: ${actionable.length}\n` +
          "Rank these by review priority. Higher blast_radius = more graph communities affected = higher merge risk.\n";
        const lines = [header];
        for (const p of actionable) {
          const impact = (p as any).blastRadius ? `  blast_radius=${(p as any).blastRadius}` : "";
          const wt = (p as any).worktreePath ? `  worktree=${(p as any).worktreePath}` : "";
          lines.push(
            `PR #${(p as any).number} [${(p as any).status}] CI=${(p as any).ciStatus} review=${(p as any).reviewDecision || "none"} ` +
            `age=${(p as any).daysOld}d author=${(p as any).author}${impact}${wt}\n  title: ${(p as any).title}`
          );
        }
        return { content: [{ type: "text", text: lines.join("\n\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message || e}` }] };
      }
    }
  );

  // ── 6 Resources ───────────────────────────────────────────────────────

  server.resource(
    "report",
    "graphify://report",
    async (uri) => {
      maybeReload();
      const reportPath = path.join(path.dirname(graphPath), "GRAPH_REPORT.md");
      try {
        if (fs.existsSync(reportPath)) {
          return { contents: [{ uri: uri.href, text: fs.readFileSync(reportPath, "utf-8") }] };
        }
      } catch { /* ignore */ }
      return { contents: [{ uri: uri.href, text: "GRAPH_REPORT.md not found. Run graphify extract first." }] };
    }
  );

  server.resource(
    "stats",
    "graphify://stats",
    async (uri) => {
      maybeReload();
      const confs: string[] = [];
      G.forEachEdge((_key, attrs) => {
        confs.push(String(attrs.confidence || "EXTRACTED"));
      });
      const total = confs.length || 1;
      const extracted = confs.filter(c => c === "EXTRACTED").length;
      const inferred = confs.filter(c => c === "INFERRED").length;
      const ambiguous = confs.filter(c => c === "AMBIGUOUS").length;
      const text = [
        `Nodes: ${G.order}`,
        `Edges: ${G.size}`,
        `Communities: ${Object.keys(communities).length}`,
        `EXTRACTED: ${Math.round(extracted / total * 100)}%`,
        `INFERRED: ${Math.round(inferred / total * 100)}%`,
        `AMBIGUOUS: ${Math.round(ambiguous / total * 100)}%`,
      ].join("\n");
      return { contents: [{ uri: uri.href, text }] };
    }
  );

  server.resource(
    "god-nodes",
    "graphify://god-nodes",
    async (uri) => {
      maybeReload();
      const nodes = godNodes(G, 10);
      const lines = ["God nodes (most connected):"];
      nodes.forEach((n: any, i: number) => {
        lines.push(`  ${i + 1}. ${sanitizeLabel(n.label)} - ${n.degree} edges`);
      });
      return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
    }
  );

  server.resource(
    "surprises",
    "graphify://surprises",
    async (uri) => {
      maybeReload();
      try {
        const surprises = surprisingConnections(G, communityMapFromGroups(communities), 10);
        if (!surprises || surprises.length === 0) {
          return { contents: [{ uri: uri.href, text: "No surprising connections found." }] };
        }
        const lines = ["Surprising cross-community connections:"];
        for (const s of surprises) {
          lines.push(`  ${sanitizeLabel(String(s.source || ""))} <-> ${sanitizeLabel(String(s.target || ""))} [${sanitizeLabel(String(s.relation || ""))}]`);
        }
        return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
      } catch (exc: any) {
        return { contents: [{ uri: uri.href, text: `Could not compute surprising connections: ${exc.message || exc}` }] };
      }
    }
  );

  server.resource(
    "audit",
    "graphify://audit",
    async (uri) => {
      maybeReload();
      const confs: string[] = [];
      G.forEachEdge((_key, attrs) => {
        confs.push(String(attrs.confidence || "EXTRACTED"));
      });
      const total = confs.length || 1;
      const extracted = confs.filter(c => c === "EXTRACTED").length;
      const inferred = confs.filter(c => c === "INFERRED").length;
      const ambiguous = confs.filter(c => c === "AMBIGUOUS").length;
      const text = [
        `Total edges: ${total}`,
        `EXTRACTED: ${extracted} (${Math.round(extracted / total * 100)}%)`,
        `INFERRED: ${inferred} (${Math.round(inferred / total * 100)}%)`,
        `AMBIGUOUS: ${ambiguous} (${Math.round(ambiguous / total * 100)}%)`,
      ].join("\n");
      return { contents: [{ uri: uri.href, text }] };
    }
  );

  server.resource(
    "questions",
    "graphify://questions",
    async (uri) => {
      maybeReload();
      try {
        const communityLabels = loadCommunityLabels();
        const questions = suggestQuestions(G, communityMapFromGroups(communities), communityLabels, 10);
        if (!questions || questions.length === 0) {
          return { contents: [{ uri: uri.href, text: "No suggested questions available." }] };
        }
        const lines = ["Suggested questions:"];
        for (const q of questions) {
          if (typeof q === "object" && q !== null && "question" in q) {
            lines.push(`  - ${(q as any).question}`);
          } else {
            lines.push(`  - ${q}`);
          }
        }
        return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
      } catch (exc: any) {
        return { contents: [{ uri: uri.href, text: `Could not generate questions: ${exc.message || exc}` }] };
      }
    }
  );

  return server;
}
