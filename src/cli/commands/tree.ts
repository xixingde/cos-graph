import type { Command } from "commander";
import { writeTreeHtml, DEFAULT_MAX_CHILDREN } from "../../treeHtml.js";

export function registerTreeCommand(program: Command): void {
  program
    .command("tree")
    .description("Generate a D3 tree HTML view of the graph")
    .option("--graph <path>", "path to graph.json", "graphify-out/graph.json")
    .option("--output <path>", "output HTML path", "graphify-out/tree.html")
    .option("--root <label>", "root node label filter")
    .option("--max-children <n>", "max children per node", String(DEFAULT_MAX_CHILDREN))
    .option("--top-k-edges <n>", "top K edges to show per community", "20")
    .option("--label <label>", "project label for the HTML title")
    .action((opts: { graph?: string; output?: string; root?: string; maxChildren?: string; topKEdges?: string; label?: string }) => {
      const graphPath = opts.graph || "graphify-out/graph.json";
      const outputPath = opts.output || "graphify-out/tree.html";
      const maxChildren = parseInt(opts.maxChildren || String(DEFAULT_MAX_CHILDREN), 10);
      const out = writeTreeHtml(graphPath, outputPath, {
        root: opts.root,
        maxChildren,
        projectLabel: opts.label,
      });
      console.log(`Tree HTML written to ${out}`);
    });
}
