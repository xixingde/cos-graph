import type { Command } from "commander";
import { loadGraph } from "../../serve/query-engine.js";
import { formatAffected, resolveSeed, affectedNodes } from "../../affected.js";

export function registerAffectedCommand(program: Command): void {
  program
    .command("affected")
    .description("Find nodes affected by a change (reverse dependency trace)")
    .argument("<query>", "node label or ID to trace from")
    .option("--graph <path>", "path to graph.json", "graphify-out/graph.json")
    .option("--depth <n>", "traversal depth", "2")
    .option("--relation <relations...>", "edge relation types to follow")
    .action((query: string, opts: { graph?: string; depth?: string; relation?: string[] }) => {
      const graph = loadGraph(opts.graph || "graphify-out/graph.json");
      const depth = parseInt(opts.depth || "2", 10);
      const relations = opts.relation?.length ? opts.relation : undefined;
      const result = formatAffected(graph, query, { relations, depth });
      console.log(result);
    });
}
