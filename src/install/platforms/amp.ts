import { existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { copySkillFile, removeSkillFile } from "../skill-files.js";

function ampLegacyCleanup(): void {
  const legacy = join(homedir(), ".amp", "skills", "graphify");
  if (existsSync(legacy)) {
    try {
      rmSync(legacy, { recursive: true, force: true });
      if (!existsSync(legacy)) {
        console.log(`  legacy removed   ->  ${legacy}`);
      }
    } catch {}
  }
}

export function ampInstall(projectDir: string, agentsInstallFn: (pd: string, platform: string) => void): void {
  ampLegacyCleanup();
  copySkillFile("amp");
  agentsInstallFn(projectDir || ".", "amp");
}

export function ampUninstall(projectDir: string, agentsUninstallFn: (pd: string, platform: string) => void): void {
  const removed = removeSkillFile("amp");
  if (removed) {
    console.log("skill removed");
  }
  agentsUninstallFn(projectDir || ".", "amp");
}
