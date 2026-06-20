import type { Command } from "commander";
import { install, projectInstall, printInstallUsage } from "../../install/index.js";

export function registerInstallCommand(program: Command): void {
  program
    .command("install")
    .description("Install graphify skill files for an AI coding platform")
    .argument("[platform]", "platform to install for (default: claude, or windows on Windows)")
    .option("--project", "install into the current project directory instead of home")
    .option("-p, --platform <platform>", "platform to install for (alternative syntax)")
    .action((positionalPlatform: string | undefined, opts: { project?: boolean; platform?: string }) => {
      const selectedPlatform = opts.platform || positionalPlatform;
      if (opts.project) {
        projectInstall(selectedPlatform || getDefaultPlatform(), ".");
      } else {
        install(selectedPlatform || getDefaultPlatform());
      }
    })
    .on("--help", () => {
      printInstallUsage();
    });
}

function getDefaultPlatform(): string {
  return process.platform === "win32" ? "windows" : "claude";
}
