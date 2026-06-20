import type { Command } from "commander";
import { loadGraph, communitiesFromGraph, queryGraphText } from "../../serve/query-engine.js";

export function registerQueryCommand(program: Command): void {
  program
    .command("query")
    .description("Query the knowledge graph")
    .argument("<question>", "natural language question")
    .option("--graph <path>", "path to graph.json", "graphify-out/graph.json")
    .option("--dfs", "use depth-first search instead of BFS")
    .option("--budget <n>", "token budget for the output", "2000")
    .option("--depth <n>", "traversal depth", "3")
    .option("--context <filters...>", "context filter paths")
    .action((question: string, opts: { graph?: string; dfs?: boolean; budget?: string; depth?: string; context?: string[] }) => {
      const graph = loadGraph(opts.graph || "graphify-out/graph.json");
      const communities = communitiesFromGraph(graph);
      const mode = opts.dfs ? "dfs" : "bfs";
      const depth = parseInt(opts.depth || "3", 10);
      const tokenBudget = parseInt(opts.budget || "2000", 10);
      const contextFilters = opts.context?.length ? opts.context : null;
      const result = queryGraphText(graph, communities, question, contextFilters, mode, depth, tokenBudget);
      console.log(result);
    });
}
