// per-file extraction cache - skip unchanged files on re-run
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { VERSION } from "./index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Output directory name — override with GRAPHIFY_OUT env var for worktrees or
// shared-output setups. Accepts a relative name ("graphify-out-feature") or an
// absolute path ("/shared/graphify-out").
export const GRAPHIFY_OUT: string =
  process.env.GRAPHIFY_OUT || "graphify-out";

// AST cache entries are the output of graphify's own extractor code, so they
// are only valid for the version that wrote them: keying purely on file
// content means extractor fixes shipped in a new release keep serving stale
// pre-fix results. The AST cache is therefore namespaced by package version
// (cache/ast/v{version}/), with entries from other versions removed on first
// use. The semantic cache is deliberately NOT versioned — its entries are
// produced by the LLM from file contents, and invalidating them on every
// release would re-bill extraction for unchanged files.
export const EXTRACTOR_VERSION: string = VERSION || "unknown";

// Version dirs already swept this process — cleanup runs once per (base, version).
let _cleanedAstDirs: Set<string> = new Set();

// ---------------------------------------------------------------------------
// Frontmatter stripping
// ---------------------------------------------------------------------------

// A frontmatter delimiter is a whole line of exactly three dashes (optional
// trailing whitespace). Substring checks like startswith("---") /
// find("\n---") also match "----" thematic breaks and "--- text" prose,
// silently dropping everything above them from the hash (#1259).
const FRONTMATTER_DELIM = /^---[ \t]*\r?$/gm;

/** Strip YAML frontmatter from Markdown content, returning only the body. */
export function bodyContent(content: Buffer): Buffer {
  const text = content.toString("utf-8");
  // Reset regex state since we reuse the global flag regex
  FRONTMATTER_DELIM.lastIndex = 0;
  const opener = FRONTMATTER_DELIM.exec(text);
  if (opener === null) {
    return content;
  }
  // Search for closing delimiter after the opener
  const closer = FRONTMATTER_DELIM.exec(text);
  if (closer === null) {
    return content;
  }
  // Slice right after the closing "---" (not after its line) so the output
  // stays byte-identical with the historical implementation for well-formed
  // frontmatter -- existing semantic-cache hashes must not churn.
  return Buffer.from(text.slice(closer.index + 3), "utf-8");
}

// ---------------------------------------------------------------------------
// Stat-based index
// ---------------------------------------------------------------------------

interface StatEntry {
  size: number;
  mtimeNs: number;
  hash: string;
}

// Stat-based index: maps absolute path to {size, mtimeNs, hash}.
// Loaded once per process, flushed via process exit handler. Skips full file
// reads when size+mtimeNs are unchanged — same trade-off as make(1).
// Correctness risks: "touch" causes a harmless extra re-hash; same-size edits
// within NFS second-resolution mtime have a 1-second window (same as make).
// Use "graphify extract --force" to bypass when needed.
let _statIndex: Record<string, StatEntry> = {};
let _statIndexRoot: string | null = null;
let _statIndexDirty: boolean = false;

function statIndexFile(root: string): string {
  const out = path.resolve(GRAPHIFY_OUT);
  const base = path.isAbsolute(GRAPHIFY_OUT) ? out : path.resolve(root, GRAPHIFY_OUT);
  return path.join(base, "cache", "stat-index.json");
}

export function ensureStatIndex(root: string): void {
  if (_statIndexRoot !== null) {
    return;
  }
  _statIndexRoot = path.resolve(root);
  const p = statIndexFile(_statIndexRoot);
  try {
    const data = fs.readFileSync(p, "utf-8");
    _statIndex = JSON.parse(data);
  } catch {
    _statIndex = {};
  }
  process.on("exit", flushStatIndex);
}

export function flushStatIndex(): void {
  if (!_statIndexDirty || _statIndexRoot === null) {
    return;
  }
  const p = statIndexFile(_statIndexRoot!);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmpDir = path.dirname(p);
    const tmpPath = path.join(tmpDir, `stat-index.${process.pid}.tmp`);
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(_statIndex));
      fs.renameSync(tmpPath, p);
    } catch {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  _statIndexDirty = false;
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/** Normalize path for consistent cache keys across Windows path spellings. */
export function normalizePath(filePath: string): string {
  if (process.platform !== "win32") {
    return filePath;
  }
  let s = filePath;
  if (s.startsWith("\\\\?\\")) {
    s = s.slice(4); // strip extended-length prefix \\?\
  }
  return s.toLowerCase();
}

// ---------------------------------------------------------------------------
// Cleanup stale AST entries
// ---------------------------------------------------------------------------

/**
 * Remove AST cache entries left behind by other graphify versions.
 * Sweeps sibling version directories and unversioned .json entries
 * (the pre-versioning layout) under cache/ast/. Best-effort: failures
 * are ignored, stragglers are retried on the next run.
 */
export function cleanupStaleAstEntries(astBase: string, currentDir: string): void {
  const key = currentDir;
  if (_cleanedAstDirs.has(key)) {
    return;
  }
  _cleanedAstDirs.add(key);
  if (!fs.existsSync(astBase) || !fs.statSync(astBase).isDirectory()) {
    return;
  }
  const entries = fs.readdirSync(astBase);
  for (const child of entries) {
    const childPath = path.join(astBase, child);
    if (childPath === currentDir) {
      continue;
    }
    try {
      const st = fs.statSync(childPath);
      if (st.isDirectory() && child.startsWith("v")) {
        fs.rmSync(childPath, { recursive: true, force: true });
      } else if (child.endsWith(".json") && st.isFile()) {
        fs.unlinkSync(childPath);
      }
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// file_hash
// ---------------------------------------------------------------------------

/**
 * SHA256 of file contents + path relative to root.
 *
 * Uses a stat-based fastpath (size + mtimeNs) to skip full reads when the
 * file hasn't changed. Falls through to full SHA256 on first encounter or
 * when stat changes. Index is flushed atomically at process exit.
 *
 * Using a relative path (not absolute) makes cache entries portable across
 * machines and checkout directories, so shared caches and CI work correctly.
 * Falls back to the resolved absolute path if the file is outside root.
 *
 * For Markdown files (.md), only the body below the YAML frontmatter is hashed,
 * so metadata-only changes (e.g. reviewed, status, tags) do not invalidate the cache.
 */
export function fileHash(filePath: string, root: string = "."): string {
  const p = normalizePath(path.resolve(filePath));
  const resolvedRoot = normalizePath(path.resolve(root));
  const pStat = fs.statSync(p, { throwIfNoEntry: false });
  if (!pStat) {
    throw new Error("file_hash requires a file, got: " + p);
  }
  if (pStat.isDirectory()) {
    throw new Error("file_hash requires a file, got directory: " + p);
  }

  ensureStatIndex(resolvedRoot);
  const absKey = path.resolve(p);
  let st: fs.Stats | null = null;
  try {
    st = fs.statSync(p);
    const entry = _statIndex[absKey];
    if (
      entry &&
      entry.size === st.size &&
      entry.mtimeNs === getMtimeNs(st)
    ) {
      return entry.hash;
    }
  } catch {
    // fall through to full hash
  }

  const raw = fs.readFileSync(p);
  const content =
    path.extname(p).toLowerCase() === ".md" ? bodyContent(raw) : raw;
  const h = crypto.createHash("sha256");
  h.update(content);
  h.update("\x00");
  try {
    const rel = path.relative(path.resolve(resolvedRoot), path.resolve(p));
    h.update(rel.split(path.sep).join("/").toLowerCase());
  } catch {
    h.update(path.resolve(p).split(path.sep).join("/").toLowerCase());
  }
  const digest = h.digest("hex");

  if (st !== null) {
    _statIndex[absKey] = { size: st.size, mtimeNs: getMtimeNs(st), hash: digest };
    _statIndexDirty = true;
  }

  return digest;
}

/**
 * Extract mtime in nanoseconds from a stat object.
 * Node.js stat.mtimeMs gives milliseconds; we multiply by 1e6 for nanosecond
 * resolution, matching Python's st_mtime_ns behavior for cache lookups.
 */
function getMtimeNs(st: fs.Stats): number {
  return Math.round(st.mtimeMs * 1e6);
}

// ---------------------------------------------------------------------------
// source_file relativize / absolutize
// ---------------------------------------------------------------------------

/**
 * Mutate payload to rewrite absolute source_file fields as
 * forward-slash relative paths from root.
 *
 * Mirror of graphify/watch relativize so cached extraction fragments persist
 * in portable form (#777). Already-relative fields and out-of-root paths
 * pass through unchanged.
 *
 * Only root is resolved — source_file itself is relativized
 * symbolically so in-root symlinks keep their original name rather than
 * pointing at the resolved target.
 */
export function relativizeSourceFilesIn(
  payload: Record<string, unknown>,
  root: string,
): void {
  let rootResolved: string;
  try {
    rootResolved = path.resolve(root);
  } catch {
    return;
  }
  for (const bucket of ["nodes", "edges", "hyperedges"]) {
    const items = payload[bucket];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const source = rec["source_file"];
      if (!source || typeof source !== "string") continue;
      if (!path.isAbsolute(source)) continue;
      try {
        const rel = path.relative(rootResolved, source);
        if (rel === ".." || rel.startsWith(".." + path.sep) || rel.startsWith("../")) {
          continue; // escaped root — keep absolute
        }
        rec["source_file"] = rel.split(path.sep).join("/");
      } catch {
        continue; // out-of-root (e.g. cross-drive on Windows)
      }
    }
  }
}

/**
 * Inverse of relativizeSourceFilesIn.
 *
 * Re-anchor relative source_file fields against root so callers
 * that load a cached fragment see the same absolute-path shape that a
 * fresh in-process extraction would produce. Legacy cache entries with
 * absolute source_file values pass through unchanged.
 */
export function absolutizeSourceFilesIn(
  payload: Record<string, unknown>,
  root: string,
): void {
  let rootResolved: string;
  try {
    rootResolved = path.resolve(root);
  } catch {
    return;
  }
  for (const bucket of ["nodes", "edges", "hyperedges"]) {
    const items = payload[bucket];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const source = rec["source_file"];
      if (!source || typeof source !== "string") continue;
      if (path.isAbsolute(source)) continue;
      try {
        rec["source_file"] = path.join(rootResolved, source);
      } catch {
        continue;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// cache_dir
// ---------------------------------------------------------------------------

/**
 * Returns the cache directory for kind - creates it if needed.
 *
 * kind is "ast" or "semantic". Separate subdirectories prevent semantic cache
 * entries from overwriting AST cache entries for the same source_file (#582).
 *
 * AST entries live in graphify-out/cache/ast/v{version}/ — namespaced by
 * graphify version because they depend on extractor code, not just file
 * contents. Semantic entries live unversioned in graphify-out/cache/semantic/
 * (re-extraction costs LLM calls).
 */
export function cacheDir(root: string = ".", kind: string = "ast"): string {
  const out = GRAPHIFY_OUT;
  const base = path.isAbsolute(out) ? out : path.resolve(root, out);
  let d = path.join(base, "cache", kind);
  if (kind === "ast") {
    d = path.join(d, "v" + EXTRACTOR_VERSION);
    cleanupStaleAstEntries(path.join(base, "cache", "ast"), d);
  }
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// ---------------------------------------------------------------------------
// load_cached / save_cached
// ---------------------------------------------------------------------------

/**
 * Return cached extraction for this file if hash matches, else null.
 *
 * Cache key: SHA256 of file contents.
 * Cache value: stored as graphify-out/cache/{kind}/{hash}.json (AST entries
 * under the per-version subdirectory, see cacheDir).
 *
 * AST entries written by other graphify versions — including the legacy
 * flat cache/ layout (pre-0.5.3) and the unversioned cache/ast/ layout —
 * are deliberately not consulted: they were produced by a different
 * extractor and may be stale.
 * Returns null if no cache entry or file has changed.
 */
export function loadCached(
  filePath: string,
  root: string = ".",
  kind: string = "ast",
): Record<string, unknown> | null {
  let h: string;
  try {
    h = fileHash(filePath, root);
  } catch {
    return null;
  }
  const entry = path.join(cacheDir(root, kind), h + ".json");
  if (!fs.existsSync(entry)) {
    return null;
  }
  try {
    const result = JSON.parse(fs.readFileSync(entry, "utf-8"));
    // Re-anchor relative source_file fields so callers see the same
    // absolute-path shape that a fresh in-process extraction produces
    // (#777). Legacy entries with absolute source_file pass through.
    if (result !== null && typeof result === "object" && !Array.isArray(result)) {
      absolutizeSourceFilesIn(result as Record<string, unknown>, root);
    }
    return result as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Save extraction result for this file.
 *
 * Stores as graphify-out/cache/{kind}/{hash}.json where hash = SHA256 of
 * current file contents. result should be a dict with nodes and edges lists.
 *
 * No-ops if path is not a regular file. Subagent-produced semantic fragments
 * occasionally carry a directory path in source_file; skipping them prevents
 * errors from aborting the whole batch.
 */
export function saveCached(
  filePath: string,
  data: Record<string, unknown>,
  root: string = ".",
  kind: string = "ast",
): void {
  const p = path.resolve(filePath);
  try {
    const st = fs.statSync(p, { throwIfNoEntry: false });
    if (!st || !st.isFile()) {
      return;
    }
  } catch {
    return;
  }
  // Relativize source_file fields against root before write so the
  // cache file on disk is portable across machines and checkout
  // directories (#777). The cache key is content-hashed so lookup is
  // already path-independent; this fixes the embedded path leak.
  //
  // Serialize a relativized copy rather than mutating the caller's dict —
  // downstream pipeline steps depend on the source_file field's original
  // absolute form. Mutating the input here would silently break those
  // remaps on the first extraction pass.
  let onDisk: Record<string, unknown> = data;
  const hasContent = (data["nodes"] && (data["nodes"] as unknown[]).length) ||
    (data["edges"] && (data["edges"] as unknown[]).length) ||
    (data["hyperedges"] && (data["hyperedges"] as unknown[]).length);
  if (hasContent) {
    onDisk = JSON.parse(JSON.stringify(data));
    relativizeSourceFilesIn(onDisk, root);
  }
  const h = fileHash(p, root);
  const targetDir = cacheDir(root, kind);
  const entry = path.join(targetDir, h + ".json");
  const tmpPath = path.join(targetDir, h + "." + process.pid + ".tmp");
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(onDisk));
    try {
      fs.renameSync(tmpPath, entry);
    } catch {
      // Windows: rename can fail if the target is briefly locked.
      // Fall back to copy-then-delete.
      fs.copyFileSync(tmpPath, entry);
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
  } catch (e) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// cached_files / clear_cache
// ---------------------------------------------------------------------------

/** Return set of file hashes that have a valid cache entry (any kind). */
export function cachedFiles(root: string = "."): Set<string> {
  const base = path.resolve(root, GRAPHIFY_OUT, "cache");
  const hashes: Set<string> = new Set();
  // Legacy flat entries
  try {
    if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
      for (const f of fs.readdirSync(base)) {
        if (f.endsWith(".json")) {
          hashes.add(path.basename(f, ".json"));
        }
      }
    }
  } catch {
    // ignore
  }
  // Namespaced entries (ast/ recursively, semantic/ top-level)
  for (const [kind, recursive] of [["ast", true], ["semantic", false]] as [string, boolean][]) {
    const d = path.join(base, kind);
    try {
      if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
        if (recursive) {
          collectJsonStems(d, hashes);
        } else {
          for (const f of fs.readdirSync(d)) {
            if (f.endsWith(".json")) {
              hashes.add(path.basename(f, ".json"));
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return hashes;
}

function collectJsonStems(dir: string, out: Set<string>): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectJsonStems(fullPath, out);
      } else if (entry.name.endsWith(".json")) {
        out.add(path.basename(entry.name, ".json"));
      }
    }
  } catch {
    // ignore
  }
}

/** Delete all cache entries (ast/, semantic/, and legacy flat entries). */
export function clearCache(root: string = "."): void {
  const base = path.resolve(root, GRAPHIFY_OUT, "cache");
  // Legacy flat entries
  try {
    if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
      for (const f of fs.readdirSync(base)) {
        if (f.endsWith(".json")) {
          fs.unlinkSync(path.join(base, f));
        }
      }
    }
  } catch {
    // ignore
  }
  // Namespaced entries (ast/ recursively, semantic/ top-level)
  for (const [kind, recursive] of [["ast", true], ["semantic", false]] as [string, boolean][]) {
    const d = path.join(base, kind);
    try {
      if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
        if (recursive) {
          deleteJsonFilesRecursive(d);
        } else {
          for (const f of fs.readdirSync(d)) {
            if (f.endsWith(".json")) {
              fs.unlinkSync(path.join(d, f));
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

function deleteJsonFilesRecursive(dir: string): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        deleteJsonFilesRecursive(fullPath);
      } else if (entry.name.endsWith(".json")) {
        fs.unlinkSync(fullPath);
      }
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Semantic cache helpers
// ---------------------------------------------------------------------------

interface SemanticCacheResult {
  cachedNodes: Record<string, unknown>[];
  cachedEdges: Record<string, unknown>[];
  cachedHyperedges: Record<string, unknown>[];
  uncachedFiles: string[];
}

/**
 * Check semantic extraction cache for a list of absolute file paths.
 *
 * Returns {cachedNodes, cachedEdges, cachedHyperedges, uncachedFiles}.
 * Uncached files need LLM extraction; cached files are merged directly.
 */
export function checkSemanticCache(
  files: string[],
  root: string = ".",
): SemanticCacheResult {
  const cachedNodes: Record<string, unknown>[] = [];
  const cachedEdges: Record<string, unknown>[] = [];
  const cachedHyperedges: Record<string, unknown>[] = [];
  const uncached: string[] = [];

  for (const fpath of files) {
    let p = fpath;
    if (!path.isAbsolute(p)) {
      p = path.join(root, p);
    }
    const result = loadCached(p, root, "semantic");
    if (result !== null) {
      const nodes = result["nodes"];
      const edges = result["edges"];
      const hyperedges = result["hyperedges"];
      if (Array.isArray(nodes)) cachedNodes.push(...nodes as Record<string, unknown>[]);
      if (Array.isArray(edges)) cachedEdges.push(...edges as Record<string, unknown>[]);
      if (Array.isArray(hyperedges)) cachedHyperedges.push(...hyperedges as Record<string, unknown>[]);
    } else {
      uncached.push(fpath);
    }
  }

  return { cachedNodes, cachedEdges, cachedHyperedges, uncachedFiles: uncached };
}

/**
 * Save semantic extraction results to cache, keyed by source_file.
 *
 * Groups nodes and edges by source_file, then saves one cache entry per file
 * under cache/semantic/ (separate from AST entries in cache/ast/) to prevent
 * hash-key collisions (#582).
 * Returns the number of files cached.
 */
export function saveSemanticCache(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[],
  hyperedges?: Record<string, unknown>[] | null,
  root: string = ".",
): number {
  const byFile: Record<string, { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[]; hyperedges: Record<string, unknown>[] }> = {};

  for (const n of nodes) {
    const src = (n["source_file"] as string) || "";
    if (src) {
      if (!byFile[src]) {
        byFile[src] = { nodes: [], edges: [], hyperedges: [] };
      }
      byFile[src].nodes.push(n);
    }
  }
  for (const e of edges) {
    const src = (e["source_file"] as string) || "";
    if (src) {
      if (!byFile[src]) {
        byFile[src] = { nodes: [], edges: [], hyperedges: [] };
      }
      byFile[src].edges.push(e);
    }
  }
  for (const he of hyperedges || []) {
    const src = (he["source_file"] as string) || "";
    if (src) {
      if (!byFile[src]) {
        byFile[src] = { nodes: [], edges: [], hyperedges: [] };
      }
      byFile[src].hyperedges.push(he);
    }
  }

  let saved = 0;
  for (const [fpath, result] of Object.entries(byFile)) {
    let p = fpath;
    if (!path.isAbsolute(p)) {
      p = path.join(root, p);
    }
    try {
      const st = fs.statSync(p, { throwIfNoEntry: false });
      if (st && st.isFile()) {
        saveCached(p, result as Record<string, unknown>, root, "semantic");
        saved += 1;
      }
    } catch {
      // skip
    }
  }
  return saved;
}

// ---------------------------------------------------------------------------
// Internal state reset (for testing)
// ---------------------------------------------------------------------------

/** Reset module-level mutable state. Only for use in tests. */
export function _resetState(): void {
  _cleanedAstDirs = new Set();
  _statIndex = {};
  _statIndexRoot = null;
  _statIndexDirty = false;
}
