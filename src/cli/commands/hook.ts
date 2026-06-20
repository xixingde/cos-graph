import type { Command } from "commander";
import { installHook, uninstallHook, hookStatus } from "../../hooks.js";

export function registerHookCommand(program: Command): void {
  program
    .command("hook")
    .description("Manage git hooks")
    .argument("<action>", "install, uninstall, or status")
    .action((action: string) => {
      if (action === "install") {
        console.log(installHook("."));
      } else if (action === "uninstall") {
        console.log(uninstallHook("."));
      } else if (action === "status") {
        console.log(hookStatus("."));
      } else {
        console.error("Usage: graphify hook [install|uninstall|status]");
        process.exit(1);
      }
    });
}
