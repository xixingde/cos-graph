import { readFileSync } from "node:fs";
import { join } from "node:path";
import { graphifyPackageDir } from "./platform-config.js";

const cache = new Map<string, string>();

export const ALWAYS_ON_ALIASES: Record<string, string> = {
  claudeMdSection: "claude-md",
  agentsMdSection: "agents-md",
  geminiMdSection: "gemini-md",
  vscodeInstructionsSection: "vscode-instructions",
  antigravityRules: "antigravity-rules",
  kiroSteering: "kiro-steering",
};

export function readAlwaysOn(basename: string): string {
  const cached = cache.get(basename);
  if (cached !== undefined) return cached;

  const path = join(graphifyPackageDir(), "graphify", "always_on", `${basename}.md`);
  try {
    const content = readFileSync(path, "utf-8");
    cache.set(basename, content);
    return content;
  } catch (exc: any) {
    throw new Error(
      `graphify install is incomplete: missing always-on block '${basename}' ` +
        `at ${path}. Reinstall graphify (e.g. npm install -g graphify).`
    );
  }
}
