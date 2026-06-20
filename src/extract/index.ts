/** Main entry point for AST extraction. */
import * as fs from "fs";
import * as path from "path";

import { loadCached, saveCached } from "../cache.js";
import { isNoiseDir, isIgnored, loadGraphifyignore } from "../detect.js";
import type { ExtractionResult, GraphNode, GraphEdge } from "../types/extraction.js";
import { makeId, fileNodeId, safeExtract, LANGUAGE_BUILTIN_GLOBALS } from "./framework.js";
import { getExtractor, getRegisteredExtensions } from "./registry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARALLEL_THRESHOLD = 20;

const JS_CACHE_BYPASS_SUFFIXES = new Set([
  ".js", ".jsx", ".mjs", ".ts", ".tsx", ".vue", ".svelte",
]);

// ---------------------------------------------------------------------------
// Sequential extraction
// ---------------------------------------------------------------------------

interface UncachedWork {
  idx: number;
  filePath: string;
}

function extractSequential(
  uncachedWork: UncachedWork[],
  perFile: (Record<string, unknown> | null)[],
  effectiveRoot: string,
  totalFiles: number,
): void {
  const PROGRESS_INTERVAL = 100;
  for (let workIdx = 0; workIdx < uncachedWork.length; workIdx++) {
    const { idx, filePath } = uncachedWork[workIdx];
    if (
      totalFiles >= PROGRESS_INTERVAL &&
      workIdx % PROGRESS_INTERVAL === 0 &&
      workIdx > 0
    ) {
      console.error(
        `  AST extraction: ${workIdx}/${uncachedWork.length} uncached files (${Math.floor((workIdx * 100) / uncachedWork.length)}%)`,
      );
    }
    const extractor = getExtractor(filePath);
    if (extractor === null) {
      perFile[idx] = { nodes: [], edges: [] };
      continue;
    }
    const ext = path.extname(filePath);
    const bypassCache = JS_CACHE_BYPASS_SUFFIXES.has(ext);
    const result = safeExtract(extractor, filePath);
    if (!bypassCache && !result.error) {
      saveCached(filePath, result as unknown as Record<string, unknown>, effectiveRoot);
    }
    perFile[idx] = result as unknown as Record<string, unknown>;
  }
  if (totalFiles >= PROGRESS_INTERVAL) {
    console.error(`  AST extraction: ${totalFiles}/${totalFiles} files (100%)`);
  }
}

// ---------------------------------------------------------------------------
// extract() — main entry
// ---------------------------------------------------------------------------

export interface ExtractOptions {
  parallel?: boolean;
  maxWorkers?: number;
}

/** Extract AST nodes and edges from a list of code files.
 *
 * Two-pass process:
 * 1. Per-file structural extraction (classes, functions, imports)
 * 2. Cross-file import resolution (placeholder — not yet migrated) */
export function extract(
  filePaths: string[],
  cacheRoot?: string,
  options?: ExtractOptions,
): ExtractionResult {
  const parallel = options?.parallel ?? true;
  // maxWorkers unused — parallel extraction is TODO (worker_threads)

  // Infer a common root for cache keys (use first diverging segment)
  let root: string;
  try {
    if (filePaths.length === 0) {
      root = ".";
    } else if (filePaths.length === 1) {
      root = path.dirname(filePaths[0]);
    } else {
      const parts = filePaths.map((p) => p.split(/[/\\]/));
      const minLen = Math.min(...parts.map((p) => p.length));
      let commonLen = 0;
      for (let i = 0; i < minLen; i++) {
        const segs = new Set(parts.map((p) => p[i].toLowerCase()));
        if (segs.size === 1) {
          commonLen++;
        } else {
          break;
        }
      }
      root = commonLen > 0 ? parts[0].slice(0, commonLen).join("/") : ".";
    }
  } catch {
    root = ".";
  }
  if (cacheRoot !== undefined && cacheRoot !== null) {
    root = cacheRoot;
  }
  root = path.resolve(root);

  const effectiveRoot = cacheRoot || root;
  const total = filePaths.length;

  // Phase 1: separate cached hits from uncached work
  const perFile: (Record<string, unknown> | null)[] = new Array(total).fill(null);
  const uncachedWork: UncachedWork[] = [];

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    if (getExtractor(filePath) === null) {
      perFile[i] = { nodes: [], edges: [] };
      continue;
    }
    const ext = path.extname(filePath);
    const bypassCache = JS_CACHE_BYPASS_SUFFIXES.has(ext);
    if (!bypassCache) {
      const cached = loadCached(filePath, effectiveRoot);
      if (cached !== null) {
        perFile[i] = cached;
        continue;
      }
    }
    uncachedWork.push({ idx: i, filePath });
  }

  // Phase 2: extract uncached files (sequential for now; parallel is TODO)
  if (uncachedWork.length > 0) {
    // TODO: parallel extraction via worker_threads when uncachedWork.length >= PARALLEL_THRESHOLD
    extractSequential(uncachedWork, perFile, effectiveRoot, total);
  }

  // Fill any remaining null slots (defensive)
  for (let i = 0; i < total; i++) {
    if (perFile[i] === null) {
      perFile[i] = { nodes: [], edges: [] };
    }
  }

  // Merge results
  const allNodes: Record<string, unknown>[] = [];
  const allEdges: Record<string, unknown>[] = [];
  const allRawCalls: Record<string, unknown>[] = [];
  for (const result of perFile) {
    const r = result as Record<string, unknown>;
    allNodes.push(...((r["nodes"] as Record<string, unknown>[]) || []));
    allEdges.push(...((r["edges"] as Record<string, unknown>[]) || []));
    allRawCalls.push(...((r["raw_calls"] as Record<string, unknown>[]) || []));
  }

  // --- ID remap ---
  const idRemap: Record<string, string> = {};
  const prefixRemap: Record<string, [string, string]> = {};

  for (const filePath of filePaths) {
    const oldId = makeId(filePath);
    let rel: string;
    try {
      rel = path.relative(root, path.resolve(filePath));
    } catch {
      continue;
    }
    rel = rel.split(path.sep).join("/");
    const newId = fileNodeId(rel);
    if (oldId !== newId) {
      idRemap[oldId] = newId;
    }
    const oldPref = fileNodeId(filePath);
    if (oldPref !== newId) {
      prefixRemap[path.resolve(filePath)] = [oldPref, newId];
    }
  }

  if (Object.keys(idRemap).length > 0) {
    for (const n of allNodes) {
      const nid = n["id"] as string | undefined;
      if (nid !== undefined && nid in idRemap) {
        n["id"] = idRemap[nid];
      }
    }
    for (const e of allEdges) {
      const src = e["source"] as string | undefined;
      if (src !== undefined && src in idRemap) {
        e["source"] = idRemap[src];
      }
      const tgt = e["target"] as string | undefined;
      if (tgt !== undefined && tgt in idRemap) {
        e["target"] = idRemap[tgt];
      }
    }
  }

  if (Object.keys(prefixRemap).length > 0) {
    const symRemap: Record<string, string> = {};
    for (const n of allNodes) {
      const sf = n["source_file"] as string | undefined;
      if (!sf) continue;
      let entry: [string, string] | undefined;
      try {
        entry = prefixRemap[path.resolve(sf)];
      } catch {
        continue;
      }
      if (!entry) continue;
      const [oldPref, newPref] = entry;
      const nid = (n["id"] as string) || "";
      if (nid.startsWith(oldPref + "_")) {
        const newNid = newPref + nid.slice(oldPref.length);
        if (newNid !== nid) {
          symRemap[nid] = newNid;
        }
      }
    }
    if (Object.keys(symRemap).length > 0) {
      for (const n of allNodes) {
        const nid = n["id"] as string | undefined;
        if (nid !== undefined && nid in symRemap) {
          n["id"] = symRemap[nid];
        }
      }
      for (const e of allEdges) {
        const src = e["source"] as string | undefined;
        if (src !== undefined && src in symRemap) {
          e["source"] = symRemap[src];
        }
        const tgt = e["target"] as string | undefined;
        if (tgt !== undefined && tgt in symRemap) {
          e["target"] = symRemap[tgt];
        }
      }
      for (const rc of allRawCalls) {
        const cn = rc["caller_nid"] as string | undefined;
        if (cn !== undefined && cn in symRemap) {
          rc["caller_nid"] = symRemap[cn];
        }
      }
    }
  }

  // Cross-file import resolution — placeholder
  // TODO: _resolve_cross_file_imports, _resolve_cross_file_java_imports, etc.

  // Cross-file call resolution
  const globalLabelToNids: Record<string, string[]> = {};
  for (const n of allNodes) {
    if ((n["file_type"] as string) === "rationale") continue;
    const raw = ((n["label"] as string) || "").replace(/[()]+$/g, "").replace(/^\.+/, "");
    if (raw) {
      const key = raw.toLowerCase();
      (globalLabelToNids[key] ??= []).push(n["id"] as string);
    }
  }

  // Build evidence index from import edges
  const fileToSymbolImports: Record<string, Set<string>> = {};
  const fileToModuleImports: Record<string, Set<string>> = {};
  for (const e of allEdges) {
    if ((e["relation"] as string) === "imports") {
      const src = e["source"] as string;
      (fileToSymbolImports[src] ??= new Set()).add(e["target"] as string);
    } else if ((e["relation"] as string) === "imports_from") {
      const src = e["source"] as string;
      (fileToModuleImports[src] ??= new Set()).add(e["target"] as string);
    }
  }

  // Map each node back to its containing file_id
  const nidToFileNid: Record<string, string> = {};
  for (const n of allNodes) {
    const sf = n["source_file"] as string | undefined;
    if (!sf) continue;
    let sfRel: string;
    try {
      sfRel = path.isAbsolute(sf)
        ? path.relative(root, sf).split(path.sep).join("/")
        : sf;
    } catch {
      sfRel = sf;
    }
    nidToFileNid[n["id"] as string] = fileNodeId(sfRel);
  }

  const existingPairs = new Set<string>();
  for (const e of allEdges) {
    existingPairs.add(`${e["source"] as string}→${e["target"] as string}`);
  }

  for (const rc of allRawCalls) {
    const callee = rc["callee"] as string;
    if (!callee) continue;
    if (LANGUAGE_BUILTIN_GLOBALS.has(callee)) continue;
    if (rc["is_member_call"]) continue;

    const candidates = globalLabelToNids[callee.toLowerCase()];
    if (!candidates || candidates.length === 0) continue;

    const caller = rc["caller_nid"] as string;
    const callerFileNid = nidToFileNid[caller];
    const importedSymbols = callerFileNid !== undefined
      ? (fileToSymbolImports[callerFileNid] ?? new Set<string>())
      : new Set<string>();
    const importedModules = callerFileNid !== undefined
      ? (fileToModuleImports[callerFileNid] ?? new Set<string>())
      : new Set<string>();

    function hasImportEvidence(candidateId: string): boolean {
      const candidateFileNid = nidToFileNid[candidateId];
      return (
        importedSymbols.has(candidateId) ||
        (candidateFileNid !== undefined && importedModules.has(candidateFileNid))
      );
    }

    let tgt: string;
    let hasEvidence: boolean;
    if (candidates.length === 1) {
      tgt = candidates[0];
      hasEvidence = hasImportEvidence(tgt);
    } else {
      const symbolMatches = candidates.filter((c) => importedSymbols.has(c));
      if (symbolMatches.length === 1) {
        tgt = symbolMatches[0];
        hasEvidence = true;
      } else {
        const moduleMatches = candidates.filter(
          (c) => nidToFileNid[c] !== undefined && importedModules.has(nidToFileNid[c]!),
        );
        if (moduleMatches.length === 1) {
          tgt = moduleMatches[0];
          hasEvidence = true;
        } else {
          continue;
        }
      }
    }

    const pairKey = `${caller}→${tgt}`;
    if (tgt !== caller && !existingPairs.has(pairKey)) {
      existingPairs.add(pairKey);
      allEdges.push({
        source: caller,
        target: tgt,
        relation: "calls",
        context: "call",
        confidence: hasEvidence ? "EXTRACTED" : "INFERRED",
        confidence_score: hasEvidence ? 1.0 : 0.8,
        source_file: (rc["source_file"] as string) || "",
        source_location: rc["source_location"],
        weight: 1.0,
      });
    }
  }

  // Relativize source_file fields so paths are portable across machines
  for (const item of [...allNodes, ...allEdges]) {
    const sf = item["source_file"] as string | undefined;
    if (!sf) continue;
    if (!path.isAbsolute(sf)) continue;
    try {
      item["source_file"] = path.relative(root, sf).split(path.sep).join("/");
    } catch {
      // different drives on Windows — leave as-is
    }
  }

  // Tag AST provenance so the incremental watch rebuild can distinguish
  // AST-extracted nodes from semantic/LLM nodes.
  for (const n of allNodes) {
    n["_origin"] = "ast";
  }

  return {
    nodes: allNodes as unknown as GraphNode[],
    edges: allEdges as unknown as GraphEdge[],
    languages: {},
  };
}

// ---------------------------------------------------------------------------
// collectFiles() — file discovery
// ---------------------------------------------------------------------------

export interface CollectFilesOptions {
  followSymlinks?: boolean;
  root?: string;
}

/** Collect all extractable files under a target directory. */
export function collectFiles(
  target: string,
  options?: CollectFilesOptions,
): string[] {
  const resolved = path.resolve(target);
  const stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return [resolved];

  const extensions = getRegisteredExtensions();
  const ignoreRoot = options?.root ?? resolved;
  const patterns = loadGraphifyignore(ignoreRoot);
  const ignoreCache = new Map<string, boolean>();

  function isIgnoredCached(p: string): boolean {
    if (patterns.length === 0) return false;
    return isIgnored(p, ignoreRoot, patterns, ignoreCache);
  }

  const followSymlinks = options?.followSymlinks ?? false;

  if (!followSymlinks) {
    if (resolved.split(/[/\\]/).some((part) => isNoiseDir(part))) {
      return [];
    }

    const hasNegation = patterns.some(([, pat]) => pat.startsWith("!"));
    const results: string[] = [];

    function walk(dir: string): void {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const subdirs: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!isNoiseDir(entry.name) && (hasNegation || !isIgnoredCached(full))) {
            subdirs.push(full);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.has(ext) && !isIgnoredCached(full)) {
            results.push(full);
          }
        }
      }
      for (const subdir of subdirs) {
        walk(subdir);
      }
    }

    walk(resolved);
    return results.sort();
  }

  // Walk with symlink following + cycle detection
  const results: string[] = [];
  const seenReal = new Set<string>();

  function walkLink(dir: string): void {
    const realDir = fs.realpathSync(dir);
    if (seenReal.has(realDir)) return;
    seenReal.add(realDir);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const subdirs: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isNoiseDir(entry.name)) {
          subdirs.push(full);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.has(ext) && !isIgnoredCached(full)) {
          results.push(full);
        }
      }
    }
    for (const subdir of subdirs) {
      walkLink(subdir);
    }
  }

  walkLink(resolved);
  return results.sort();
}
