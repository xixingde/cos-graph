import type { Command } from "commander";
import { loadGraph } from "../../serve/query-engine.js";
import { shortestPath } from "../../graph/paths.js";

export function registerPathCommand(program: Command): void {
  program
    .command("path")
    .description("Find shortest path between two nodes in the graph")
    .argument("<source>", "source node label or ID")
    .argument("<target>", "target node label or ID")
    .option("--graph <path>", "path to graph.json", "graphify-out/graph.json")
    .action((source: string, target: string, opts: { graph?: string }) => {
      const graph = loadGraph(opts.graph || "graphify-out/graph.json");
      const result = shortestPath(graph, source, target);
      if (result === null) {
        console.log("No path found.");
      } else {
        console.log(result.join(" -> "));
      }
    });
}
