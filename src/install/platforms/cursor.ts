import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const CURSOR_RULE_PATH = join(".cursor", "rules", "graphify.mdc");
const CURSOR_RULE = `---
description: graphify knowledge graph context
alwaysApply: true
---

This project has a graphify knowledge graph at graphify-out/.

**MANDATORY: Before using Read, Grep, Glob, or Bash to explore the codebase, you MUST run graphify first:**
- \`graphify query "<question>"\` -- scoped subgraph for any codebase or architecture question
- \`graphify path "<A>" "<B>"\` -- dependency path between two symbols
- \`graphify explain "<concept>"\` -- all nodes related to a concept

This applies to YOU and to every subagent you spawn. Include this rule explicitly in every subagent prompt that involves code exploration. Do not skip graphify because files are "already known" or because you are executing a plan -- the graph surfaces cross-file dependencies and INFERRED edges that grep and Read cannot find.

Only use Read/Grep/Glob directly when:
1. graphify has already oriented you and you need to modify or debug specific lines
2. \`graphify-out/graph.json\` does not exist yet

- If \`graphify-out/wiki/index.md\` exists, navigate it instead of reading raw files
- Read \`graphify-out/GRAPH_REPORT.md\` only for broad architecture review when query/path/explain do not surface enough context
- After modifying code files, run \`graphify update .\` to keep the graph current (AST-only, no API cost)
`;

export function cursorInstall(projectDir: string = "."): void {
  const rulePath = join(projectDir, CURSOR_RULE_PATH);
  mkdirSync(join(projectDir, ".cursor", "rules"), { recursive: true });
  if (existsSync(rulePath) && readFileSync(rulePath, "utf-8") === CURSOR_RULE) {
    console.log(`graphify rule at ${rulePath} already configured (no change)`);
    return;
  }
  const action = existsSync(rulePath) ? "updated" : "written";
  writeFileSync(rulePath, CURSOR_RULE, "utf-8");
  console.log(`graphify rule ${action} at ${resolve(rulePath)}`);
  console.log();
  console.log("Cursor will now always include the knowledge graph context.");
  console.log("Run /graphify . first to build the graph if you haven't already.");
}

export function cursorUninstall(projectDir: string = "."): void {
  const rulePath = join(projectDir, CURSOR_RULE_PATH);
  if (!existsSync(rulePath)) {
    console.log("No graphify Cursor rule found - nothing to do");
    return;
  }
  unlinkSync(rulePath);
  console.log(`graphify Cursor rule removed from ${resolve(rulePath)}`);
}
