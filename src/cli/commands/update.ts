import type { Command } from "commander";
import { rebuildCode } from "../../watch.js";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update the graph incrementally by re-extracting changed files")
    .argument("[path]", "directory to update (default: current directory)")
    .option("--force", "force full rebuild even if no changes detected")
    .option("--no-cluster", "skip community clustering step")
    .action(async (path?: string, opts?: { force?: boolean; cluster?: boolean }) => {
      await rebuildCode(path || ".", {
        force: opts?.force ?? false,
        noCluster: opts?.cluster === false,
      });
    });
}
