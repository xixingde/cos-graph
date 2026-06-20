import type { Command } from "commander";
import { loadGraph } from "../../serve/query-engine.js";
import { cluster, scoreAll } from "../../cluster.js";
import { toJson } from "../../export/index.js";
import * as fs from "fs";
import * as path from "path";

export function registerLabelCommand(program: Command): void {
  program
    .command("label")
    .description("Label (re-label) communities with LLM-generated names")
    .argument("[path]", "project directory (default: current directory)", ".")
    .option("--graph <path>", "path to graph.json", "graphify-out/graph.json")
    .option("--backend <backend>", "LLM backend for labeling", "openai")
    .option("--model <model>", "LLM model for labeling")
    .option("--resolution <n>", "Louvain resolution parameter", "1.0")
    .option("--exclude-hubs", "exclude hub nodes from community detection")
    .action((dirPath: string, opts: {
      graph?: string; backend?: string; model?: string;
      resolution?: string; excludeHubs?: boolean;
    }) => {
      const graphPath = opts.graph || "graphify-out/graph.json";
      if (!fs.existsSync(graphPath)) {
        console.error(`Graph file not found: ${graphPath}`);
        process.exit(1);
      }
      const graph = loadGraph(graphPath);
      const resolution = parseFloat(opts.resolution || "1.0");

      // Read previous community assignments if available
      const previousPath = path.join(path.dirname(graphPath), ".graphify_labels.json");
      let previousLabels: Record<number, string> = {};
      if (fs.existsSync(previousPath)) {
        try {
          previousLabels = JSON.parse(fs.readFileSync(previousPath, "utf-8"));
        } catch { /* ignore */ }
      }

      const communities = cluster(graph, { resolution });
      const cohesion = scoreAll(graph, communities);

      const communityGroups: Record<number, string[]> = {};
      for (const [nodeId, cid] of Object.entries(communities)) {
        if (!communityGroups[cid]) communityGroups[cid] = [];
        communityGroups[cid].push(nodeId);
      }

      // Labeling requires LLM -- stub: keep existing labels or assign numeric defaults
      const communityLabels: Record<number, string> = {};
      for (const cid of Object.keys(communityGroups).map(Number)) {
        communityLabels[cid] = previousLabels[cid] ?? `Community ${cid}`;
      }

      // Write labels
      fs.writeFileSync(previousPath, JSON.stringify(communityLabels, null, 2), "utf-8");

      // Re-write graph.json with updated labels
      toJson(graph, communityGroups, graphPath, {
        force: true,
        communityLabels,
      });

      const analysisPath = path.join(path.dirname(graphPath), ".graphify_analysis.json");
      fs.writeFileSync(analysisPath, JSON.stringify({ cohesion }, null, 2), "utf-8");

      console.log(
        `Labeled ${Object.keys(communityGroups).length} communities ` +
        `(force_relabel=true, resolution=${resolution})`
      );
      console.log("Note: Automatic LLM labeling is not yet migrated. Community labels preserved from previous run or assigned default names.");
    });
}
