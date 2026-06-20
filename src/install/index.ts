import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync, cpSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { platform } from "node:process";
import { execSync } from "node:child_process";

import { PLATFORM_CONFIG, platformSkillDestination, graphifyPackageDir } from "./platform-config.js";
import { copySkillFile, removeSkillFile, projectScopeRoot } from "./skill-files.js";
import { readAlwaysOn } from "./always-on.js";
import { replaceOrAppendSection } from "./sections.js";
import { skillRegistration, printBanner, refreshAllVersionStamps, removeGraphifySection } from "./utils.js";

import { claudeInstall, claudeUninstall, removeClaudeSkillRegistration, installClaudeHook, uninstallClaudeHook } from "./platforms/claude.js";
import { geminiInstall, geminiUninstall } from "./platforms/gemini.js";
import { cursorInstall, cursorUninstall } from "./platforms/cursor.js";
import { vscodeInstall, vscodeUninstall } from "./platforms/vscode.js";
import { kiroInstall, kiroUninstall } from "./platforms/kiro.js";
import { antigravityInstall, antigravityUninstall, antigravityFinalize } from "./platforms/antigravity.js";
import { devinRulesInstall, devinRulesUninstall } from "./platforms/devin.js";
import { installKiloPlugin, uninstallKiloPlugin, kiloUninstallGlobal, kiloInstall, kiloUninstall } from "./platforms/kilo.js";
import { installOpencodePlugin, uninstallOpencodePlugin } from "./platforms/opencode.js";
import { ampInstall, ampUninstall } from "./platforms/amp.js";
import { uninstallHook } from "../hooks.js";

const AGENTS_MD_MARKER = "## graphify";
const CODEBUDDY_MD_MARKER = "## graphify";

// ─── agentsInstall / agentsUninstall ─────────────────────────────────

export function agentsInstall(projectDir: string, platformName: string): void {
  const pd = projectDir || ".";
  const target = join(pd, "AGENTS.md");
  const alwaysOn = readAlwaysOn("agents-md");

  let newContent: string;
  if (existsSync(target)) {
    const content = readFileSync(target, "utf-8");
    newContent = replaceOrAppendSection(content, AGENTS_MD_MARKER, alwaysOn);
  } else {
    newContent = alwaysOn;
  }

  if (existsSync(target) && newContent === readFileSync(target, "utf-8")) {
    console.log(`graphify already configured in ${resolve(target)} (no change)`);
  } else {
    writeFileSync(target, newContent, "utf-8");
    console.log(`graphify section written to ${resolve(target)}`);
  }

  if (platformName === "codex") {
    installCodexHook(pd);
  } else if (platformName === "opencode") {
    installOpencodePlugin(pd);
  } else if (platformName === "kilo") {
    installKiloPlugin(pd);
  }

  console.log();
  console.log(`${platformName.charAt(0).toUpperCase() + platformName.slice(1)} will now check the knowledge graph before answering`);
  console.log("codebase questions and rebuild it after code changes.");
  if (!["codex", "opencode", "kilo"].includes(platformName)) {
    console.log();
    console.log("Note: unlike Claude Code, there is no PreToolUse hook equivalent for");
    console.log(`${platformName.charAt(0).toUpperCase() + platformName.slice(1)} — the AGENTS.md rules are the always-on mechanism.`);
  }
}

export function agentsUninstall(projectDir: string, platformName: string = ""): void {
  const pd = projectDir || ".";
  const target = join(pd, "AGENTS.md");

  if (!existsSync(target)) {
    console.log("No AGENTS.md found in current directory - nothing to do");
    if (platformName === "opencode") uninstallOpencodePlugin(pd);
    else if (platformName === "kilo") uninstallKiloPlugin(pd);
    return;
  }

  const content = readFileSync(target, "utf-8");
  if (!content.includes(AGENTS_MD_MARKER)) {
    console.log("graphify section not found in AGENTS.md - nothing to do");
    if (platformName === "opencode") uninstallOpencodePlugin(pd);
    else if (platformName === "kilo") uninstallKiloPlugin(pd);
    return;
  }

  const cleaned = removeGraphifySection(content, AGENTS_MD_MARKER);
  if (cleaned) {
    writeFileSync(target, cleaned + "\n", "utf-8");
    console.log(`graphify section removed from ${resolve(target)}`);
  } else {
    unlinkSync(target);
    console.log(`AGENTS.md was empty after removal - deleted ${resolve(target)}`);
  }

  if (platformName === "opencode") uninstallOpencodePlugin(pd);
  else if (platformName === "kilo") uninstallKiloPlugin(pd);
}

// ─── Codex hook ───────────────────────────────────────────────────────

function resolveGraphifyExe(): string {
  try {
    const cmd = platform === "win32" ? "where graphify 2>NUL" : "which graphify 2>/dev/null";
    const found = execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0].trim();
    if (found) return found;
  } catch {}
  const scriptsDir = dirname(process.execPath);
  for (const name of ["graphify.exe", "graphify", "graphify.cmd"]) {
    const candidate = join(scriptsDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return "graphify";
}

function installCodexHook(projectDir: string): void {
  const hooksPath = join(projectDir, ".codex", "hooks.json");
  mkdirSync(dirname(hooksPath), { recursive: true });

  let existing: Record<string, any> = {};
  if (existsSync(hooksPath)) {
    try { existing = JSON.parse(readFileSync(hooksPath, "utf-8")); } catch { existing = {}; }
  }

  const graphifyExe = resolveGraphifyExe();
  const hookEntry = {
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [{ type: "command", command: `${graphifyExe} hook-check` }],
      }],
    },
  };

  const hooks = existing.hooks ?? (existing.hooks = {});
  const preTool = hooks.PreToolUse ?? (hooks.PreToolUse = []);
  existing.hooks.PreToolUse = preTool.filter(
    (h: any) => !JSON.stringify(h).includes("graphify")
  );
  existing.hooks.PreToolUse.push(...hookEntry.hooks.PreToolUse);
  writeFileSync(hooksPath, JSON.stringify(existing, null, 2), "utf-8");
  console.log(`  .codex/hooks.json  ->  PreToolUse hook registered (${graphifyExe} hook-check)`);
}

function uninstallCodexHook(projectDir: string): void {
  const hooksPath = join(projectDir, ".codex", "hooks.json");
  if (!existsSync(hooksPath)) return;
  let existing: Record<string, any>;
  try { existing = JSON.parse(readFileSync(hooksPath, "utf-8")); } catch { return; }
  const preTool: any[] = existing?.hooks?.PreToolUse ?? [];
  const filtered = preTool.filter((h: any) => !JSON.stringify(h).includes("graphify"));
  existing.hooks.PreToolUse = filtered;
  writeFileSync(hooksPath, JSON.stringify(existing, null, 2), "utf-8");
  console.log("  .codex/hooks.json  ->  PreToolUse hook removed");
}

// ─── CodeBuddy ────────────────────────────────────────────────────────

const CODEBUDDY_HOOK = {
  matcher: "Bash",
  hooks: [{ type: "command", command: "graphify hook-check" }],
};

function installCodebuddyHook(projectDir: string): void {
  const settingsPath = join(projectDir, ".codebuddy", "settings.json");
  mkdirSync(dirname(settingsPath), { recursive: true });

  let settings: Record<string, any> = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch { settings = {}; }
  }

  const hooks = settings.hooks ?? (settings.hooks = {});
  const preTool = hooks.PreToolUse ?? (hooks.PreToolUse = []);
  hooks.PreToolUse = preTool.filter(
    (h: any) => !(["Bash"].includes(h.matcher) && JSON.stringify(h).includes("graphify"))
  );
  hooks.PreToolUse.push(CODEBUDDY_HOOK);
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  console.log("  .codebuddy/settings.json  ->  PreToolUse hook registered");
}

function uninstallCodebuddyHook(projectDir: string): void {
  const settingsPath = join(projectDir, ".codebuddy", "settings.json");
  if (!existsSync(settingsPath)) return;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const preTool: any[] = settings?.hooks?.PreToolUse ?? [];
    const filtered = preTool.filter(
      (h: any) => !(["Bash"].includes(h.matcher) && JSON.stringify(h).includes("graphify"))
    );
    if (filtered.length === preTool.length) return;
    settings.hooks.PreToolUse = filtered;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    console.log("  .codebuddy/settings.json  ->  PreToolUse hook removed");
  } catch {}
}

export function codebuddyInstall(projectDir: string = "."): void {
  const isProject = projectDir !== "." && projectDir !== "";
  copySkillFile("codebuddy", { project: isProject, projectDir });
  const target = join(projectDir, "CODEBUDDY.md");
  const alwaysOn = readAlwaysOn("claude-md");

  let newContent: string;
  if (existsSync(target)) {
    const content = readFileSync(target, "utf-8");
    newContent = replaceOrAppendSection(content, CODEBUDDY_MD_MARKER, alwaysOn);
  } else {
    newContent = alwaysOn;
  }

  if (existsSync(target) && newContent === readFileSync(target, "utf-8")) {
    console.log(`graphify already configured in ${resolve(target)} (no change)`);
  } else {
    writeFileSync(target, newContent, "utf-8");
    console.log(`graphify section written to ${resolve(target)}`);
  }

  installCodebuddyHook(projectDir);
  console.log();
  console.log("CodeBuddy will now check the knowledge graph before answering");
  console.log("codebase questions and rebuild it after code changes.");
}

export function codebuddyUninstall(projectDir: string = ".", projectFlag: boolean = false): void {
  removeSkillFile("codebuddy", { project: projectFlag, projectDir });
  const target = join(projectDir, "CODEBUDDY.md");
  if (!existsSync(target)) {
    console.log("No CODEBUDDY.md found - nothing to do");
    return;
  }
  const content = readFileSync(target, "utf-8");
  if (!content.includes(CODEBUDDY_MD_MARKER)) {
    console.log("graphify section not found in CODEBUDDY.md - nothing to do");
    return;
  }
  const cleaned = removeGraphifySection(content, CODEBUDDY_MD_MARKER);
  if (cleaned) {
    writeFileSync(target, cleaned + "\n", "utf-8");
    console.log(`graphify section removed from ${resolve(target)}`);
  } else {
    unlinkSync(target);
    console.log(`CODEBUDDY.md was empty after removal - deleted ${resolve(target)}`);
  }
  uninstallCodebuddyHook(projectDir);
}

// ─── git add hint ─────────────────────────────────────────────────────

function printProjectGitAddHint(paths: string[]): void {
  const existing = paths.filter((p) => existsSync(p));
  if (!existing.length) return;
  console.log('\n  git add \\');
  for (let i = 0; i < existing.length; i++) {
    const suffix = i < existing.length - 1 ? " \\" : "";
    console.log(`    ${existing[i]}${suffix}`);
  }
}

// ─── Main install() ──────────────────────────────────────────────────

export function install(
  platformName: string = "claude",
  options: { project?: boolean; projectDir?: string } = {}
): void {
  const { project = false, projectDir: pdOpt } = options;
  const projectDir = pdOpt || ".";

  printBanner();

  if (platformName === "gemini") {
    geminiInstall(projectDir, project);
    return;
  }
  if (platformName === "cursor") {
    cursorInstall(".");
    return;
  }

  // On Windows, antigravity needs the PowerShell skill, not the bash one
  if (platformName === "antigravity" && platform === "win32") {
    platformName = "antigravity-windows";
  }

  if (!(platformName in PLATFORM_CONFIG)) {
    const validPlatforms = [...Object.keys(PLATFORM_CONFIG), "gemini", "cursor"].join(", ");
    console.error(`error: unknown platform '${platformName}'. Choose from: ${validPlatforms}`);
    process.exit(1);
  }

  const cfg = PLATFORM_CONFIG[platformName];
  const skillDst = copySkillFile(platformName, { project, projectDir });

  if (platformName === "kilo") {
    const commandSrc = join(graphifyPackageDir(), "graphify", "command-kilo.md");
    if (!existsSync(commandSrc)) {
      console.error("error: command-kilo.md not found in package - reinstall graphify");
      process.exit(1);
    }
    const commandDst = join(homedir(), ".config", "kilo", "command", "graphify.md");
    mkdirSync(dirname(commandDst), { recursive: true });
    cpSync(commandSrc, commandDst);
    console.log(`  command installed ->  ${commandDst}`);
  }

  if (cfg.claudeMd) {
    const claudeMd = project
      ? join(projectDir, ".claude", "CLAUDE.md")
      : join(homedir(), ".claude", "CLAUDE.md");
    const registration = skillRegistration(
      project ? ".claude/skills/graphify/SKILL.md" : "~/.claude/skills/graphify/SKILL.md"
    );
    if (existsSync(claudeMd)) {
      const content = readFileSync(claudeMd, "utf-8");
      if (content.includes("graphify")) {
        console.log(`  CLAUDE.md        ->  already registered (no change)`);
      } else {
        writeFileSync(claudeMd, content.trimEnd() + registration, "utf-8");
        console.log(`  CLAUDE.md        ->  skill registered in ${claudeMd}`);
      }
    } else {
      mkdirSync(dirname(claudeMd), { recursive: true });
      writeFileSync(claudeMd, registration.trimStart(), "utf-8");
      console.log(`  CLAUDE.md        ->  created at ${claudeMd}`);
    }
  }

  if (platformName === "codebuddy") {
    const codebuddyMd = join(homedir(), ".codebuddy", "CODEBUDDY.md");
    const registration = skillRegistration("~/.codebuddy/skills/graphify/SKILL.md");
    if (existsSync(codebuddyMd)) {
      const content = readFileSync(codebuddyMd, "utf-8");
      if (content.includes("graphify")) {
        console.log(`  CODEBUDDY.md     ->  already registered (no change)`);
      } else {
        writeFileSync(codebuddyMd, content.trimEnd() + registration, "utf-8");
        console.log(`  CODEBUDDY.md     ->  skill registered in ${codebuddyMd}`);
      }
    } else {
      mkdirSync(dirname(codebuddyMd), { recursive: true });
      writeFileSync(codebuddyMd, registration.trimStart(), "utf-8");
      console.log(`  CODEBUDDY.md     ->  created at ${codebuddyMd}`);
    }
  }

  if (platformName === "opencode") {
    installOpencodePlugin(project ? projectDir : ".");
  }

  if (project) {
    printProjectGitAddHint([projectScopeRoot(skillDst, projectDir)]);
  } else {
    refreshAllVersionStamps();
  }

  console.log();
  console.log("Done. Open your AI coding assistant and type:");
  console.log();
  console.log("  /graphify .");
  console.log();
}

// ─── projectInstall / projectUninstall / projectUninstallAll ──────────

const AGENTS_PLATFORMS = ["aider", "amp", "codex", "opencode", "claw", "droid", "trae", "trae-cn", "hermes"];
const COPILOT_FAMILY = ["copilot", "pi", "kimi"];

export function projectInstall(platformName: string, projectDir: string = "."): void {
  if (["claude", "windows"].includes(platformName)) {
    install(platformName, { project: true, projectDir });
    claudeInstall(projectDir);
    printProjectGitAddHint([join(projectDir, ".claude"), join(projectDir, "CLAUDE.md")]);
  } else if (platformName === "gemini") {
    geminiInstall(projectDir, true);
  } else if (platformName === "cursor") {
    cursorInstall(projectDir);
    printProjectGitAddHint([join(projectDir, ".cursor")]);
  } else if (platformName === "kiro") {
    kiroInstall(projectDir);
    printProjectGitAddHint([join(projectDir, ".kiro")]);
  } else if (AGENTS_PLATFORMS.includes(platformName)) {
    const skillDst = copySkillFile(platformName, { project: true, projectDir });
    agentsInstall(projectDir, platformName);
    const hintPaths = [projectScopeRoot(skillDst, projectDir), join(projectDir, "AGENTS.md")];
    if (platformName === "opencode") hintPaths.push(join(projectDir, ".opencode"));
    else if (platformName === "codex") hintPaths.push(join(projectDir, ".codex"));
    printProjectGitAddHint(hintPaths);
  } else if (platformName === "devin") {
    const skillDst = copySkillFile("devin", { project: true, projectDir });
    devinRulesInstall(projectDir);
    printProjectGitAddHint([projectScopeRoot(skillDst, projectDir), join(projectDir, ".windsurf")]);
  } else if (platformName === "antigravity") {
    const skillDst = copySkillFile("antigravity", { project: true, projectDir });
    antigravityFinalize(skillDst, projectDir);
    printProjectGitAddHint([projectScopeRoot(skillDst, projectDir), join(projectDir, ".agents")]);
  } else if (COPILOT_FAMILY.includes(platformName)) {
    const skillDst = copySkillFile(platformName, { project: true, projectDir });
    printProjectGitAddHint([projectScopeRoot(skillDst, projectDir)]);
  } else {
    install(platformName, { project: true, projectDir });
  }
}

export function projectUninstall(platformName: string, projectDir: string = "."): void {
  if (["claude", "windows"].includes(platformName)) {
    removeSkillFile(platformName, { project: true, projectDir });
    removeClaudeSkillRegistration(projectDir);
    claudeUninstall(projectDir, true);
  } else if (platformName === "gemini") {
    geminiUninstall(projectDir, true);
  } else if (platformName === "cursor") {
    cursorUninstall(projectDir);
  } else if (platformName === "kiro") {
    kiroUninstall(projectDir);
  } else if (AGENTS_PLATFORMS.includes(platformName)) {
    removeSkillFile(platformName, { project: true, projectDir });
    agentsUninstall(projectDir, platformName);
    if (platformName === "codex") uninstallCodexHook(projectDir);
  } else if (platformName === "antigravity") {
    antigravityUninstall(projectDir, true);
  } else if (platformName === "devin") {
    const removed = removeSkillFile("devin", { project: true, projectDir });
    devinRulesUninstall(projectDir);
    if (!removed) console.log("nothing to remove");
  } else if (COPILOT_FAMILY.includes(platformName)) {
    const removed = removeSkillFile(platformName, { project: true, projectDir });
    if (!removed) console.log("nothing to remove");
  } else if (platformName === "codebuddy") {
    codebuddyUninstall(projectDir);
  } else {
    removeSkillFile(platformName, { project: true, projectDir });
  }
}

export function projectUninstallAll(projectDir: string = "."): void {
  console.log("Uninstalling project-scoped graphify files...\n");
  for (const platformName of Object.keys(PLATFORM_CONFIG)) {
    projectUninstall(platformName, projectDir);
  }
  for (const platformName of ["gemini", "cursor"] as const) {
    projectUninstall(platformName, projectDir);
  }
  console.log("\nDone.");
}

// ─── uninstallAll ────────────────────────────────────────────────────

export function uninstallAll(projectDir: string = ".", purge: boolean = false): void {
  const pd = projectDir;
  console.log("Uninstalling graphify from all detected platforms...\n");

  claudeUninstall(pd);
  codebuddyUninstall(pd);
  geminiUninstall(pd);
  vscodeUninstall(pd);
  cursorUninstall(pd);
  kiroUninstall(pd);
  antigravityUninstall(pd);
  agentsUninstall(pd);
  removeSkillFile("amp");
  uninstallOpencodePlugin(pd);
  uninstallCodexHook(pd);

  // Git hook
  try {
    const result = uninstallHook(pd);
    if (result) console.log(result);
  } catch {}

  if (purge) {
    const out = join(pd, "graphify-out");
    if (existsSync(out)) {
      rmSync(out, { recursive: true, force: true });
      console.log("\n  graphify-out/  ->  deleted (--purge)");
    } else {
      console.log("\n  graphify-out/  ->  not found (nothing to purge)");
    }
  }

  console.log("\nDone. Run 'npm uninstall -g graphify' to remove the package itself.");
}

export function printInstallUsage(): void {
  const platforms = [...Object.keys(PLATFORM_CONFIG), "gemini", "cursor"].join(", ");
  console.log("Usage: graphify install [--project] [--platform P|P]");
  console.log(`Platforms: ${platforms}`);
}

// Re-export platform functions for CLI use
export { claudeInstall, claudeUninstall, installClaudeHook, uninstallClaudeHook } from "./platforms/claude.js";
export { geminiInstall, geminiUninstall } from "./platforms/gemini.js";
export { cursorInstall, cursorUninstall } from "./platforms/cursor.js";
export { vscodeInstall, vscodeUninstall } from "./platforms/vscode.js";
export { kiroInstall, kiroUninstall } from "./platforms/kiro.js";
export { antigravityInstall, antigravityUninstall } from "./platforms/antigravity.js";
export { devinRulesInstall, devinRulesUninstall } from "./platforms/devin.js";
export { installKiloPlugin, uninstallKiloPlugin, kiloUninstallGlobal, kiloInstall, kiloUninstall } from "./platforms/kilo.js";
export { installOpencodePlugin, uninstallOpencodePlugin } from "./platforms/opencode.js";
export { ampInstall, ampUninstall } from "./platforms/amp.js";

// Re-export core utilities
export { copySkillFile, removeSkillFile, projectScopeRoot } from "./skill-files.js";
export { platformSkillDestination, PLATFORM_CONFIG } from "./platform-config.js";
export { readAlwaysOn } from "./always-on.js";
export { replaceOrAppendSection } from "./sections.js";
export { skillRegistration, printBanner, refreshAllVersionStamps, removeGraphifySection } from "./utils.js";
