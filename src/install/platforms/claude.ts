import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { readAlwaysOn } from "../always-on.js";
import { replaceOrAppendSection } from "../sections.js";
import { removeGraphifySection, skillRegistration } from "../utils.js";
import { copySkillFile, removeSkillFile } from "../skill-files.js";
import { platformSkillDestination, graphifyPackageDir, PLATFORM_CONFIG } from "../platform-config.js";

const CLAUDE_MD_MARKER = "## graphify";

const SETTINGS_HOOK_COMMAND = [
  'CMD=$(python3 -c "',
  "import json,sys; d=json.load(sys.stdin); ",
  "print(d.get('tool_input',d).get('command',''))\" 2>/dev/null || true); ",
  'case "$CMD" in ',
  "*grep*|*rg\\ *|*ripgrep*|*find\\ *|*fd\\ *|*ack\\ *|*ag\\ *) ",
  "[ -f graphify-out/graph.json ] && ",
  '\'{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"MANDATORY: graphify-out/graph.json exists. You MUST run `graphify query \\"<question\\"` before grepping raw files. Only grep after graphify has oriented you, or to modify/debug specific lines."}}\' ',
  "|| true ;; ",
  "esac",
].join("");

const SETTINGS_HOOK = {
  matcher: "Bash",
  hooks: [{ type: "command", command: SETTINGS_HOOK_COMMAND }],
};

const READ_SETTINGS_HOOK_COMMAND = [
  'HIT=$(python3 -c "',
  "import json,sys;",
  "d=json.load(sys.stdin);",
  "t=d.get('tool_input',d);",
  "s=(str(t.get('file_path') or '')+' '+str(t.get('pattern') or '')+' '+str(t.get('path') or '')).lower().replace(chr(92),'/');",
  "exts=('.py','.js','.ts','.tsx','.jsx','.go','.rs','.java','.rb','.c','.h','.cpp','.hpp','.cc','.cs','.kt','.swift','.php','.scala','.lua','.sh','.md','.rst','.txt','.mdx');",
  "sys.stdout.write('1' if 'graphify-out/' not in s and any(e in s for e in exts) else '')\" 2>/dev/null || true); ",
  'if [ "$HIT" = 1 ] && [ -f graphify-out/graph.json ]; then ',
  '\'{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"MANDATORY: graphify-out/graph.json exists. You MUST run graphify before reading source files. Use: `graphify query \\"<question\\"` (scoped subgraph), `graphify explain \\"<concept>\\"`, or `graphify path \\"<A>\\" \\"<B>\\"`. Only read raw files after graphify has oriented you, or to modify/debug specific lines. This rule applies to subagents too -- include it in every subagent prompt involving code exploration."}}\'; ',
  "fi || true",
].join("");

const READ_SETTINGS_HOOK = {
  matcher: "Read|Glob",
  hooks: [{ type: "command", command: READ_SETTINGS_HOOK_COMMAND }],
};

export function claudeInstall(projectDir: string = "."): void {
  const target = join(projectDir, "CLAUDE.md");
  const alwaysOn = readAlwaysOn("claude-md");

  let newContent: string;
  if (existsSync(target)) {
    const content = readFileSync(target, "utf-8");
    newContent = replaceOrAppendSection(content, CLAUDE_MD_MARKER, alwaysOn);
  } else {
    newContent = alwaysOn;
  }

  if (existsSync(target) && newContent === readFileSync(target, "utf-8")) {
    console.log(`graphify already configured in ${resolve(target)} (no change)`);
  } else {
    writeFileSync(target, newContent, "utf-8");
    console.log(`graphify section written to ${resolve(target)}`);
  }

  installClaudeHook(projectDir);

  console.log();
  console.log("Claude Code will now check the knowledge graph before answering");
  console.log("codebase questions and rebuild it after code changes.");
}

export function installClaudeHook(projectDir: string = "."): void {
  const settingsPath = join(projectDir, ".claude", "settings.json");
  mkdirSync(dirname(settingsPath), { recursive: true });

  let settings: Record<string, any> = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch { settings = {}; }
  }

  const hooks = settings.hooks ?? (settings.hooks = {});
  const preTool = hooks.PreToolUse ?? (hooks.PreToolUse = []);

  hooks.PreToolUse = preTool.filter(
    (h: any) => !(["Glob|Grep", "Bash", "Read|Glob"].includes(h.matcher) && JSON.stringify(h).includes("graphify"))
  );
  hooks.PreToolUse.push(SETTINGS_HOOK);
  hooks.PreToolUse.push(READ_SETTINGS_HOOK);
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  console.log("  .claude/settings.json  ->  PreToolUse hooks registered (Bash search + Read/Glob)");
}

export function uninstallClaudeHook(projectDir: string = "."): void {
  const settingsPath = join(projectDir, ".claude", "settings.json");
  if (!existsSync(settingsPath)) return;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const preTool: any[] = settings?.hooks?.PreToolUse ?? [];
    const filtered = preTool.filter(
      (h: any) => !(["Glob|Grep", "Bash", "Read|Glob"].includes(h.matcher) && JSON.stringify(h).includes("graphify"))
    );
    if (filtered.length === preTool.length) return;
    settings.hooks.PreToolUse = filtered;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    console.log("  .claude/settings.json  ->  PreToolUse hook removed");
  } catch {}
}

export function claudeUninstall(projectDir: string = ".", project: boolean = false): void {
  removeSkillFile("claude", { project, projectDir });
  const target = join(projectDir, "CLAUDE.md");
  if (!existsSync(target)) {
    console.log("No CLAUDE.md found in current directory - nothing to do");
    return;
  }
  const content = readFileSync(target, "utf-8");
  if (!content.includes(CLAUDE_MD_MARKER)) {
    console.log("graphify section not found in CLAUDE.md - nothing to do");
    return;
  }
  const cleaned = removeGraphifySection(content, CLAUDE_MD_MARKER);
  if (cleaned) {
    writeFileSync(target, cleaned + "\n", "utf-8");
    console.log(`graphify section removed from ${resolve(target)}`);
  } else {
    unlinkSync(target);
    console.log(`CLAUDE.md was empty after removal - deleted ${resolve(target)}`);
  }
  uninstallClaudeHook(projectDir);
}

export function removeClaudeSkillRegistration(projectDir: string): void {
  const claudeMd = join(projectDir, ".claude", "CLAUDE.md");
  if (!existsSync(claudeMd)) return;
  const content = readFileSync(claudeMd, "utf-8");
  if (!content.includes("# graphify")) return;
  const cleaned = removeGraphifySection(content, "# graphify");
  if (cleaned) {
    writeFileSync(claudeMd, cleaned + "\n", "utf-8");
    console.log(`  CLAUDE.md        ->  graphify skill registration removed from ${claudeMd}`);
  } else {
    unlinkSync(claudeMd);
    console.log(`  CLAUDE.md        ->  deleted ${claudeMd}`);
  }
}
