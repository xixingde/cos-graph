import type { Command } from "commander";
import { runBenchmark, printBenchmark } from "../../benchmark.js";

export function registerBenchmarkCommand(program: Command): void {
  program
    .command("benchmark")
    .description("Run benchmarks against the graph")
    .argument("[graph]", "path to graph.json", "graphify-out/graph.json")
    .action((graphPath: string) => {
      const result = runBenchmark(graphPath);
      printBenchmark(result);
    });
}
