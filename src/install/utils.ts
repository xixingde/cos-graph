import { existsSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { VERSION } from "../index.js";
import { PLATFORM_CONFIG, platformSkillDestination, graphifyPackageDir } from "./platform-config.js";

export function skillRegistration(
  skillPath: string = "~/.claude/skills/graphify/SKILL.md"
): string {
  return (
    "\n# graphify\n" +
    `- **graphify** (\`${skillPath}\`) ` +
    "- any input to knowledge graph. Trigger: `/graphify`\n" +
    "When the user types `/graphify`, invoke the Skill tool " +
    'with `skill: "graphify"` before doing anything else.\n'
  );
}

export function checkSkillVersion(skillDst: string): void {
  const versionFile = join(dirname(skillDst), ".graphify_version");
  try {
    if (!existsSync(versionFile)) return;
  } catch { return; }

  try {
    if (!existsSync(skillDst)) {
      console.log("  warning: skill dir exists but SKILL.md is missing. Run 'graphify install' to repair.");
      return;
    }
  } catch { return; }

  try {
    const body = readFileSync(skillDst, "utf-8");
    if (body.includes("references/") && !existsSync(join(dirname(skillDst), "references"))) {
      console.error("  warning: skill references/ sidecar is missing. Run 'graphify install' to repair.");
    }
  } catch {}

  try {
    const installed = readFileSync(versionFile, "utf-8").trim();
    if (installed !== VERSION) {
      console.error(`  warning: skill is from graphify ${installed}, package is ${VERSION}. Run 'graphify install' to update.`);
    }
  } catch {}
}

export function refreshAllVersionStamps(): void {
  for (const name of Object.keys(PLATFORM_CONFIG)) {
    const skillDst = platformSkillDestination(name);
    const vf = join(dirname(skillDst), ".graphify_version");
    if (existsSync(skillDst)) {
      writeFileSync(vf, VERSION, "utf-8");
    }
  }
}

export function printBanner(): void {
  if (!process.stdout.isTTY) return;
  try {
    const A = "\x1b[38;5;214m";
    const D = "\x1b[38;5;130m";
    const R = "\x1b[0m";
    console.log(`${A}
  \u256d\u2500\u2500\u25c9\u2500\u2500\u256e     \u256d\u2500\u2500\u25c9\u2500\u2500\u256e
 \u2571  \u25c9   \u25c9 \u2571 \u2571 \u25c9   \u25c9  \u2571
\u2502   \u25c9\u2500\u25c9\u2500\u25c9  \u25c9  \u25c9\u2500\u25c9\u2500\u25c9   \u2502
\u2502    \u25c9   \u25c9 \u2502 \u25c9   \u25c9    \u2502
\u2502   \u25c9\u2500\u25c9\u2500\u25c9  \u25c9  \u25c9\u2500\u25c9\u2500\u25c9   \u2502
 \u2571  \u25c9   \u25c9 \u2571 \u2571 \u25c9   \u25c9  \u2571
  \u2570\u2500\u2500\u25c9\u2500\u2500\u256f     \u2570\u2500\u2500\u25c9\u2500\u2500\u256f
           \u25c9

  \u2588\u2580\u2580 \u2588\u2580\u2588 \u2584\u2580\u2588 \u2588\u2580\u2588 \u2588 \u2588 \u2588 \u2588\u2580\u2580 \u2588\u2584\u258d
  \u2588\u2584\u258d \u2588\u2580\u2584 \u2588\u2580\u2588 \u2588\u2580\u2580 \u2588\u2580\u2588 \u2588 \u2588\u2580   \u258d${D}  ${VERSION}${R}
`);
  } catch {}
}

export function stripJsonComments(raw: string): string {
  const result: string[] = [];
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];
    const nxt = i + 1 < raw.length ? raw[i + 1] : "";

    if (lineComment) {
      if (ch === "\n") {
        lineComment = false;
        result.push(ch);
      }
      i++;
      continue;
    }

    if (blockComment) {
      if (ch === "*" && nxt === "/") {
        blockComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (inString) {
      result.push(ch);
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === "/" && nxt === "/") {
      lineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && nxt === "*") {
      blockComment = true;
      i += 2;
      continue;
    }

    result.push(ch);
    if (ch === '"') inString = true;
    i++;
  }

  return result.join("").replace(/,(\s*[}\]])/g, "$1");
}

export function loadJsonLike(configFile: string): Record<string, any> {
  if (!existsSync(configFile)) return {};
  try {
    let raw = readFileSync(configFile, "utf-8");
    if (configFile.endsWith(".jsonc")) {
      raw = stripJsonComments(raw);
    }
    const loaded = JSON.parse(raw);
    return typeof loaded === "object" && loaded !== null && !Array.isArray(loaded) ? loaded : {};
  } catch {
    return {};
  }
}

export function enforceGraphSizeCapOrExit(gp: string): void {
  try {
    const { checkGraphFileSizeCap } = require("../security.js") as typeof import("../security.js");
    checkGraphFileSizeCap(gp);
  } catch (exc: any) {
    if (exc instanceof Error && exc.message.includes("graph file size")) {
      console.error(`error: ${exc.message}`);
      process.exit(1);
    }
  }
}

export function removeGraphifySection(content: string, marker: string): string {
  const cleaned = content.replace(/\n*## graphify\n.*?(?=\n## |\n?$)/gs, "").trimEnd();
  return cleaned;
}
