import type { Command } from "commander";
import { uninstallAll, projectUninstall, projectUninstallAll } from "../../install/index.js";

export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description("Remove graphify skill files from AI coding platforms")
    .argument("[platform]", "platform to uninstall from (omit to uninstall all)")
    .option("--project", "uninstall from the current project directory")
    .option("--purge", "also delete graphify-out/ directory")
    .option("-p, --platform <platform>", "platform to uninstall from (alternative syntax)")
    .action((positionalPlatform: string | undefined, opts: { project?: boolean; purge?: boolean; platform?: string }) => {
      const selectedPlatform = opts.platform || positionalPlatform;
      if (opts.project) {
        if (selectedPlatform) {
          projectUninstall(selectedPlatform, ".");
        } else {
          projectUninstallAll(".");
        }
      } else {
        uninstallAll(".", opts.purge ?? false);
      }
    });
}
