import type { Command } from "commander";
import { globalAdd, globalRemove, globalList, globalPath } from "../../globalGraph.js";

export function registerGlobalCommand(program: Command): void {
  program
    .command("global")
    .description("Manage global graph")
    .argument("<action>", "add, remove, list, or path")
    .argument("[source]", "graph.json path (for add) or repo tag (for remove)")
    .option("--as <tag>", "repo tag for global add")
    .action((action: string, source?: string, opts?: { as?: string }) => {
      if (action === "add") {
        if (!source) {
          console.error("Usage: graphify global add <graph.json> [--as <repo-tag>]");
          process.exit(1);
        }
        const tag = opts?.as || "";
        try {
          const result = globalAdd(source, tag);
          if (result.skipped) {
            console.log(`'${tag}' unchanged since last add - global graph not modified.`);
          } else {
            console.log(`Added '${tag}' to global graph: +${result.nodes_added} nodes, -${result.nodes_removed} pruned. Global: ${globalPath()}`);
          }
        } catch (exc: any) {
          console.error(`error: ${exc.message}`);
          process.exit(1);
        }
      } else if (action === "remove") {
        if (!source) {
          console.error("Usage: graphify global remove <repo-tag>");
          process.exit(1);
        }
        try {
          const removed = globalRemove(source);
          console.log(`Removed '${source}' from global graph (${removed} nodes pruned).`);
        } catch (exc: any) {
          console.error(`error: ${exc.message}`);
          process.exit(1);
        }
      } else if (action === "list") {
        const repos = globalList();
        if (Object.keys(repos).length === 0) {
          console.log("Global graph is empty. Use 'graphify global add' to add a project.");
        } else {
          console.log(`Global graph: ${globalPath()}`);
          for (const [tag, info] of Object.entries(repos)) {
            const anyInfo = info as Record<string, any>;
            console.log(`  ${tag}: ${anyInfo.node_count || "?"} nodes, added ${(anyInfo.added_at || "?").slice(0, 10)}`);
          }
        }
      } else if (action === "path") {
        console.log(globalPath());
      } else {
        console.error("Usage: graphify global [add|remove|list|path]");
        process.exit(1);
      }
    });
}
