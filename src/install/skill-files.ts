import { existsSync, copyFileSync, writeFileSync, readFileSync, rmSync, cpSync, renameSync, mkdirSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { VERSION } from "../index.js";
import { PLATFORM_CONFIG, platformSkillDestination, packagedSkillRefsDir, graphifyPackageDir } from "./platform-config.js";

export function installSkillReferences(skillDst: string, refsSrc: string): void {
  const refsDst = join(dirname(skillDst), "references");
  const refsStaged = join(dirname(skillDst), "references.tmp");
  if (existsSync(refsStaged)) {
    rmSync(refsStaged, { recursive: true, force: true });
  }
  try {
    cpSync(refsSrc, refsStaged, { recursive: true });
    if (existsSync(refsDst)) {
      rmSync(refsDst, { recursive: true, force: true });
    }
    renameSync(refsStaged, refsDst);
  } catch {
    if (existsSync(refsStaged)) {
      try { rmSync(refsStaged, { recursive: true, force: true }); } catch {}
    }
    throw new Error(`Failed to install references from ${refsSrc} to ${refsDst}`);
  }
}

export function copySkillFile(
  platformName: string,
  options?: { project?: boolean; projectDir?: string }
): string {
  const project = options?.project ?? false;
  const projectDir = options?.projectDir ?? ".";

  const skillFile = platformName === "gemini" ? "skill.md" : PLATFORM_CONFIG[platformName].skillFile;
  const skillSrc = join(graphifyPackageDir(), "graphify", skillFile);
  if (!existsSync(skillSrc)) {
    throw new Error(`error: ${skillFile} not found in package - reinstall graphify`);
  }

  const refsSrc = packagedSkillRefsDir(platformName);
  if (refsSrc !== null && !existsSync(refsSrc)) {
    throw new Error(
      `error: references for '${platformName}' not found in package ` +
        `(${refsSrc}) - reinstall graphify`
    );
  }

  const skillDst = platformSkillDestination(platformName, { project, projectDir });
  mkdirSync(dirname(skillDst), { recursive: true });

  if (refsSrc !== null) {
    installSkillReferences(skillDst, refsSrc);
    console.log(`  references       ->  ${join(dirname(skillDst), "references")}`);
  } else {
    const orphanRefs = join(dirname(skillDst), "references");
    if (existsSync(orphanRefs)) {
      rmSync(orphanRefs, { recursive: true, force: true });
    }
  }

  const tmpDst = skillDst + ".tmp";
  try {
    copyFileSync(skillSrc, tmpDst);
    renameSync(tmpDst, skillDst);
  } catch {
    try { unlinkSync(tmpDst); } catch {}
    throw new Error(`Failed to copy skill file to ${skillDst}`);
  }

  writeFileSync(join(dirname(skillDst), ".graphify_version"), VERSION, "utf-8");
  console.log(`  skill installed  ->  ${skillDst}`);
  return skillDst;
}

export function removeSkillFile(
  platformName: string,
  options?: { project?: boolean; projectDir?: string }
): boolean {
  const project = options?.project ?? false;
  const projectDir = options?.projectDir ?? ".";
  const skillDst = platformSkillDestination(platformName, { project, projectDir });
  let removed = false;

  if (existsSync(skillDst)) {
    unlinkSync(skillDst);
    console.log(`  skill removed    ->  ${skillDst}`);
    removed = true;
  }
  const versionFile = join(dirname(skillDst), ".graphify_version");
  if (existsSync(versionFile)) {
    unlinkSync(versionFile);
    removed = true;
  }
  const refsDir = join(dirname(skillDst), "references");
  if (existsSync(refsDir)) {
    rmSync(refsDir, { recursive: true, force: true });
    removed = true;
  }
  // Walk up empty dirs
  let dir: string | null = dirname(skillDst);
  for (let i = 0; i < 3 && dir; i++) {
    try {
      const entries = statSync(dir);
      if (entries.isDirectory()) {
        try { rmSync(dir, { recursive: false }); } catch { break; }
      } else {
        break;
      }
    } catch {
      break;
    }
    dir = dirname(dir);
  }
  return removed;
}

export function projectScopeRoot(path: string, projectDir: string): string {
  const rel = path.startsWith(projectDir) ? path.slice(projectDir.length).replace(/^[/\\]+/, "") : path;
  const firstPart = rel.split(/[/\\]/)[0];
  return firstPart ? join(projectDir, firstPart) : path;
}
