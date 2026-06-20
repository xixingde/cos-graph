import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, copyFileSync, renameSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { readAlwaysOn } from "../always-on.js";
import { replaceOrAppendSection } from "../sections.js";
import { removeGraphifySection } from "../utils.js";
import { copySkillFile, removeSkillFile, installSkillReferences } from "../skill-files.js";
import { platformSkillDestination, packagedSkillRefsDir, graphifyPackageDir } from "../platform-config.js";
import { VERSION } from "../../index.js";

const VSCODE_INSTRUCTIONS_MARKER = "## graphify";

export function vscodeInstall(projectDir: string = "."): void {
  let skillSrc = join(graphifyPackageDir(), "graphify", "skill-vscode.md");
  let refsBundle = "vscode";
  if (!existsSync(skillSrc)) {
    skillSrc = join(graphifyPackageDir(), "graphify", "skill-copilot.md");
    refsBundle = "copilot";
  }
  const skillDst = join(homedir(), ".copilot", "skills", "graphify", "SKILL.md");
  mkdirSync(dirname(skillDst), { recursive: true });
  const tmpDst = skillDst + ".tmp";
  try {
    copyFileSync(skillSrc, tmpDst);
    renameSync(tmpDst, skillDst);
  } catch {
    try { unlinkSync(tmpDst); } catch {}
    throw new Error(`Failed to copy skill file to ${skillDst}`);
  }

  const refsSrc = join(graphifyPackageDir(), "graphify", "skills", refsBundle, "references");
  if (existsSync(refsSrc)) {
    installSkillReferences(skillDst, refsSrc);
    console.log(`  references       ->  ${join(dirname(skillDst), "references")}`);
  } else {
    const orphanRefs = join(dirname(skillDst), "references");
    if (existsSync(orphanRefs)) rmSync(orphanRefs, { recursive: true, force: true });
  }
  writeFileSync(join(dirname(skillDst), ".graphify_version"), VERSION, "utf-8");
  console.log(`  skill installed  ->  ${skillDst}`);

  const instructions = join(projectDir, ".github", "copilot-instructions.md");
  mkdirSync(dirname(instructions), { recursive: true });
  if (existsSync(instructions)) {
    const content = readFileSync(instructions, "utf-8");
    const newContent = replaceOrAppendSection(content, VSCODE_INSTRUCTIONS_MARKER, readAlwaysOn("vscode-instructions"));
    if (newContent === content) {
      console.log(`  ${instructions}  ->  already configured (no change)`);
    } else {
      writeFileSync(instructions, newContent, "utf-8");
      console.log(`  ${instructions}  ->  graphify section ${content.includes(VSCODE_INSTRUCTIONS_MARKER) ? "updated" : "added"}`);
    }
  } else {
    writeFileSync(instructions, readAlwaysOn("vscode-instructions"), "utf-8");
    console.log(`  ${instructions}  ->  created`);
  }

  console.log();
  console.log("VS Code Copilot Chat configured. Type /graphify in the chat panel to build the graph.");
  console.log("Note: for GitHub Copilot CLI (terminal), use: graphify copilot install");
}

export function vscodeUninstall(projectDir: string = "."): void {
  const skillDst = join(homedir(), ".copilot", "skills", "graphify", "SKILL.md");
  if (existsSync(skillDst)) {
    unlinkSync(skillDst);
    console.log(`  skill removed    ->  ${skillDst}`);
  }
  const versionFile = join(dirname(skillDst), ".graphify_version");
  if (existsSync(versionFile)) unlinkSync(versionFile);
  const refsDir = join(dirname(skillDst), "references");
  if (existsSync(refsDir)) rmSync(refsDir, { recursive: true, force: true });

  // Walk up empty dirs
  let dir: string | null = dirname(skillDst);
  for (let i = 0; i < 3 && dir; i++) {
    try { rmSync(dir, { recursive: false }); } catch { break; }
    dir = dirname(dir);
  }

  const instructions = join(projectDir, ".github", "copilot-instructions.md");
  if (!existsSync(instructions)) return;
  const content = readFileSync(instructions, "utf-8");
  if (!content.includes(VSCODE_INSTRUCTIONS_MARKER)) return;
  const cleaned = removeGraphifySection(content, VSCODE_INSTRUCTIONS_MARKER);
  if (cleaned) {
    writeFileSync(instructions, cleaned + "\n", "utf-8");
    console.log(`  graphify section removed from ${instructions}`);
  } else {
    unlinkSync(instructions);
    console.log(`  ${instructions}  ->  deleted (was empty after removal)`);
  }
}
