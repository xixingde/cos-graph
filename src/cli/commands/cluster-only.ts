import type { Command } from "commander";
import { loadGraph } from "../../serve/query-engine.js";
import { cluster, scoreAll } from "../../cluster.js";
import { toJson } from "../../export/index.js";
import * as fs from "fs";
import * as path from "path";

export function registerClusterOnlyCommand(program: Command): void {
  program
    .command("cluster-only")
    .description("Re-cluster an existing graph without re-extracting")
    .argument("[path]", "project directory (default: current directory)", ".")
    .option("--graph <path>", "path to graph.json", "graphify-out/graph.json")
    .option("--no-viz", "skip HTML visualization export")
    .option("--no-label", "skip community labeling")
    .option("--backend <backend>", "LLM backend for labeling", "openai")
    .option("--model <model>", "LLM model for labeling")
    .option("--resolution <n>", "Louvain resolution parameter", "1.0")
    .option("--exclude-hubs", "exclude hub nodes from community detection")
    .option("--min-community-size <n>", "minimum community size to keep", "3")
    .action((dirPath: string, opts: {
      graph?: string; viz?: boolean; label?: boolean;
      backend?: string; model?: string; resolution?: string;
      excludeHubs?: boolean; minCommunitySize?: string;
    }) => {
      const graphPath = opts.graph || "graphify-out/graph.json";
      if (!fs.existsSync(graphPath)) {
        console.error(`Graph file not found: ${graphPath}`);
        process.exit(1);
      }
      const graph = loadGraph(graphPath);
      const resolution = parseFloat(opts.resolution || "1.0");
      const communities = cluster(graph, { resolution });
      const cohesion = scoreAll(graph, communities);

      // Read existing labels if available
      const labelsPath = path.join(path.dirname(graphPath), ".graphify_labels.json");
      let communityLabels: Record<number, string> = {};
      if (fs.existsSync(labelsPath)) {
        try {
          communityLabels = JSON.parse(fs.readFileSync(labelsPath, "utf-8"));
        } catch { /* ignore */ }
      }

      // Convert community map to groups format for toJson
      const communityGroups: Record<number, string[]> = {};
      for (const [nodeId, cid] of Object.entries(communities)) {
        if (!communityGroups[cid]) communityGroups[cid] = [];
        communityGroups[cid].push(nodeId);
      }

      const outDir = path.dirname(graphPath);
      toJson(graph, communityGroups, graphPath, {
        force: true,
        communityLabels,
      });

      // Write cohesion scores
      const analysisPath = path.join(outDir, ".graphify_analysis.json");
      fs.writeFileSync(analysisPath, JSON.stringify({ cohesion }, null, 2), "utf-8");

      console.log(
        `Re-clustered: ${graph.order} nodes into ${Object.keys(communityGroups).length} communities ` +
        `(resolution=${resolution})`
      );
    });
}
