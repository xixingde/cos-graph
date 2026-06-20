import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmSync, rmdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { readAlwaysOn } from "../always-on.js";
import { platformSkillDestination } from "../platform-config.js";
import { copySkillFile, removeSkillFile } from "../skill-files.js";

const ANTIGRAVITY_RULES_PATH = join(".agents", "rules", "graphify.md");
const ANTIGRAVITY_WORKFLOW_PATH = join(".agents", "workflows", "graphify.md");

const ANTIGRAVITY_WORKFLOW = [
  "---",
  "name: graphify",
  "description: Turn any folder of files into a navigable knowledge graph",
  "---",
  "",
  "# Workflow: graphify",
  "",
  "Follow the graphify skill installed at ~/.gemini/config/skills/graphify/SKILL.md to run the full pipeline.",
  "",
  "If no path argument is given, use `.` (current directory).",
  "",
].join("\n");

export function antigravityFinalize(skillDst: string, projectDir: string): void {
  // Inject YAML frontmatter for native Antigravity tool discovery.
  if (existsSync(skillDst)) {
    const content = readFileSync(skillDst, "utf-8");
    if (!content.startsWith("---\n")) {
      const frontmatter = "---\nname: graphify-manager\ndescription: Rebuild the code graph or perform manual CLI queries when MCP server is offline.\n---\n\n";
      writeFileSync(skillDst, frontmatter + content, "utf-8");
    }
  }

  // .agents/rules/graphify.md
  const rulesPath = join(projectDir, ANTIGRAVITY_RULES_PATH);
  mkdirSync(dirname(rulesPath), { recursive: true });
  const rulesContent = readAlwaysOn("antigravity-rules");
  if (existsSync(rulesPath)) {
    const existing = readFileSync(rulesPath, "utf-8");
    if (rulesContent.trim() !== existing.trim()) {
      writeFileSync(rulesPath, rulesContent, "utf-8");
      console.log(`graphify rule updated at ${resolve(rulesPath)}`);
    } else {
      console.log(`graphify rule already configured at ${resolve(rulesPath)} (no change)`);
    }
  } else {
    writeFileSync(rulesPath, rulesContent, "utf-8");
    console.log(`graphify rule written to ${resolve(rulesPath)}`);
  }

  // .agents/workflows/graphify.md
  const wfPath = join(projectDir, ANTIGRAVITY_WORKFLOW_PATH);
  mkdirSync(dirname(wfPath), { recursive: true });
  if (existsSync(wfPath)) {
    const existing = readFileSync(wfPath, "utf-8");
    if (ANTIGRAVITY_WORKFLOW.trim() !== existing.trim()) {
      writeFileSync(wfPath, ANTIGRAVITY_WORKFLOW, "utf-8");
      console.log(`graphify workflow updated at ${resolve(wfPath)}`);
    } else {
      console.log(`graphify workflow already configured at ${resolve(wfPath)} (no change)`);
    }
  } else {
    writeFileSync(wfPath, ANTIGRAVITY_WORKFLOW, "utf-8");
    console.log(`graphify workflow written to ${resolve(wfPath)}`);
  }
}

/** Install graphify for Antigravity (global skill + .agents/rules + .agents/workflows). */
export function antigravityInstall(projectDir: string, installFn: (platform: string) => void): void {
  installFn("antigravity");
  const skillDst = platformSkillDestination("antigravity");
  antigravityFinalize(skillDst, projectDir);

  console.log();
  console.log("Antigravity will now check the knowledge graph before answering");
  console.log("codebase questions. Run /graphify first to build the graph.");
  console.log();
  console.log(
    "To enable full MCP architecture navigation, add this to ~/.gemini/antigravity/mcp_config.json:"
  );
  console.log('  "graphify": {');
  console.log('    "command": "uv",');
  console.log(
    '    "args": ["run", "--with", "graphifyy", "--with", "mcp", "-m", "graphify.serve", "${workspace.path}/graphify-out/graph.json"]'
  );
  console.log("  }");
}

export function antigravityUninstall(projectDir: string = ".", project: boolean = false): void {
  // Remove rules file
  const rulesPath = join(projectDir, ANTIGRAVITY_RULES_PATH);
  if (existsSync(rulesPath)) {
    unlinkSync(rulesPath);
    console.log(`graphify rule removed from ${resolve(rulesPath)}`);
  } else {
    console.log("No graphify Antigravity rule found - nothing to do");
  }

  // Remove workflow file
  const wfPath = join(projectDir, ANTIGRAVITY_WORKFLOW_PATH);
  if (existsSync(wfPath)) {
    unlinkSync(wfPath);
    console.log(`graphify workflow removed from ${resolve(wfPath)}`);
  }

  // Remove skill file
  const skillDst = platformSkillDestination("antigravity", { project, projectDir });
  if (existsSync(skillDst)) {
    unlinkSync(skillDst);
    console.log(`graphify skill removed from ${skillDst}`);
  }
  const versionFile = join(dirname(skillDst), ".graphify_version");
  if (existsSync(versionFile)) {
    unlinkSync(versionFile);
  }
  const refsDir = join(dirname(skillDst), "references");
  if (existsSync(refsDir)) {
    rmSync(refsDir, { recursive: true, force: true });
  }
  // Walk up empty dirs
  let dir: string | null = dirname(skillDst);
  for (let i = 0; i < 3 && dir; i++) {
    try { rmdirSync(dir); } catch { break; }
    dir = dirname(dir);
  }
}
