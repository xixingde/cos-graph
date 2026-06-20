import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { readAlwaysOn } from "../always-on.js";
import { replaceOrAppendSection } from "../sections.js";
import { removeGraphifySection } from "../utils.js";
import { copySkillFile, removeSkillFile } from "../skill-files.js";

const GEMINI_MD_MARKER = "## graphify";

const GEMINI_HOOK_COMMAND = [
  'python -c "',
  "import sys,pathlib,json;",
  "e=pathlib.Path('graphify-out/graph.json').exists();",
  "d={'decision':'allow'};",
  "e and d.update({'additionalContext':'graphify: knowledge graph at graphify-out/. For focused questions, run `graphify query \\\"<question>\\\"` (scoped subgraph, usually much smaller than GRAPH_REPORT.md) instead of grepping raw files. Read GRAPH_REPORT.md only for broad architecture context.'});",
  'sys.stdout.write(json.dumps(d))',
  '"',
].join("");

const GEMINI_HOOK = {
  matcher: "read_file|list_directory",
  hooks: [{ type: "command", command: GEMINI_HOOK_COMMAND }],
};

export function geminiInstall(projectDir: string = ".", project: boolean = false): void {
  const skillDst = copySkillFile("gemini", { project, projectDir });
  const target = join(projectDir, "GEMINI.md");

  let newContent: string;
  if (existsSync(target)) {
    const content = readFileSync(target, "utf-8");
    newContent = replaceOrAppendSection(content, GEMINI_MD_MARKER, readAlwaysOn("gemini-md"));
  } else {
    newContent = readAlwaysOn("gemini-md");
  }

  if (existsSync(target) && newContent === readFileSync(target, "utf-8")) {
    console.log(`graphify already configured in ${resolve(target)} (no change)`);
  } else {
    writeFileSync(target, newContent, "utf-8");
    console.log(`graphify section written to ${resolve(target)}`);
  }

  installGeminiHook(projectDir);

  console.log();
  console.log("Gemini CLI will now check the knowledge graph before answering");
  console.log("codebase questions and rebuild it after code changes.");
}

export function installGeminiHook(projectDir: string): void {
  const settingsPath = join(projectDir, ".gemini", "settings.json");
  mkdirSync(dirname(settingsPath), { recursive: true });
  let settings: Record<string, any> = {};
  try {
    if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch { settings = {}; }

  const beforeTool: any[] = (settings.hooks ?? (settings.hooks = {})).BeforeTool ?? [];
  settings.hooks.BeforeTool = beforeTool.filter((h: any) => !JSON.stringify(h).includes("graphify"));
  settings.hooks.BeforeTool.push(GEMINI_HOOK);
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  console.log("  .gemini/settings.json  ->  BeforeTool hook registered");
}

export function uninstallGeminiHook(projectDir: string): void {
  const settingsPath = join(projectDir, ".gemini", "settings.json");
  if (!existsSync(settingsPath)) return;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const beforeTool: any[] = settings?.hooks?.BeforeTool ?? [];
    const filtered = beforeTool.filter((h: any) => !JSON.stringify(h).includes("graphify"));
    if (filtered.length === beforeTool.length) return;
    settings.hooks.BeforeTool = filtered;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    console.log("  .gemini/settings.json  ->  BeforeTool hook removed");
  } catch {}
}

export function geminiUninstall(projectDir: string = ".", project: boolean = false): void {
  removeSkillFile("gemini", { project, projectDir });
  const target = join(projectDir, "GEMINI.md");
  if (!existsSync(target)) {
    console.log("No GEMINI.md found in current directory - nothing to do");
    return;
  }
  const content = readFileSync(target, "utf-8");
  if (!content.includes(GEMINI_MD_MARKER)) {
    console.log("graphify section not found in GEMINI.md - nothing to do");
    return;
  }
  const cleaned = removeGraphifySection(content, GEMINI_MD_MARKER);
  if (cleaned) {
    writeFileSync(target, cleaned + "\n", "utf-8");
    console.log(`graphify section removed from ${resolve(target)}`);
  } else {
    unlinkSync(target);
    console.log(`GEMINI.md was empty after removal - deleted ${resolve(target)}`);
  }
  uninstallGeminiHook(projectDir);
}
