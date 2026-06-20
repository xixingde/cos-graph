/**
 * skillgen: render graphify's committed skill artifacts from edited fragments.
 *
 * Build-time only. Nothing here ships in the dist. Fragments under
 * tools/skillgen/fragments/ are the single source of truth a human edits; the
 * files under graphify/skill*.md and graphify/skills/<platform>/references/
 * are generated, committed artifacts. This module renders those artifacts and
 * guards them against drift.
 *
 * Usage (from the repo root):
 *
 *   pnpm exec tsx tools/skillgen/index.ts                 # regen every platform's artifacts
 *   pnpm exec tsx tools/skillgen/index.ts --platform claude
 *   pnpm exec tsx tools/skillgen/index.ts --check         # byte-diff render vs committed + expected/
 *   pnpm exec tsx tools/skillgen/index.ts --audit-coverage
 *   pnpm exec tsx tools/skillgen/index.ts --schema-singleton
 *   pnpm exec tsx tools/skillgen/index.ts --monolith-roundtrip
 *   pnpm exec tsx tools/skillgen/index.ts --always-on-roundtrip
 *   pnpm exec tsx tools/skillgen/index.ts --bless         # rewrite expected/ from the current render
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parse as parseToml } from "smol-toml";

// tools/skillgen/index.ts -> repo root is two parents up.
const __filename = fileURLToPath(import.meta.url);
const SKILLGEN_DIR = path.resolve(path.dirname(__filename));
const REPO_ROOT = path.resolve(SKILLGEN_DIR, "..", "..");
const FRAGMENTS_DIR = path.join(SKILLGEN_DIR, "fragments");
const EXPECTED_DIR = path.join(SKILLGEN_DIR, "expected");
const PLATFORMS_TOML = path.join(SKILLGEN_DIR, "platforms.toml");

// Immutable coverage baseline for --audit-coverage.
const _V8_BASELINE_SHA = "47042beb05d1f6dd2186c0c499ae2840ce604ead";

function _v8BaselineRef(platformKey: string): string {
  if (platformKey === "claude") {
    return `${_V8_BASELINE_SHA}:graphify/skill.md`;
  }
  return `${_V8_BASELINE_SHA}:graphify/skill-${platformKey}.md`;
}

// Immutable baseline for --always-on-roundtrip.
const ALWAYS_ON_BASELINE_REF = `${_V8_BASELINE_SHA}:graphify/__main__.py`;

// The always-on instruction blocks: rendered-file basename -> the __main__.py
// constant it must reproduce.
const ALWAYS_ON_BLOCKS: Record<string, string> = {
  "claude-md": "_CLAUDE_MD_SECTION",
  "agents-md": "_AGENTS_MD_SECTION",
  "gemini-md": "_GEMINI_MD_SECTION",
  "vscode-instructions": "_VSCODE_INSTRUCTIONS_SECTION",
  "antigravity-rules": "_ANTIGRAVITY_RULES",
  "kiro-steering": "_KIRO_STEERING",
};

// The full six-value file_type enum (Decision A).
const ENUM_VALUES = "code|document|paper|image|rationale|concept";
const ENUM_PROSE = "`code`, `document`, `paper`, `image`, `rationale`, `concept`";

// The eight on-demand references every split platform renders.
const _SHARED_REFERENCES: Record<string, string> = {
  update: "references/shared/update.md",
  exports: "references/shared/exports.md",
  "github-and-merge": "references/shared/github-and-merge.md",
  transcribe: "references/shared/transcribe.md",
  "add-watch": "references/shared/add-watch.md",
};

const _EXTRACTION_SOURCE: Record<string, string> = {
  verbose: "references/shared/extraction-spec.md",
  compact: "references/shared/extraction-spec-compact.md",
};

const _QUERY_REFERENCE = "references/query/default.md";
const _QUERY_STUB = "query-stub/default.md";

const _HOOKS_SOURCE: Record<string, string> = {
  "claude-md": "references/shared/hooks.md",
  "agents-md": "references/host/hooks-agents-md.md",
};

const _TRAE_PRETOOLUSE_NOTE =
  "\n> **Note:** Unlike Claude Code, Trae does NOT support PreToolUse hooks. " +
  "The AGENTS.md rules are the always-on mechanism -- there is no automatic graph " +
  "rebuild on tool use. Run `/graphify --update` manually after code changes if " +
  "the graph needs refreshing.\n";

const _AGENTS_MD_HOOKS: Record<string, {
  heading_suffix: string;
  host_display: string;
  install_block: string;
  uninstall_block: string;
  pretooluse_note: string;
}> = {
  trae: {
    heading_suffix: " (Trae)",
    host_display: "Trae",
    install_block: "graphify trae install       # or: graphify trae-cn install",
    uninstall_block: "graphify trae uninstall     # or: graphify trae-cn uninstall   # remove the section",
    pretooluse_note: _TRAE_PRETOOLUSE_NOTE,
  },
  amp: {
    heading_suffix: "",
    host_display: "Amp",
    install_block: "graphify amp install",
    uninstall_block: "graphify amp uninstall  # remove the section",
    pretooluse_note: "",
  },
};

const _HOOKS_TARGET: Record<string, string> = {
  "claude-md": "CLAUDE.md",
  "agents-md": "AGENTS.md",
};

// Coverage audit allowlists.
const SHARED_INTRO_ALLOWLIST: Set<string> = new Set([
  "## What graphify is for",
]);

const _CONSOLIDATION_ALLOWLIST: Record<string, Set<string>> = {
  kilo: new Set([
    "#### Step 2.5 - Transcribe video or audio files (only if video files were detected)",
    "#### Part B - Semantic extraction for docs, papers, and images",
    "#### Part C - Merge AST and semantic extraction",
    "### Step 4 - Build the graph and generate outputs",
    "### Step 5 - Save manifest, clean up, and report",
    "### Query mode",
    "### Kilo-specific rules",
  ]),
  vscode: new Set([
    "#### Part A - Structural extraction (AST, free, no API cost)",
    "#### Part B - Semantic extraction (AI, costs tokens)",
    "### Step 4 - Build graph and cluster",
    "### Step 5 - Generate report and visualization",
    "### After completing all steps",
  ]),
};

function _auditAllowlist(platformKey: string): Set<string> {
  const host = _CONSOLIDATION_ALLOWLIST[platformKey];
  if (!host) return new Set(SHARED_INTRO_ALLOWLIST);
  return new Set([...SHARED_INTRO_ALLOWLIST, ...host]);
}

// Platform data class.
export interface Platform {
  key: string;
  bucket: string;
  skill_dst: string;
  core: string | null;
  refs_dst: string | null;
  name: string;
  description: string | null;
  dispatch: string | null;
  extraction: string;
  shell: string;
  claude_md: boolean;
  hooks_variant: string;
  extra_sections: string[];
  monolith: string | null;
  roundtrip_ref: string | null;
}

function makePlatform(data: Partial<Platform> & Pick<Platform, "key" | "bucket" | "skill_dst">): Platform {
  return {
    core: null,
    refs_dst: null,
    name: "graphify",
    description: null,
    dispatch: null,
    extraction: "verbose",
    shell: "posix",
    claude_md: false,
    hooks_variant: "claude-md",
    extra_sections: [],
    monolith: null,
    roundtrip_ref: null,
    ...data,
  };
}

function platformReferenceSources(platform: Platform): Record<string, string> {
  const refs: Record<string, string> = { ..._SHARED_REFERENCES };
  refs["extraction-spec"] = _EXTRACTION_SOURCE[platform.extraction];
  refs.query = _QUERY_REFERENCE;
  refs.hooks = _HOOKS_SOURCE[platform.hooks_variant];
  return refs;
}

function platformHooksTarget(platform: Platform): string {
  return _HOOKS_TARGET[platform.hooks_variant];
}

export function loadPlatforms(): Record<string, Platform> {
  const text = fs.readFileSync(PLATFORMS_TOML, "utf-8");
  const data = parseToml(text) as Record<string, any>;
  const out: Record<string, Platform> = {};
  const platforms = data.platform ?? {};
  for (const key of Object.keys(platforms)) {
    const cfg = platforms[key];
    out[key] = makePlatform({
      key,
      bucket: cfg.bucket,
      skill_dst: cfg.skill_dst,
      core: cfg.core ?? null,
      refs_dst: cfg.refs_dst ?? null,
      name: cfg.name ?? "graphify",
      description: cfg.description ?? null,
      dispatch: cfg.dispatch ?? null,
      extraction: cfg.extraction ?? "verbose",
      shell: cfg.shell ?? "posix",
      claude_md: cfg.claude_md ? true : false,
      hooks_variant: cfg.hooks_variant ?? "claude-md",
      extra_sections: cfg.extra_sections ? [...cfg.extra_sections] : [],
      monolith: cfg.monolith ?? null,
      roundtrip_ref: cfg.roundtrip_ref ?? null,
    });
  }
  return out;
}

function _readFragment(rel: string): string {
  const text = fs.readFileSync(path.join(FRAGMENTS_DIR, rel), "utf-8");
  return _normalise(text);
}

function _normalise(text: string): string {
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return text.replace(/\n+$/, "") + "\n";
}

export interface RenderedArtifact {
  path: string; // relative to REPO_ROOT
  content: string;
}

function _renderFrontmatter(platform: Platform): string {
  if (platform.description === null) {
    throw new Error(`split platform '${platform.key}' is missing a description`);
  }
  return [
    "---",
    `name: ${platform.name}`,
    `description: "${platform.description}"`,
    "---",
  ].join("\n");
}

function _renderCore(platform: Platform): string {
  const template = _readFragment(`core/${platform.core}.md`);

  if (platform.dispatch === null) {
    throw new Error(`split platform '${platform.key}' is missing a dispatch variant`);
  }

  const install = _readFragment(`shell/${platform.shell}.md`).replace(/\n+$/, "");
  const dispatch = _readFragment(`dispatch/${platform.dispatch}.md`).replace(/\n+$/, "");
  const queryStub = _readFragment(_QUERY_STUB).replace(/\n+$/, "");

  let extra = "";
  if (platform.extra_sections.length > 0) {
    extra = platform.extra_sections
      .map((name) => _readFragment(`extra/${name}.md`).replace(/\n+$/, "") + "\n\n")
      .join("");
  }

  let body = template
    .replaceAll("@@FRONTMATTER@@", _renderFrontmatter(platform))
    .replaceAll("@@INSTALL@@", install)
    .replaceAll("@@DISPATCH@@", dispatch)
    .replaceAll("@@QUERY_STUB@@", queryStub)
    .replaceAll("@@HOOKS_TARGET@@", platformHooksTarget(platform))
    .replaceAll("@@EXTRA@@", extra);

  if (body.includes("@@")) {
    const leftover = [...new Set(Array.from(body.matchAll(/@@\w+@@/g), (m) => m[0]))].sort();
    throw new Error(`unfilled core slots for '${platform.key}': ${leftover}`);
  }
  return _normalise(body);
}

function _renderAgentsMdHooks(platform: Platform): string {
  const template = _readFragment(_HOOKS_SOURCE["agents-md"]);
  const slots = _AGENTS_MD_HOOKS[platform.key];
  if (!slots) {
    throw new Error(
      `platform '${platform.key}' uses the agents-md hooks variant but has no _AGENTS_MD_HOOKS entry`
    );
  }
  let body = template
    .replaceAll("@@AGENTS_HEADING_SUFFIX@@", slots.heading_suffix)
    .replaceAll("@@HOST_DISPLAY@@", slots.host_display)
    .replaceAll("@@AGENTS_INSTALL_BLOCK@@", slots.install_block)
    .replaceAll("@@AGENTS_UNINSTALL_BLOCK@@", slots.uninstall_block)
    .replaceAll("@@AGENTS_PRETOOLUSE_NOTE@@", slots.pretooluse_note);

  if (body.includes("@@")) {
    const leftover = [...new Set(Array.from(body.matchAll(/@@\w+@@/g), (m) => m[0]))].sort();
    throw new Error(`unfilled agents-md hooks slots for '${platform.key}': ${leftover}`);
  }
  return _normalise(body);
}

export function render(platform: Platform): RenderedArtifact[] {
  if (platform.bucket === "monolith") {
    const body = _readFragment(`core/${platform.monolith}.md`);
    return [{ path: platform.skill_dst, content: body }];
  }

  if (platform.bucket !== "split") {
    throw new Error(`unknown bucket '${platform.bucket}' for platform '${platform.key}'`);
  }

  if (platform.refs_dst === null) {
    throw new Error(`split platform '${platform.key}' is missing refs_dst`);
  }

  const artifacts: RenderedArtifact[] = [
    { path: platform.skill_dst, content: _renderCore(platform) },
  ];

  const references = platformReferenceSources(platform);
  for (const name of Object.keys(references).sort()) {
    let body: string;
    if (name === "hooks" && platform.hooks_variant === "agents-md") {
      body = _renderAgentsMdHooks(platform);
    } else {
      body = _readFragment(references[name]);
    }
    const rel = `${platform.refs_dst}/${name}.md`;
    artifacts.push({ path: rel, content: body });
  }
  return artifacts;
}

export function renderAlwaysOn(): RenderedArtifact[] {
  const out: RenderedArtifact[] = [];
  for (const basename of Object.keys(ALWAYS_ON_BLOCKS).sort()) {
    const body = _readFragment(`always-on/${basename}.md`);
    out.push({ path: `graphify/always_on/${basename}.md`, content: body });
  }
  return out;
}

export function renderAll(
  platforms: Record<string, Platform>,
  only?: string
): RenderedArtifact[] {
  const keys = only ? [only] : Object.keys(platforms).sort();
  const out: RenderedArtifact[] = [];
  for (const key of keys) {
    if (!(key in platforms)) {
      console.error(
        `error: unknown platform '${key}'. Known: ${Object.keys(platforms).sort().join(", ")}`
      );
      process.exit(1);
    }
    out.push(...render(platforms[key]));
  }
  if (!only) {
    out.push(...renderAlwaysOn());
  }
  return out;
}

function writeArtifacts(artifacts: RenderedArtifact[]): string[] {
  const written: string[] = [];
  for (const art of artifacts) {
    const dst = path.join(REPO_ROOT, art.path);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, art.content, "utf-8");
    written.push(art.path);
  }
  return written;
}

function _expectedPath(rel: string): string {
  return path.join(EXPECTED_DIR, rel.replace(/\//g, "__"));
}

function bless(artifacts: RenderedArtifact[]): string[] {
  const written: string[] = [];
  for (const art of artifacts) {
    const dst = _expectedPath(art.path);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, art.content, "utf-8");
    written.push(path.relative(SKILLGEN_DIR, dst));
  }
  return written;
}

export function check(artifacts: RenderedArtifact[]): string[] {
  const problems: string[] = [];
  for (const art of artifacts) {
    const committed = path.join(REPO_ROOT, art.path);
    if (!fs.existsSync(committed)) {
      problems.push(
        `missing committed artifact: ${art.path} (run: pnpm exec tsx tools/skillgen/index.ts)`
      );
    } else if (fs.readFileSync(committed, "utf-8") !== art.content) {
      problems.push(
        `committed artifact out of date: ${art.path} (run: pnpm exec tsx tools/skillgen/index.ts)`
      );
    }

    const snapshot = _expectedPath(art.path);
    if (!fs.existsSync(snapshot)) {
      problems.push(
        `missing expected/ snapshot: ${art.path} (run: pnpm exec tsx tools/skillgen/index.ts --bless)`
      );
    } else if (fs.readFileSync(snapshot, "utf-8") !== art.content) {
      problems.push(
        `expected/ snapshot out of date: ${art.path} (run: pnpm exec tsx tools/skillgen/index.ts --bless)`
      );
    }
  }
  return problems;
}

export function headings(markdown: string): string[] {
  const out: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  for (const line of markdown.split("\n")) {
    const stripped = line.trimStart();
    if (stripped.startsWith("```") || stripped.startsWith("~~~")) {
      const marker = stripped.slice(0, 3);
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;
    if (stripped.startsWith("#")) {
      const hashes = stripped.length - stripped.replace(/^#+/, "").length;
      if (hashes >= 1 && hashes <= 6 && stripped[hashes] === " ") {
        out.push(stripped.trim());
      }
    }
  }
  return out;
}

function _gitShow(ref: string): string {
  try {
    const result = execFileSync("git", ["show", ref], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
    return result;
  } catch (e: any) {
    console.error(`error: could not read ${ref}: ${(e.stderr || "").toString().trim()}`);
    process.exit(1);
  }
}

function _v8Available(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", "origin/v8"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function auditCoverage(platform: Platform): string[] {
  if (platform.bucket !== "split") return [];

  const problems: string[] = [];
  const baselineHeadings = headings(_gitShow(_v8BaselineRef(platform.key)));
  const allowlist = _auditAllowlist(platform.key);

  const artifacts = render(platform);
  const byPath: Record<string, string> = {};
  for (const a of artifacts) byPath[a.path] = a.content;
  const coreHeadings = new Set(headings(byPath[platform.skill_dst]));

  const refHeadings: Record<string, Set<string>> = {};
  for (const name of Object.keys(platformReferenceSources(platform))) {
    const rel = `${platform.refs_dst}/${name}.md`;
    refHeadings[name] = new Set(headings(byPath[rel]));
  }

  for (const h of baselineHeadings) {
    if (allowlist.has(h)) continue;
    const homes: string[] = [];
    if (coreHeadings.has(h)) homes.push("core");
    for (const [name, hs] of Object.entries(refHeadings)) {
      if (hs.has(h)) homes.push(`references/${name}.md`);
    }
    if (homes.length === 0) {
      problems.push(`v8 heading not covered anywhere: ${JSON.stringify(h)}`);
    } else if (homes.length > 1) {
      problems.push(`v8 heading double-homed in ${homes}: ${JSON.stringify(h)}`);
    }
  }
  return problems;
}

function _enumLines(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.includes(ENUM_VALUES) || line.includes(ENUM_PROSE));
}

const _LEGACY_ENUMS = [
  "code|document|paper|image|rationale", // 5-value
  "code|document|paper|image", // 4-value
];

export function legacyEnumLines(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    if (line.includes(ENUM_VALUES)) continue;
    if (_LEGACY_ENUMS.some((bad) => line.includes(bad))) {
      out.push(line.trim());
    }
  }
  return out;
}

export function schemaSingleton(platforms: Record<string, Platform>): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(platforms).sort()) {
    for (const art of render(platforms[key])) {
      for (const stripped of legacyEnumLines(art.content)) {
        problems.push(
          `[${key}] ${art.path}: legacy file_type enum (not the six-value superset): ${JSON.stringify(stripped)}`
        );
      }
    }
  }
  return problems;
}

function _isEnumLine(line: string): boolean {
  return line.includes(ENUM_VALUES) || line.includes(ENUM_PROSE);
}

function _isFrontmatterDescriptionLine(line: string): boolean {
  return line.trimStart().startsWith("description:");
}

function _isChunkCleanupLine(line: string): boolean {
  return (
    line.trimStart().startsWith("rm -f") &&
    line.includes("find ") &&
    line.includes("-name '.graphify_chunk_")
  );
}

function _isTriggerLine(line: string): boolean {
  return line.trim().startsWith("trigger:");
}

export function monolithRoundtrip(platform: Platform): string[] {
  if (platform.bucket !== "monolith") return [];
  if (platform.roundtrip_ref === null) {
    return [`[${platform.key}] monolith is missing roundtrip_ref`];
  }

  const rendered = render(platform)[0].content;
  const original = _normalise(_gitShow(platform.roundtrip_ref));

  const renderedLines = rendered.split("\n");
  const originalLines = original.split("\n").filter((l) => !_isTriggerLine(l));

  const problems: string[] = [];
  if (renderedLines.length !== originalLines.length) {
    problems.push(
      `[${platform.key}] line count differs: rendered ${renderedLines.length} vs v8 ${originalLines.length} ` +
        "(the only allowed changes are the enum line(s), the description line, " +
        "the chunk-cleanup rewrite, and trigger: removal -- none must add or remove other lines)"
    );
    return problems;
  }

  for (let i = 0; i < renderedLines.length; i++) {
    const r = renderedLines[i];
    const o = originalLines[i];
    if (r === o) continue;
    if (_isEnumLine(r) || _isFrontmatterDescriptionLine(r) || _isChunkCleanupLine(r)) continue;
    problems.push(
      `[${platform.key}] line ${i + 1} differs and is not an enum or description unification:\n` +
        `    v8:       ${JSON.stringify(o)}\n` +
        `    rendered: ${JSON.stringify(r)}`
    );
  }
  return problems;
}

function _alwaysOnConstants(ref: string): Record<string, string> {
  const src = _gitShow(ref);
  const wanted = new Set(Object.values(ALWAYS_ON_BLOCKS));
  const out: Record<string, string> = {};

  // Parse Python triple-quoted string constants from __main__.py using regex.
  // We need to extract assignments like _CLAUDE_MD_SECTION = """..."""
  // and _CLAUDE_MD_SECTION = '...' or "..."
  const tripleQuotePattern =
    /^(\w+)\s*=\s*"""((?:[^"\\]|\\[\s\S]|"(?!"")|""(?!"))*?)"""/my;
  // Also handle single-quoted triple strings
  const tripleSinglePattern =
    /^(\w+)\s*=\s*'''((?:[^'\\]|\\[\s\S]|'(?!'')|''(?!'))*?)'''/my;

  for (const pat of [tripleQuotePattern, tripleSinglePattern]) {
    let match;
    while ((match = pat.exec(src)) !== null) {
      const name = match[1];
      if (wanted.has(name)) {
        out[name] = match[2];
      }
    }
  }

  return out;
}

export function alwaysOnRoundtrip(): string[] {
  const baseline = _alwaysOnConstants(ALWAYS_ON_BASELINE_REF);
  const problems: string[] = [];
  const rendered: Record<string, string> = {};
  for (const a of renderAlwaysOn()) rendered[a.path] = a.content;

  for (const [basename, constName] of Object.entries(ALWAYS_ON_BLOCKS).sort(
    ([a], [b]) => a.localeCompare(b)
  )) {
    const filePath = `graphify/always_on/${basename}.md`;
    if (!(constName in baseline)) {
      problems.push(`could not find constant ${constName} in ${ALWAYS_ON_BASELINE_REF}`);
      continue;
    }
    if (rendered[filePath] !== baseline[constName]) {
      problems.push(
        `always_on/${basename}.md does not reproduce ${constName} byte for byte ` +
          `(rendered ${rendered[filePath].length} chars vs baseline ${baseline[constName].length} chars)`
      );
    }
  }
  return problems;
}

// --- CLI ---

function parseArgs(argv: string[]): Record<string, any> {
  const args: Record<string, any> = {
    platform: undefined,
    check: false,
    audit_coverage: false,
    schema_singleton: false,
    monolith_roundtrip: false,
    always_on_roundtrip: false,
    bless: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--platform" && i + 1 < argv.length) {
      args.platform = argv[++i];
    } else if (arg === "--check") {
      args.check = true;
    } else if (arg === "--audit-coverage") {
      args.audit_coverage = true;
    } else if (arg === "--schema-singleton") {
      args.schema_singleton = true;
    } else if (arg === "--monolith-roundtrip") {
      args.monolith_roundtrip = true;
    } else if (arg === "--always-on-roundtrip") {
      args.always_on_roundtrip = true;
    } else if (arg === "--bless") {
      args.bless = true;
    }
  }
  return args;
}

export function main(argv?: string[]): number {
  const args = parseArgs(argv ?? process.argv.slice(2));
  const platforms = loadPlatforms();

  const gitShowValidators = [
    args.audit_coverage,
    args.monolith_roundtrip,
    args.always_on_roundtrip,
  ];
  if (gitShowValidators.some(Boolean) && !_v8Available()) {
    console.error(
      "SKIPPED: origin/v8 is not fetchable in this checkout, so the git-show " +
        "validators cannot run. On CI, set fetch-depth: 0 on this job (actions/" +
        "checkout) so origin/v8 is fetched and the validators run for real."
    );
    return 0;
  }

  if (args.audit_coverage) {
    const keys = args.platform ? [args.platform] : Object.keys(platforms).sort();
    const allProblems: string[] = [];
    for (const key of keys) {
      if (!(key in platforms)) {
        console.error(`error: unknown platform '${key}'`);
        process.exit(1);
      }
      for (const m of auditCoverage(platforms[key])) {
        allProblems.push(`[${key}] ${m}`);
      }
    }
    if (allProblems.length > 0) {
      console.error("audit-coverage FAILED:");
      for (const m of allProblems) console.error(`  ${m}`);
      return 1;
    }
    console.log("audit-coverage OK: every per-host v8 heading single-homes in that host's render.");
    return 0;
  }

  if (args.schema_singleton) {
    const p = args.platform
      ? { [args.platform]: platforms[args.platform] }
      : platforms;
    const problems = schemaSingleton(p);
    if (problems.length > 0) {
      console.error("schema-singleton FAILED (file_type enum drift):");
      for (const m of problems) console.error(`  ${m}`);
      return 1;
    }
    console.log("schema-singleton OK: the file_type enum is the six-value superset everywhere.");
    return 0;
  }

  if (args.monolith_roundtrip) {
    const keys = args.platform ? [args.platform] : Object.keys(platforms).sort();
    const allProblems: string[] = [];
    for (const key of keys) {
      allProblems.push(...monolithRoundtrip(platforms[key]));
    }
    if (allProblems.length > 0) {
      console.error("monolith-roundtrip FAILED:");
      for (const m of allProblems) console.error(`  ${m}`);
      return 1;
    }
    console.log("monolith-roundtrip OK: each monolith matches v8 modulo the enum unification.");
    return 0;
  }

  if (args.always_on_roundtrip) {
    const problems = alwaysOnRoundtrip();
    if (problems.length > 0) {
      console.error("always-on-roundtrip FAILED:");
      for (const m of problems) console.error(`  ${m}`);
      return 1;
    }
    console.log("always-on-roundtrip OK: each always_on/*.md reproduces its former constant byte for byte.");
    return 0;
  }

  const artifacts = renderAll(platforms, args.platform);

  if (args.check) {
    const problems = check(artifacts);
    if (problems.length > 0) {
      console.error("check FAILED (skill artifacts have drifted):");
      for (const m of problems) console.error(`  ${m}`);
      return 1;
    }
    console.log(`check OK: ${artifacts.length} artifact(s) match committed output and expected/.`);
    return 0;
  }

  if (args.bless) {
    const written = bless(artifacts);
    console.log(`blessed ${written.length} artifact(s) into expected/.`);
    return 0;
  }

  const written = writeArtifacts(artifacts);
  console.log(`rendered ${written.length} artifact(s):`);
  for (const p of written) console.log(`  ${p}`);
  return 0;
}

// Run when executed directly.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === __filename
) {
  process.exit(main());
}
