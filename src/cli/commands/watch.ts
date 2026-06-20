import type { Command } from "commander";
import { watchPath } from "../../watch.js";

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch directory for changes and auto-rebuild graph")
    .argument("[path]", "directory to watch (default: current directory)")
    .action(async (path?: string) => {
      await watchPath(path || ".");
    });
}
