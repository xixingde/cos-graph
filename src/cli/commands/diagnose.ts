import type { Command } from "commander";
import { diagnoseFile, formatDiagnosticReport, formatDiagnosticJson } from "../../diagnostics.js";

export function registerDiagnoseCommand(program: Command): void {
  program
    .command("diagnose")
    .description("Run diagnostics on graph files")
    .argument("<action>", "diagnostic action (multigraph)")
    .argument("[graph]", "path to graph.json", "graphify-out/graph.json")
    .option("--json", "output as JSON")
    .option("--max-examples <n>", "max examples to show", "5")
    .option("--directed", "treat graph as directed")
    .option("--undirected", "treat graph as undirected")
    .option("--extract-path <path>", "path to extraction data")
    .action((action: string, graphPath: string, opts: { json?: boolean; maxExamples?: string; directed?: boolean; undirected?: boolean; extractPath?: string }) => {
      if (action !== "multigraph") {
        console.error(
          "Usage: graphify diagnose multigraph " +
          "[--graph path] [--json] [--max-examples N] " +
          "[--directed] [--undirected] [--extract-path path]"
        );
        process.exit(1);
      }
      const maxExamples = parseInt(opts.maxExamples || "5", 10);
      let directed: boolean | undefined;
      if (opts.directed) directed = true;
      else if (opts.undirected) directed = false;

      const summary = diagnoseFile(graphPath, {
        directed,
        max_examples: maxExamples,
        extractPath: opts.extractPath,
      });
      if (opts.json) {
        console.log(JSON.stringify(formatDiagnosticJson(summary), null, 2));
      } else {
        console.log(formatDiagnosticReport(summary));
      }
    });
}
