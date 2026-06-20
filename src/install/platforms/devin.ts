import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { copySkillFile, removeSkillFile } from "../skill-files.js";

const DEVIN_RULES_PATH = join(".windsurf", "rules", "graphify.md");
const DEVIN_RULES = `## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- For codebase or architecture questions, when \`graphify-out/graph.json\` exists, first run \`graphify query "<question>"\` (or \`graphify path "<A>" "<B>"\` / \`graphify explain "<concept>"\`). These return a scoped subgraph, usually much smaller than \`GRAPH_REPORT.md\` or raw grep output.
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context
- After modifying code files in this session, run \`graphify update .\` to keep the graph current (AST-only, no API cost)
`;

export function devinRulesInstall(projectDir: string = "."): void {
  const rulesPath = join(projectDir, DEVIN_RULES_PATH);
  mkdirSync(join(projectDir, ".windsurf", "rules"), { recursive: true });
  if (existsSync(rulesPath) && readFileSync(rulesPath, "utf-8") === DEVIN_RULES) {
    console.log(`  ${rulesPath}  ->  already configured (no change)`);
    return;
  }
  const action = existsSync(rulesPath) ? "updated" : "written";
  writeFileSync(rulesPath, DEVIN_RULES, "utf-8");
  console.log(`  rules ${action}  ->  ${rulesPath}`);
}

export function devinRulesUninstall(projectDir: string = "."): void {
  const rulesPath = join(projectDir, DEVIN_RULES_PATH);
  if (!existsSync(rulesPath)) return;
  unlinkSync(rulesPath);
  console.log(`  rules removed  ->  ${rulesPath}`);
}

export function devinInstall(projectDir: string = ".", project: boolean = false): void {
  copySkillFile("devin", { project, projectDir });
  devinRulesInstall(projectDir);
}

export function devinUninstall(projectDir: string = ".", project: boolean = false): void {
  const removed = removeSkillFile("devin", { project, projectDir });
  devinRulesUninstall(projectDir);
  if (!removed) {
    console.log("nothing to remove");
  }
}
