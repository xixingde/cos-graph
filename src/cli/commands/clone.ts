import type { Command } from "commander";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

export function registerCloneCommand(program: Command): void {
  program
    .command("clone")
    .description("Clone a git repository and extract its graph")
    .argument("<url>", "git repository URL")
    .option("--branch <branch>", "branch to checkout")
    .option("--out <dir>", "output directory (default: repo name from URL)")
    .action((url: string, opts: { branch?: string; out?: string }) => {
      const repoName = opts.out || url.replace(/\.git$/, "").split("/").pop() || "repo";
      const outDir = path.resolve(repoName);
      const branchArgs = opts.branch ? ` --branch ${opts.branch}` : "";
      const cmd = `git clone${branchArgs} ${url} ${outDir}`;
      console.log(`Running: ${cmd}`);
      try {
        execSync(cmd, { stdio: "inherit" });
      } catch (exc: any) {
        console.error(`git clone failed: ${exc.message}`);
        process.exit(1);
      }
      if (!fs.existsSync(outDir)) {
        console.error(`Clone directory not found: ${outDir}`);
        process.exit(1);
      }
      console.log(`Cloned to ${outDir}`);
      console.log("Run 'graphify extract' on the cloned directory to build the graph.");
    });
}
