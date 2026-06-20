// file discovery, type classification, and corpus health checks
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import AdmZip from "adm-zip";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import ExcelJS from "exceljs";

import { FileType } from "./types/language.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANIFEST_PATH = "graphify-out/manifest.json";

export const CODE_EXTENSIONS: Set<string> = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".ejs", ".ets", ".go", ".rs",
  ".java", ".groovy", ".gradle", ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp",
  ".rb", ".swift", ".kt", ".kts", ".cs", ".scala", ".php", ".lua", ".luau",
  ".toc", ".zig", ".ps1", ".psm1", ".psd1", ".ex", ".exs", ".m", ".mm",
  ".jl", ".vue", ".svelte", ".astro", ".dart", ".v", ".sv", ".svh", ".sql",
  ".r", ".f", ".F", ".f90", ".F90", ".f95", ".F95", ".f03", ".F03", ".f08",
  ".F08", ".pas", ".pp", ".dpr", ".dpk", ".lpr", ".inc", ".dfm", ".lfm",
  ".lpk", ".sh", ".bash", ".json", ".tf", ".tfvars", ".hcl", ".dm", ".dme",
  ".dmi", ".dmm", ".dmf", ".sln", ".slnx", ".csproj", ".fsproj", ".vbproj",
  ".razor", ".cshtml", ".cls", ".trigger",
]);

export const DOC_EXTENSIONS: Set<string> = new Set([
  ".md", ".mdx", ".qmd", ".txt", ".rst", ".html", ".yaml", ".yml",
]);

export const PAPER_EXTENSIONS: Set<string> = new Set([".pdf"]);

export const IMAGE_EXTENSIONS: Set<string> = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
]);

export const OFFICE_EXTENSIONS: Set<string> = new Set([".docx", ".xlsx"]);

export const VIDEO_EXTENSIONS: Set<string> = new Set([
  ".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".mp3", ".wav", ".m4a", ".ogg",
]);

// Google Workspace extensions — empty for now; module migrated in Phase 4
export const GOOGLE_WORKSPACE_EXTENSIONS: Set<string> = new Set();

export const CORPUS_WARN_THRESHOLD = 50_000;
export const CORPUS_UPPER_THRESHOLD = 500_000;
export const FILE_COUNT_UPPER = 500;

const OFFICE_MAX_RAW_BYTES = 50 * 1024 * 1024;
const OFFICE_MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
const OFFICE_MAX_COMPRESSION_RATIO = 200;

// ---------------------------------------------------------------------------
// Resource-cap helpers
// ---------------------------------------------------------------------------

export function fileWithinSizeCap(filePath: string, cap: number = OFFICE_MAX_RAW_BYTES): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.size <= cap;
  } catch {
    return false;
  }
}

export function zipWithinCaps(filePath: string): boolean {
  if (!fileWithinSizeCap(filePath)) {
    return false;
  }
  try {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    const compressed = entries.reduce((s, e) => s + (e.header.size || 0), 0) || 1;
    const declared = entries.reduce((s, e) => s + (e.header.compressedSize || 0), 0);
    if (declared > OFFICE_MAX_DECOMPRESSED_BYTES) {
      return false;
    }
    if (declared / compressed > OFFICE_MAX_COMPRESSION_RATIO) {
      return false;
    }
    // Second pass: extract each entry and count total bytes
    let total = 0;
    for (const entry of entries) {
      const data = entry.getData();
      total += data.length;
      if (total > OFFICE_MAX_DECOMPRESSED_BYTES) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sensitive-file detection
// ---------------------------------------------------------------------------

const SENSITIVE_DIRS: Set<string> = new Set([
  ".ssh", ".gnupg", ".aws", ".gcloud", "secrets", ".secrets", "credentials",
]);

const SENSITIVE_PATTERNS: RegExp[] = [
  /(^|[\\\/])\.(env|envrc)(\.|$)/i,
  /\.(pem|key|p12|pfx|cert|crt|der|p8)$/i,
  /(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/,
  /(\.netrc|\.pgpass|\.htpasswd)$/i,
  /(aws_credentials|gcloud_credentials|service\.account)/i,
];

const GENERIC_KEYWORD_PATTERNS: RegExp[] = [
  /(?<![a-zA-Z0-9])(credential|secret|passwd|password|private_key)s?(?![a-zA-Z])/i,
  /(?<![a-zA-Z0-9])tokens?(?![a-zA-Z])/i,
];

const WORD_SPLIT_RE = /[-_\s]+/;

export function genericKeywordHit(name: string): boolean {
  const stem = name.replace(/^\.+/, "").split(".")[0];
  for (const pat of GENERIC_KEYWORD_PATTERNS) {
    let hit = false;
    let m: RegExpExecArray | null;
    // Create a new RegExp with 'g' flag to iterate matches
    const re = new RegExp(pat.source, pat.flags + "g");
    while ((m = re.exec(stem)) !== null) {
      hit = true;
      if (m.index + m[0].length === stem.length) {
        return true;
      }
    }
    if (hit && stem.split(WORD_SPLIT_RE).filter((w: string) => w).length <= 2) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Paper detection
// ---------------------------------------------------------------------------

const PAPER_SIGNALS: RegExp[] = [
  /\barxiv\b/i,
  /\bdoi\s*:/,
  /\babstract\b/i,
  /\bproceedings\b/i,
  /\bjournal\b/i,
  /\bpreprint\b/i,
  /\\cite\{/,
  /\[\d+\]/,
  /\[\n\d+\n\]/,
  /eq\.\s*\d+|equation\s+\d+/i,
  /\d{4}\.\d{4,5}/,
  /\bwe propose\b/i,
  /\bliterature\b/i,
];
const PAPER_SIGNAL_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Xcode asset markers
// ---------------------------------------------------------------------------

const ASSET_DIR_MARKERS: Set<string> = new Set([
  ".imageset", ".xcassets", ".appiconset", ".colorset", ".launchimage",
]);

// ---------------------------------------------------------------------------
// Shebang interpreter resolution
// ---------------------------------------------------------------------------

const SHEBANG_CODE_INTERPRETERS: Set<string> = new Set([
  "python", "python3", "python2",
  "ruby", "perl", "node", "nodejs",
  "bash", "sh", "dash", "zsh", "fish", "ksh", "tcsh",
  "lua", "php", "julia", "Rscript",
]);

/**
 * Minimal shlex-like split for shebang lines — handles single/double
 * quoted substrings and backslash escapes.
 */
function shlexSplit(s: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'") {
      i++;
      while (i < s.length && s[i] !== "'") {
        current += s[i++];
      }
      i++; // skip closing quote
    } else if (ch === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) {
          i++;
          current += s[i++];
        } else {
          current += s[i++];
        }
      }
      i++; // skip closing quote
    } else if (ch === "\\") {
      if (i + 1 < s.length) {
        i++;
        current += s[i++];
      } else {
        i++;
      }
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

export function splitEnvS(value: string, rest: string[]): string[] {
  const packed = [value, ...rest].join(" ").trim();
  return shlexSplit(packed);
}

export function envCommandArgs(args: string[], allowSplit: boolean = true): string[] {
  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--") {
      return args.slice(i + 1);
    }

    if (allowSplit) {
      if (arg === "-S") {
        if (i + 1 >= args.length) return [];
        return envCommandArgs(
          splitEnvS(args.slice(i + 1).join(" "), []),
          false,
        );
      }
      if (arg.startsWith("-S") && arg.length > 2) {
        return envCommandArgs(splitEnvS(arg.slice(2), args.slice(i + 1)), false);
      }
      if (arg === "-vS") {
        if (i + 1 >= args.length) return [];
        return envCommandArgs(
          splitEnvS(args.slice(i + 1).join(" "), []),
          false,
        );
      }
      if (arg.startsWith("-vS") && arg.length > 3) {
        return envCommandArgs(splitEnvS(arg.slice(3), args.slice(i + 1)), false);
      }
      if (arg.startsWith("--split-string=")) {
        return envCommandArgs(
          splitEnvS(arg.split("=").slice(1).join("="), args.slice(i + 1)),
          false,
        );
      }
      if (arg === "--split-string") {
        if (i + 1 >= args.length) return [];
        return envCommandArgs(splitEnvS(args[i + 1], args.slice(i + 2)), false);
      }
    }

    if (["-u", "-C", "-P", "-a", "--unset", "--chdir", "--argv0"].includes(arg)) {
      if (i + 2 > args.length) return [];
      i += 2;
      continue;
    }

    if (
      (arg.startsWith("-u") || arg.startsWith("-C") ||
        arg.startsWith("-P") || arg.startsWith("-a")) &&
      arg.length > 2 && !arg.startsWith("--")
    ) {
      i += 1;
      continue;
    }

    if (
      arg.startsWith("--unset=") || arg.startsWith("--chdir=") ||
      arg.startsWith("--argv0=")
    ) {
      i += 1;
      continue;
    }

    if (["-", "-i", "-0", "-v", "--ignore-environment", "--null",
      "--debug", "--list-signal-handling"].includes(arg)) {
      i += 1;
      continue;
    }

    if (
      arg.startsWith("--default-signal") ||
      arg.startsWith("--ignore-signal") ||
      arg.startsWith("--block-signal")
    ) {
      i += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      return [];
    }

    if (arg.includes("=")) {
      i += 1;
      continue;
    }

    return args.slice(i);
  }

  return [];
}

export function shebangInterpreter(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(256);
    const bytesRead = fs.readSync(fd, buf, 0, 256, 0);
    fs.closeSync(fd);
    const first = buf.slice(0, bytesRead);
    const shebang = Buffer.from("#!");
    if (first[0] !== shebang[0] || first[1] !== shebang[1]) {
      return null;
    }
    const newlineIdx = first.indexOf(0x0a);
    const lineBytes = first.slice(2, newlineIdx >= 0 ? newlineIdx : bytesRead);
    const line = lineBytes.toString("utf-8").trim();
    const parts = shlexSplit(line);
    if (parts.length === 0) {
      return null;
    }
    let interp = path.basename(parts[0]);
    if (interp === "env") {
      const envArgs = envCommandArgs(parts.slice(1));
      if (envArgs.length === 0) {
        return null;
      }
      interp = path.basename(envArgs[0]);
    }
    return interp;
  } catch {
    return null;
  }
}

export function shebangFileType(filePath: string): FileType | null {
  const interp = shebangInterpreter(filePath);
  if (interp && SHEBANG_CODE_INTERPRETERS.has(interp)) {
    return FileType.Code;
  }
  return null;
}

// ---------------------------------------------------------------------------
// classifyFile
// ---------------------------------------------------------------------------

export function classifyFile(filePath: string): FileType | null {
  if (path.basename(filePath).toLowerCase().endsWith(".blade.php")) {
    return FileType.Code;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) {
    return shebangFileType(filePath);
  }
  if (CODE_EXTENSIONS.has(ext)) {
    return FileType.Code;
  }
  if (PAPER_EXTENSIONS.has(ext)) {
    const parts = filePath.split(/[/\\]/);
    if (parts.some((p) => [...ASSET_DIR_MARKERS].some((m) => p.endsWith(m)))) {
      return null;
    }
    return FileType.Paper;
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return FileType.Image;
  }
  if (DOC_EXTENSIONS.has(ext)) {
    if (looksLikePaper(filePath)) {
      return FileType.Paper;
    }
    return FileType.Document;
  }
  if (OFFICE_EXTENSIONS.has(ext)) {
    return FileType.Document;
  }
  if (GOOGLE_WORKSPACE_EXTENSIONS.has(ext)) {
    return FileType.Document;
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return FileType.Video;
  }
  return null;
}

// ---------------------------------------------------------------------------
// isSensitive
// ---------------------------------------------------------------------------

export function isSensitive(filePath: string): boolean {
  const parts = filePath.split(/[/\\]/);
  const parentParts = parts.slice(0, -1);
  if (parentParts.some((p) => SENSITIVE_DIRS.has(p))) {
    return true;
  }
  const name = path.basename(filePath);
  if (SENSITIVE_PATTERNS.some((p) => p.test(name))) {
    return true;
  }
  return genericKeywordHit(name);
}

// ---------------------------------------------------------------------------
// looksLikePaper
// ---------------------------------------------------------------------------

export function looksLikePaper(filePath: string): boolean {
  try {
    const text = fs.readFileSync(filePath, "utf-8").slice(0, 3000);
    const hits = PAPER_SIGNALS.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
    return hits >= PAPER_SIGNAL_THRESHOLD;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PDF text extraction
// ---------------------------------------------------------------------------

export function extractPdfText(filePath: string): string {
  // Sync stub — PDF extraction is async; returns empty for sync callers
  return "";
}

/**
 * Async version of extractPdfText — uses pdf-parse v2 PDFParse class.
 */
export async function extractPdfTextAsync(filePath: string): Promise<string> {
  if (!fileWithinSizeCap(filePath)) {
    return "";
  }
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
    const result = await parser.getText();
    return result.text ?? "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// docx → markdown
// ---------------------------------------------------------------------------

export async function docxToMarkdown(filePath: string): Promise<string> {
  if (!zipWithinCaps(filePath)) {
    return "";
  }
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// xlsx → markdown
// ---------------------------------------------------------------------------

export async function xlsxToMarkdown(filePath: string): Promise<string> {
  if (!zipWithinCaps(filePath)) {
    return "";
  }
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const sections: string[] = [];
    for (const ws of wb.worksheets) {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: true }, (row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(cell.value != null ? String(cell.value) : "");
        });
        if (!cells.every((c) => c === "")) {
          rows.push(cells);
        }
      });
      if (rows.length === 0) continue;
      sections.push(`## Sheet: ${ws.name}`);
      if (rows.length >= 1) {
        const header = "| " + rows[0].join(" | ") + " |";
        const sep = "| " + rows[0].map(() => "---").join(" | ") + " |";
        sections.push(header, sep);
        for (const row of rows.slice(1)) {
          sections.push("| " + row.join(" | ") + " |");
        }
      }
    }
    return sections.join("\n");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// xlsxExtractStructure
// ---------------------------------------------------------------------------

export function xlsxExtractStructure(_filePath: string): {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
} {
  // TODO: implement with exceljs when needed
  return { nodes: [], edges: [] };
}

// ---------------------------------------------------------------------------
// convertOfficeFile
// ---------------------------------------------------------------------------

export async function convertOfficeFile(
  filePath: string,
  outDir: string,
): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();
  let text: string;
  if (ext === ".docx") {
    text = await docxToMarkdown(filePath);
  } else if (ext === ".xlsx") {
    text = await xlsxToMarkdown(filePath);
  } else {
    return null;
  }

  if (!text.trim()) {
    return null;
  }

  fs.mkdirSync(outDir, { recursive: true });
  // NFC-normalize path for stable hashing (mirrors Python unicodedata.normalize)
  const normalizedPath = filePath.normalize("NFC");
  const nameHash = createHash("sha256").update(normalizedPath).digest("hex").slice(0, 8);
  const stem = path.basename(filePath, path.extname(filePath));
  const outPath = path.join(outDir, `${stem}_${nameHash}.md`);

  if (fs.existsSync(outPath)) {
    return outPath;
  }

  fs.writeFileSync(outPath, `<!-- converted from ${path.basename(filePath)} -->\n\n${text}`, "utf-8");
  return outPath;
}

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------

export function countWords(filePath: string): number {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".pdf" || ext === ".docx" || ext === ".xlsx") {
      // PDF/Office extraction is async; return 0 for sync callers
      return 0;
    }
    const text = fs.readFileSync(filePath, "utf-8");
    return text.split(/\s+/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Noise directory / file detection
// ---------------------------------------------------------------------------

const SKIP_DIRS: Set<string> = new Set([
  "venv", ".venv", "env", ".env",
  "node_modules", "__pycache__", ".git",
  "dist", "build", "target", "out",
  "site-packages", "lib64",
  ".pytest_cache", ".mypy_cache", ".ruff_cache",
  ".tox", ".eggs", "*.egg-info",
  "graphify-out",
  "coverage", "lcov-report",
  "visual-tests", "visual-test",
  "__snapshots__", "snapshots",
  "storybook-static",
  "dist-protected",
  ".next", ".nuxt", ".turbo", ".angular",
  ".idea", ".cache", ".parcel-cache", ".svelte-kit", ".terraform", ".serverless",
  ".graphify",
  ".worktrees",
]);

const SKIP_FILES: Set<string> = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "Cargo.lock", "poetry.lock", "Gemfile.lock",
  "composer.lock", "go.sum", "go.work.sum",
]);

export function isNoiseDir(part: string, parent?: string): boolean {
  if (SKIP_DIRS.has(part)) {
    return true;
  }
  if (part.endsWith("_venv") || part.endsWith("_env")) {
    return true;
  }
  if (part.endsWith(".egg-info")) {
    return true;
  }
  if (part === "worktrees" && parent !== undefined) {
    const parentName = path.basename(parent);
    if (parentName.startsWith(".")) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Gitignore-style pattern matching
// ---------------------------------------------------------------------------

const VCS_MARKERS = [".git", ".hg", ".svn", "_darcs", ".fossil"];

export function parseGitignoreLine(raw: string): string {
  let line = raw.replace(/[\n\r]+$/, "");
  line = line.replace(/^\s+/, "");
  if (!line || line.startsWith("#")) {
    return "";
  }
  line = line.replace(/\s+#+[^\\].*$/, "");
  line = line.replace(/\\#/g, "#");
  line = line.replace(/(?<!\\) +$/, "");
  return line;
}

export function findVcsRoot(start: string): string | null {
  let current = path.resolve(start);
  const home = process.env.HOME || process.env.USERPROFILE || "";
  while (true) {
    if (VCS_MARKERS.some((m) => fs.existsSync(path.join(current, m)))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current || current === home) {
      return null;
    }
    current = parent;
  }
}

export type IgnorePattern = [string, string]; // [anchorDir, pattern]

export function loadGraphifyignore(root: string): IgnorePattern[] {
  const resolvedRoot = path.resolve(root);
  const ceiling = findVcsRoot(resolvedRoot) || resolvedRoot;

  const dirs: string[] = [];
  let current = resolvedRoot;
  while (true) {
    dirs.push(current);
    if (current === ceiling) break;
    current = path.dirname(current);
  }
  dirs.reverse();

  const patterns: IgnorePattern[] = [];
  for (const d of dirs) {
    for (const fname of [".gitignore", ".graphifyignore"]) {
      const ignoreFile = path.join(d, fname);
      if (fs.existsSync(ignoreFile)) {
        const lines = fs.readFileSync(ignoreFile, "utf-8").split(/\r?\n/);
        for (const raw of lines) {
          const line = parseGitignoreLine(raw);
          if (line) {
            patterns.push([d, line]);
          }
        }
      }
    }
  }
  return patterns;
}

/**
 * Minimal fnmatch-like glob match supporting * and ? wildcards.
 */
function fnmatch(name: string, pattern: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${re}$`).test(name);
}

export function isIgnored(
  filePath: string,
  root: string,
  patterns: IgnorePattern[],
  cache?: Map<string, boolean>,
): boolean {
  if (patterns.length === 0) return false;

  function evalTarget(target: string): boolean {
    if (cache && cache.has(target)) return cache.get(target)!;

    function matches(rel: string, p: string, anchored: boolean): boolean {
      if (anchored) {
        return fnmatch(rel, p);
      }
      const parts = rel.split("/");
      if (fnmatch(rel, p)) return true;
      if (fnmatch(path.basename(target), p)) return true;
      for (let i = 0; i < parts.length; i++) {
        if (fnmatch(parts[i], p)) return true;
        if (fnmatch(parts.slice(0, i + 1).join("/"), p)) return true;
      }
      return false;
    }

    let result = false;
    for (const [anchor, pattern] of patterns) {
      const negated = pattern.startsWith("!");
      const raw = negated ? pattern.slice(1) : pattern;
      const anchored = raw.startsWith("/");
      const p = raw.replace(/^\/+|\/+$/g, "");
      if (!p) continue;

      let matched = false;
      if (anchored) {
        try {
          const relAnchor = path.relative(anchor, target).split(path.sep).join("/");
          matched = matches(relAnchor, p, true);
        } catch { /* different drives on Windows */ }
      } else {
        try {
          const rel = path.relative(root, target).split(path.sep).join("/");
          matched = matches(rel, p, false);
        } catch { /* ignore */ }
        if (!matched && anchor !== root) {
          try {
            const relAnchor = path.relative(anchor, target).split(path.sep).join("/");
            matched = matches(relAnchor, p, false);
          } catch { /* ignore */ }
        }
      }

      if (matched) {
        result = !negated;
      }
    }
    if (cache) cache.set(target, result);
    return result;
  }

  // Gitignore parent-exclusion rule
  let relParts: string[];
  try {
    relParts = path.relative(root, filePath).split(path.sep);
  } catch {
    return evalTarget(filePath);
  }

  let ancestor = root;
  for (let i = 0; i < relParts.length - 1; i++) {
    ancestor = path.join(ancestor, relParts[i]);
    if (evalTarget(ancestor)) {
      return true;
    }
  }
  return evalTarget(filePath);
}

// ---------------------------------------------------------------------------
// .graphifyinclude
// ---------------------------------------------------------------------------

export function loadGraphifyinclude(root: string): IgnorePattern[] {
  const resolvedRoot = path.resolve(root);
  const ceiling = findVcsRoot(resolvedRoot) || resolvedRoot;

  const dirs: string[] = [];
  let current = resolvedRoot;
  while (true) {
    dirs.push(current);
    if (current === ceiling) break;
    current = path.dirname(current);
  }
  dirs.reverse();

  const patterns: IgnorePattern[] = [];
  for (const d of dirs) {
    const includeFile = path.join(d, ".graphifyinclude");
    if (fs.existsSync(includeFile)) {
      const lines = fs.readFileSync(includeFile, "utf-8").split(/\r?\n/);
      for (const raw of lines) {
        const line = parseGitignoreLine(raw);
        if (line) {
          patterns.push([d, line]);
        }
      }
    }
  }
  return patterns;
}

export function isIncluded(filePath: string, root: string, patterns: IgnorePattern[]): boolean {
  if (patterns.length === 0) return false;

  function matches(rel: string, p: string, anchored: boolean): boolean {
    if (anchored) {
      return fnmatch(rel, p);
    }
    const parts = rel.split("/");
    if (fnmatch(rel, p)) return true;
    if (fnmatch(path.basename(filePath), p)) return true;
    for (let i = 0; i < parts.length; i++) {
      if (fnmatch(parts[i], p)) return true;
      if (fnmatch(parts.slice(0, i + 1).join("/"), p)) return true;
    }
    return false;
  }

  for (const [anchor, pattern] of patterns) {
    const anchored = pattern.startsWith("/");
    const p = pattern.replace(/^\/+|\/+$/g, "");
    if (!p) continue;
    if (anchored) {
      try {
        const relAnchor = path.relative(anchor, filePath).split(path.sep).join("/");
        if (matches(relAnchor, p, true)) return true;
      } catch { /* ignore */ }
    } else {
      try {
        const rel = path.relative(root, filePath).split(path.sep).join("/");
        if (matches(rel, p, false)) return true;
      } catch { /* ignore */ }
      if (anchor !== root) {
        try {
          const relAnchor = path.relative(anchor, filePath).split(path.sep).join("/");
          if (matches(relAnchor, p, false)) return true;
        } catch { /* ignore */ }
      }
    }
  }
  return false;
}

export function couldContainIncludedPath(filePath: string, root: string, patterns: IgnorePattern[]): boolean {
  if (patterns.length === 0) return false;

  const rels: string[] = [];
  try {
    rels.push(path.relative(root, filePath).split(path.sep).join("/"));
  } catch { /* ignore */ }
  for (const [anchor] of patterns) {
    if (anchor !== root) {
      try {
        rels.push(path.relative(anchor, filePath).split(path.sep).join("/"));
      } catch { /* ignore */ }
    }
  }

  for (const rel of rels) {
    const trimmed = rel.replace(/^\/+|\/+$/g, "");
    if (!trimmed) return true;
    for (const [, pattern] of patterns) {
      const p = pattern.replace(/^\/+|\/+$/g, "");
      if (!p) continue;
      if (p === trimmed || p.startsWith(trimmed + "/")) return true;
      if (fnmatch(trimmed, p)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Symlink detection
// ---------------------------------------------------------------------------

export function autoFollowSymlinks(root: string): boolean {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries.some((e) => e.isSymbolicLink());
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Recursive directory walk (replaces os.walk)
// ---------------------------------------------------------------------------

interface WalkResult {
  dirpath: string;
  dirnames: string[];
  filenames: string[];
}

function* walkDir(
  root: string,
  followLinks: boolean = false,
): Generator<WalkResult> {
  // BFS approach mimicking Python os.walk(topdown=True):
  // yield BEFORE enqueuing subdirs so the caller can modify dirnames in-place
  // to prevent descent into pruned directories.
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dirpath = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirpath, { withFileTypes: true });
    } catch {
      continue;
    }
    const dirnames: string[] = [];
    const filenames: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dirpath, entry.name);
      const isDir = entry.isDirectory() ||
        (followLinks && entry.isSymbolicLink() && isDirectorySync(fullPath));
      if (isDir) {
        dirnames.push(entry.name);
      } else if (entry.isFile() || (followLinks && entry.isSymbolicLink())) {
        filenames.push(entry.name);
      }
    }
    // Yield first — caller may splice dirnames to prune subdirs
    yield { dirpath, dirnames, filenames };
    // Only enqueue subdirs that remain in dirnames after yield
    for (const d of dirnames) {
      queue.push(path.join(dirpath, d));
    }
  }
}

function isDirectorySync(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// detect
// ---------------------------------------------------------------------------

export interface DetectResult {
  files: Record<string, string[]>;
  total_files: number;
  total_words: number;
  needs_graph: boolean;
  warning: string | null;
  skipped_sensitive: string[];
  graphifyignore_patterns: number;
  scan_root: string;
  incremental?: boolean;
  new_files?: Record<string, string[]>;
  unchanged_files?: Record<string, string[]>;
  new_total?: number;
  deleted_files?: string[];
}

export function detect(
  root: string,
  opts?: {
    followSymlinks?: boolean | null;
    googleWorkspace?: boolean | null;
    extraExcludes?: string[] | null;
  },
): DetectResult {
  const resolvedRoot = path.resolve(root);
  const followSymlinks = opts?.followSymlinks ?? autoFollowSymlinks(resolvedRoot);
  const googleWorkspace = opts?.googleWorkspace ?? false;

  const files: Record<string, string[]> = {
    [FileType.Code]: [],
    [FileType.Document]: [],
    [FileType.Paper]: [],
    [FileType.Image]: [],
    [FileType.Video]: [],
  };
  let totalWords = 0;

  const skippedSensitive: string[] = [];
  const ignorePatterns = loadGraphifyignore(resolvedRoot);
  const ignoreCache = new Map<string, boolean>();
  const extraExcludes = opts?.extraExcludes ?? [];
  if (extraExcludes) {
    for (const pat of extraExcludes) {
      const line = parseGitignoreLine(pat);
      if (line) {
        ignorePatterns.push([resolvedRoot, line]);
      }
    }
  }
  const includePatterns = loadGraphifyinclude(resolvedRoot);

  const memoryDir = path.join(resolvedRoot, "graphify-out", "memory");
  const scanPaths = [resolvedRoot];
  if (fs.existsSync(memoryDir)) {
    scanPaths.push(memoryDir);
  }

  const seen = new Set<string>();
  const allFiles: string[] = [];

  for (const scanRoot of scanPaths) {
    const inMemoryTree = fs.existsSync(memoryDir) && scanRoot.startsWith(memoryDir);
    for (const { dirpath, dirnames, filenames } of walkDir(scanRoot, followSymlinks)) {
      // Circular symlink protection
      if (followSymlinks) {
        try {
          const real = fs.realpathSync(dirpath);
          const parentReal = fs.realpathSync(path.dirname(dirpath));
          if (parentReal === real || parentReal.startsWith(real + path.sep)) {
            dirnames.length = 0;
            continue;
          }
        } catch { /* ignore */ }
      }

      const dp = dirpath;
      if (!inMemoryTree) {
        // Prune noise dirs in-place so walkDir never descends into them.
        // Dot dirs are allowed — users often want .github/, .claude/, etc.
        // Framework caches (.next, .nuxt, …) are caught by isNoiseDir.
        // Negations need no special-casing here: isIgnored already applies
        // last-match-wins semantics.
        dirnames.splice(0, dirnames.length,
          ...dirnames.filter((d) => {
            const childPath = path.join(dp, d);
            return !isNoiseDir(d, dp) && !isIgnored(childPath, resolvedRoot, ignorePatterns, ignoreCache);
          }),
        );
      }

      for (const fname of filenames) {
        if (SKIP_FILES.has(fname)) continue;
        const p = path.join(dp, fname);
        if (!seen.has(p)) {
          seen.add(p);
          allFiles.push(p);
        }
      }
    }
  }

  allFiles.sort();

  const convertedDir = path.join(resolvedRoot, "graphify-out", "converted");

  for (const p of allFiles) {
    const inMemory = fs.existsSync(memoryDir) && p.startsWith(memoryDir);
    if (!inMemory) {
      if (p.startsWith(convertedDir)) continue;
    }
    if (!inMemory && isIgnored(p, resolvedRoot, ignorePatterns, ignoreCache)) continue;
    if (isSensitive(p)) {
      skippedSensitive.push(p);
      continue;
    }
    const ftype = classifyFile(p);
    if (ftype) {
      if (GOOGLE_WORKSPACE_EXTENSIONS.has(path.extname(p).toLowerCase())) {
        if (!googleWorkspace) {
          skippedSensitive.push(p + " [Google Workspace shortcut skipped - pass --google-workspace or set GRAPHIFY_GOOGLE_WORKSPACE=1]");
          continue;
        }
        skippedSensitive.push(p + " [Google Workspace conversion not yet implemented]");
        continue;
      }
      if (OFFICE_EXTENSIONS.has(path.extname(p).toLowerCase())) {
        files[ftype].push(p);
        continue;
      }
      files[ftype].push(p);
      if (ftype !== FileType.Video) {
        totalWords += countWords(p);
      }
    }
  }

  for (const key of Object.keys(files)) {
    files[key].sort();
  }

  const totalFiles = Object.values(files).reduce((s, v) => s + v.length, 0);
  const needsGraph = totalWords >= CORPUS_WARN_THRESHOLD;

  let warning: string | null = null;
  if (!needsGraph) {
    warning = `Corpus is ~${totalWords.toLocaleString()} words - fits in a single context window. You may not need a graph.`;
  } else if (totalWords >= CORPUS_UPPER_THRESHOLD || totalFiles >= FILE_COUNT_UPPER) {
    warning = `Large corpus: ${totalFiles} files · ~${totalWords.toLocaleString()} words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.`;
  }

  return {
    files,
    total_files: totalFiles,
    total_words: totalWords,
    needs_graph: needsGraph,
    warning,
    skipped_sensitive: skippedSensitive,
    graphifyignore_patterns: ignorePatterns.length,
    scan_root: path.resolve(root),
  };
}

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

function md5File(filePath: string): string {
  const h = createHash("md5");
  try {
    const data = fs.readFileSync(filePath);
    h.update(data);
  } catch {
    return "";
  }
  return h.digest("hex");
}

function statAndHash(pathStr: string): [string, number, string] | null {
  try {
    const stat = fs.statSync(pathStr);
    return [pathStr, stat.mtimeMs, md5File(pathStr)];
  } catch {
    return null;
  }
}

function toRelativeForStorage(key: string, root: string): string {
  if (!path.isAbsolute(key)) return key;
  try {
    const rel = path.relative(path.resolve(root), key).split(path.sep).join("/");
    if (rel === ".." || rel.startsWith("../")) return key;
    return rel;
  } catch {
    return key;
  }
}

function toAbsoluteFromStorage(key: string, root: string): string {
  if (path.isAbsolute(key)) return key;
  return path.join(path.resolve(root), key);
}

export interface ManifestEntry {
  mtime: number;
  ast_hash: string;
  semantic_hash: string;
}

export function loadManifest(
  manifestPath: string = MANIFEST_PATH,
  root?: string,
): Record<string, ManifestEntry | number> {
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (root == null || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const result: Record<string, ManifestEntry | number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      result[toAbsoluteFromStorage(k, root)] = v as ManifestEntry | number;
    }
    return result;
  } catch {
    return {};
  }
}

function normaliseEntry(entry: unknown): ManifestEntry | null {
  if (typeof entry === "number") {
    return { mtime: entry, ast_hash: "", semantic_hash: "" };
  }
  if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
    const e = entry as Record<string, unknown>;
    if ("hash" in e && !("ast_hash" in e)) {
      return { mtime: (e.mtime as number) ?? 0, ast_hash: e.hash as string, semantic_hash: "" };
    }
    if ("mtime" in e) {
      return entry as unknown as ManifestEntry;
    }
  }
  return null;
}

export function saveManifest(
  files: Record<string, string[]>,
  manifestPath: string = MANIFEST_PATH,
  opts?: {
    kind?: string;
    root?: string;
  },
): void {
  const kind = opts?.kind ?? "both";
  const root = opts?.root;
  const existing = loadManifest(manifestPath, root);

  const manifest: Record<string, ManifestEntry> = {};
  for (const [f, entry] of Object.entries(existing)) {
    const normalised = normaliseEntry(entry);
    if (normalised === null) continue;
    try {
      if (fs.existsSync(f)) {
        manifest[f] = normalised;
      }
    } catch { continue; }
  }

  const allFiles = Object.values(files).flat();
  const hashed: Record<string, [number, string]> = {};
  for (const f of allFiles) {
    const r = statAndHash(f);
    if (r) hashed[r[0]] = [r[1], r[2]];
  }

  for (const f of allFiles) {
    if (!(f in hashed)) continue;
    const [mtime, h] = hashed[f];
    const prev = normaliseEntry(existing[f]) ?? { mtime: 0, ast_hash: "", semantic_hash: "" };
    const entry: ManifestEntry = {
      mtime,
      ast_hash: kind === "ast" || kind === "both" ? h : prev.ast_hash,
      semantic_hash: kind === "semantic" || kind === "both" ? h : (h === prev.ast_hash ? prev.semantic_hash : ""),
    };
    manifest[f] = entry;
  }

  let outputManifest: Record<string, ManifestEntry> = manifest;
  if (root != null) {
    outputManifest = {};
    for (const [k, v] of Object.entries(manifest)) {
      outputManifest[toRelativeForStorage(k, root)] = v;
    }
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(outputManifest, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// detectIncremental
// ---------------------------------------------------------------------------

export function detectIncremental(
  root: string,
  manifestPath: string = MANIFEST_PATH,
  opts?: {
    followSymlinks?: boolean | null;
    googleWorkspace?: boolean | null;
    kind?: string;
    extraExcludes?: string[] | null;
  },
): DetectResult {
  const kind = opts?.kind ?? "semantic";
  const full = detect(root, {
    followSymlinks: opts?.followSymlinks,
    googleWorkspace: opts?.googleWorkspace,
    extraExcludes: opts?.extraExcludes,
  });

  const manifest = loadManifest(manifestPath, root);

  if (Object.keys(manifest).length === 0) {
    full.incremental = true;
    full.new_files = full.files;
    full.unchanged_files = Object.fromEntries(
      Object.keys(full.files).map((k) => [k, [] as string[]]),
    );
    full.new_total = full.total_files;
    return full;
  }

  const newFiles: Record<string, string[]> = Object.fromEntries(
    Object.keys(full.files).map((k) => [k, [] as string[]]),
  );
  const unchangedFiles: Record<string, string[]> = Object.fromEntries(
    Object.keys(full.files).map((k) => [k, [] as string[]]),
  );

  for (const [ftype, fileList] of Object.entries(full.files)) {
    for (const f of fileList) {
      const stored = manifest[f];
      let currentMtime: number;
      try {
        currentMtime = fs.statSync(f).mtimeMs;
      } catch {
        currentMtime = 0;
      }

      let changed: boolean;
      if (typeof stored === "number") {
        changed = currentMtime > stored;
      } else if (typeof stored === "object" && stored !== null) {
        const e = stored as unknown as Record<string, unknown>;
        if ("hash" in e && !("ast_hash" in e)) {
          const normalised = { mtime: (e.mtime as number) ?? 0, ast_hash: e.hash as string, semantic_hash: "" };
          const hashKey = kind === "semantic" ? "semantic_hash" : "ast_hash";
          const storedHash = normalised[hashKey] as string;
          if (!storedHash) {
            changed = true;
          } else {
            const storedMtime = normalised.mtime;
            if (storedMtime == null || currentMtime !== storedMtime) {
              changed = md5File(f) !== storedHash;
            } else {
              changed = false;
            }
          }
        } else {
          const me = stored as unknown as ManifestEntry;
          const hashKey = kind === "semantic" ? "semantic_hash" : "ast_hash";
          const storedHash = me[hashKey] ?? "";
          if (!storedHash) {
            changed = true;
          } else {
            let storedMtime: number | null = me.mtime;
            if (typeof storedMtime === "object" && storedMtime !== null) {
              storedMtime = ((storedMtime as Record<string, unknown>).mtime as number) ?? null;
            }
            if (typeof storedMtime !== "number") storedMtime = null;
            if (storedMtime == null || currentMtime !== storedMtime) {
              changed = md5File(f) !== storedHash;
            } else {
              changed = false;
            }
          }
        }
      } else {
        changed = true;
      }

      if (changed) {
        newFiles[ftype].push(f);
      } else {
        unchangedFiles[ftype].push(f);
      }
    }
  }

  const currentFiles = new Set(Object.values(full.files).flat());
  const deletedFiles = Object.keys(manifest).filter((f) => !currentFiles.has(f));

  const newTotal = Object.values(newFiles).reduce((s, v) => s + v.length, 0);
  full.incremental = true;
  full.new_files = newFiles;
  full.unchanged_files = unchangedFiles;
  full.new_total = newTotal;
  full.deleted_files = deletedFiles;
  return full;
}

// ---------------------------------------------------------------------------
// extractOfficeText (sync convenience wrapper)
// ---------------------------------------------------------------------------

export function extractOfficeText(_filePath: string): string {
  return "";
}

export async function extractOfficeTextAsync(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".docx") {
    return docxToMarkdown(filePath);
  }
  if (ext === ".xlsx") {
    return xlsxToMarkdown(filePath);
  }
  return "";
}
