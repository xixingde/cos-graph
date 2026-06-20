import type { Command } from "commander";
import { loadGraph } from "../../serve/query-engine.js";
import { graphFromJSON, graphToJSON } from "../../graph/factory.js";
import * as fs from "fs";
import * as path from "path";

export function registerMergeGraphsCommand(program: Command): void {
  program
    .command("merge-graphs")
    .description("Merge multiple graph.json files into one")
    .argument("<graphs...>", "paths to graph.json files to merge")
    .option("--out <path>", "output path for merged graph", "graphify-out/graph.json")
    .action((graphPaths: string[], opts: { out?: string }) => {
      const allNodes: Record<string, unknown>[] = [];
      const allEdges: Record<string, unknown>[] = [];
      const seenNodes = new Map<string, Record<string, unknown>>();
      const seenEdges = new Set<string>();

      for (const gp of graphPaths) {
        if (!fs.existsSync(gp)) {
          console.error(`File not found: ${gp}`);
          continue;
        }
        const data = JSON.parse(fs.readFileSync(gp, "utf-8"));
        const nodes = (data.nodes ?? []) as Record<string, unknown>[];
        const edges = (data.links ?? data.edges ?? []) as Record<string, unknown>[];

        for (const n of nodes) {
          const id = n["id"] as string;
          if (!id || seenNodes.has(id)) continue;
          seenNodes.set(id, n);
          allNodes.push(n);
        }

        for (const e of edges) {
          const key = `${e.source}|${e.target}|${e.relation ?? ""}`;
          if (seenEdges.has(key)) continue;
          seenEdges.add(key);
          allEdges.push(e);
        }
      }

      const result = { nodes: allNodes, links: allEdges, directed: true };
      const outPath = opts.out || "graphify-out/graph.json";
      const outDir = path.dirname(outPath);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");
      console.log(`Merged ${graphPaths.length} graphs into ${outPath} (${allNodes.length} nodes, ${allEdges.length} edges)`);
    });
}
