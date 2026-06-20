import { join } from "node:path";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { VERSION } from "../index.js";

export interface PlatformConfig {
  skillFile: string;
  skillDst: string;
  claudeMd: boolean;
  skillRefs?: string;
}

export const PLATFORM_CONFIG: Record<string, PlatformConfig> = {
  claude: {
    skillFile: "skill.md",
    skillDst: join(".claude", "skills", "graphify", "SKILL.md"),
    claudeMd: true,
    skillRefs: "claude",
  },
  codex: {
    skillFile: "skill-codex.md",
    skillDst: join(".codex", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "codex",
  },
  opencode: {
    skillFile: "skill-opencode.md",
    skillDst: join(".config", "opencode", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "opencode",
  },
  kilo: {
    skillFile: "skill-kilo.md",
    skillDst: join(".config", "kilo", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "kilo",
  },
  aider: {
    skillFile: "skill-aider.md",
    skillDst: join(".aider", "graphify", "SKILL.md"),
    claudeMd: false,
  },
  copilot: {
    skillFile: "skill-copilot.md",
    skillDst: join(".copilot", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "copilot",
  },
  claw: {
    skillFile: "skill-claw.md",
    skillDst: join(".openclaw", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "claw",
  },
  droid: {
    skillFile: "skill-droid.md",
    skillDst: join(".factory", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "droid",
  },
  trae: {
    skillFile: "skill-trae.md",
    skillDst: join(".trae", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "trae",
  },
  "trae-cn": {
    skillFile: "skill-trae.md",
    skillDst: join(".trae-cn", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "trae",
  },
  hermes: {
    skillFile: "skill-claw.md",
    skillDst: join(".hermes", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "claw",
  },
  kiro: {
    skillFile: "skill-kiro.md",
    skillDst: join(".kiro", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "kiro",
  },
  pi: {
    skillFile: "skill-pi.md",
    skillDst: join(".pi", "agent", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "pi",
  },
  codebuddy: {
    skillFile: "skill.md",
    skillDst: join(".codebuddy", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "claude",
  },
  antigravity: {
    skillFile: "skill.md",
    skillDst: join(".agents", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "claude",
  },
  "antigravity-windows": {
    skillFile: "skill-windows.md",
    skillDst: join(".agents", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "windows",
  },
  windows: {
    skillFile: "skill-windows.md",
    skillDst: join(".claude", "skills", "graphify", "SKILL.md"),
    claudeMd: true,
    skillRefs: "windows",
  },
  kimi: {
    skillFile: "skill.md",
    skillDst: join(".kimi", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "claude",
  },
  amp: {
    skillFile: "skill-amp.md",
    skillDst: join(".agents", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
    skillRefs: "amp",
  },
  devin: {
    skillFile: "skill-devin.md",
    skillDst: join(".config", "devin", "skills", "graphify", "SKILL.md"),
    claudeMd: false,
  },
};

export function platformSkillDestination(
  platformName: string,
  options?: { project?: boolean; projectDir?: string }
): string {
  const project = options?.project ?? false;
  const projectDir = options?.projectDir ?? ".";

  if (platformName === "gemini") {
    if (project) return join(projectDir, ".gemini", "skills", "graphify", "SKILL.md");
    if (process.platform === "win32") return join(homedir(), ".agents", "skills", "graphify", "SKILL.md");
    return join(homedir(), ".gemini", "skills", "graphify", "SKILL.md");
  }
  if (platformName === "opencode") {
    if (project) return join(projectDir, ".opencode", "skills", "graphify", "SKILL.md");
    return join(homedir(), ".config", "opencode", "skills", "graphify", "SKILL.md");
  }
  if (platformName === "devin") {
    if (project) return join(projectDir, ".devin", "skills", "graphify", "SKILL.md");
    return join(homedir(), ".config", "devin", "skills", "graphify", "SKILL.md");
  }
  if (platformName === "amp") {
    if (project) return join(projectDir, ".agents", "skills", "graphify", "SKILL.md");
    return join(homedir(), ".config", "agents", "skills", "graphify", "SKILL.md");
  }
  if (platformName === "antigravity" || platformName === "antigravity-windows") {
    if (project) return join(projectDir, ".agents", "skills", "graphify", "SKILL.md");
    return join(homedir(), ".gemini", "config", "skills", "graphify", "SKILL.md");
  }

  const cfg = PLATFORM_CONFIG[platformName];
  if (!cfg) throw new Error(`unknown platform: ${platformName}`);
  if (project) return join(projectDir, cfg.skillDst);

  if ((platformName === "claude" || platformName === "windows") && process.env.CLAUDE_CONFIG_DIR) {
    return join(process.env.CLAUDE_CONFIG_DIR, "skills", "graphify", "SKILL.md");
  }
  return join(homedir(), cfg.skillDst);
}

/**
 * Resolve the graphify package root (contains graphify/ always_on/ skills/ etc.).
 * Uses import.meta.url to locate the module relative to the package structure.
 */
export function graphifyPackageDir(): string {
  // Resolve the package root that contains the graphify/ directory.
  // Two build layouts are supported:
  //   1. Unbundled (splitting:true): dist/install/platform-config.js  -> ../../  = project root
  //   2. Bundled   (splitting:false): dist/cli.js                     -> ../    = project root
  // We try both, preferring the deeper (unbundled) path first.
  const candidates = ["../../", "../"];

  for (const rel of candidates) {
    const root = new URL(rel, import.meta.url).pathname;
    const decoded = decodeURIComponent(root);
    const fixed = decoded.replace(/^\/([A-Za-z]:\/)/, "$1");
    // Verify the graphify/skill.md file actually exists at this candidate
    // (just checking the directory is not enough — a sibling project may
    // also have a graphify/ directory but without the skill files)
    try {
      if (statSync(join(fixed, "graphify")).isDirectory() && existsSync(join(fixed, "graphify", "skill.md"))) {
        return fixed;
      }
    } catch { /* try next candidate */ }
  }

  // Fallback: use the deeper path (original behaviour) even if graphify/ is missing
  const root = new URL("../../", import.meta.url).pathname;
  const decoded = decodeURIComponent(root);
  return decoded.replace(/^\/([A-Za-z]:\/)/, "$1");
}

export function packagedSkillRefsDir(platformName: string): string | null {
  let bundle: string | undefined;
  if (platformName === "gemini") {
    bundle = "claude";
  } else {
    bundle = PLATFORM_CONFIG[platformName]?.skillRefs;
  }
  if (!bundle) return null;
  const bundleDir = join(graphifyPackageDir(), "graphify", "skills", bundle);
  try {
    if (!statSync(bundleDir).isDirectory()) return null;
  } catch {
    return null;
  }
  return join(bundleDir, "references");
}
