import type { Command } from "commander";
import { checkUpdate } from "../../watch.js";

export function registerCheckUpdateCommand(program: Command): void {
  program
    .command("check-update")
    .description("Check if the graph needs updating")
    .argument("<path>", "directory to check")
    .action((path: string) => {
      const changed = checkUpdate(path);
      process.exit(changed ? 1 : 0);
    });
}
