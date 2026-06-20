import type { Command } from "commander";
import { loadGraph, findNode } from "../../serve/query-engine.js";

export function registerExplainCommand(program: Command): void {
  program
    .command("explain")
    .description("Explain a node by showing its neighbors and edges")
    .argument("<label>", "node label to look up")
    .option("--graph <path>", "path to graph.json", "graphify-out/graph.json")
    .action((label: string, opts: { graph?: string }) => {
      const graph = loadGraph(opts.graph || "graphify-out/graph.json");
      const nodeIds = findNode(graph, label);
      if (nodeIds.length === 0) {
        console.error(`Node not found: ${label}`);
        process.exit(1);
      }
      for (const nodeId of nodeIds) {
        const attrs = graph.getNodeAttributes(nodeId);
        const nodeLabel = (attrs.label as string) ?? nodeId;
        console.log(`Node: ${nodeLabel} (${nodeId})`);
        console.log(`  file_type: ${attrs.file_type ?? "unknown"}`);
        console.log(`  source_file: ${attrs.source_file ?? ""}`);
        const neighborIds = graph.neighbors(nodeId);
        for (const nId of neighborIds) {
          const edges = graph.edge(nodeId, nId);
          const edgeList = Array.isArray(edges) ? edges : [edges];
          for (const eId of edgeList) {
            if (eId === undefined) continue;
            const eAttrs = graph.getEdgeAttributes(eId);
            const dir = graph.type === "directed" ? "->" : "--";
            const nLabel = (graph.getNodeAttributes(nId).label as string) ?? nId;
            console.log(`  ${nodeLabel} ${dir} ${nLabel}  [${eAttrs.relation ?? ""}]`);
          }
        }
      }
    });
}
