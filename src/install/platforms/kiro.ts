import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { readAlwaysOn } from "../always-on.js";
import { platformSkillDestination } from "../platform-config.js";
import { copySkillFile, removeSkillFile } from "../skill-files.js";

export function kiroInstall(projectDir: string = "."): void {
  // Skill file + references/ sidecar + .graphify_version stamp
  copySkillFile("kiro", { project: true, projectDir });

  // Steering file -> .kiro/steering/graphify.md (always-on)
  const steeringDir = join(projectDir, ".kiro", "steering");
  mkdirSync(steeringDir, { recursive: true });
  const steeringDst = join(steeringDir, "graphify.md");
  const steeringContent = readAlwaysOn("kiro-steering");
  if (existsSync(steeringDst) && readFileSync(steeringDst, "utf-8") === steeringContent) {
    console.log("  .kiro/steering/graphify.md  ->  already configured (no change)");
  } else {
    const action = existsSync(steeringDst) ? "updated" : "written";
    writeFileSync(steeringDst, steeringContent, "utf-8");
    console.log(`  .kiro/steering/graphify.md  ->  always-on steering ${action}`);
  }

  console.log();
  console.log("Kiro will now read the knowledge graph before every conversation.");
  console.log("Use /graphify to build or update the graph.");
}

export function kiroUninstall(projectDir: string = "."): void {
  const removed: string[] = [];

  const skillDst = platformSkillDestination("kiro", { project: true, projectDir });
  if (removeSkillFile("kiro", { project: true, projectDir })) {
    removed.push(relative(projectDir, skillDst));
  }

  const steeringDst = join(projectDir, ".kiro", "steering", "graphify.md");
  if (existsSync(steeringDst)) {
    unlinkSync(steeringDst);
    removed.push(relative(projectDir, steeringDst));
  }

  console.log("Removed: " + (removed.length > 0 ? removed.join(", ") : "nothing to remove"));
}
