/** Deterministic symbol indexing and conservative cross-file resolution helpers. */

import * as fs from "fs";
import * as path from "path";

import type { ImportedSymbol } from "./types/symbol.js";

// ---------------------------------------------------------------------------
// sanitizeMetadata — placeholder matching Python security.sanitize_metadata
// ---------------------------------------------------------------------------

const _CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/g;
const _METADATA_MAX_VALUE_LEN = 4096;
const _METADATA_MAX_LIST_ITEMS = 256;

function _sanitizeMetadataString(value: unknown): string {
  const text = String(value).replace(_CONTROL_CHAR_RE, "");
  const AMP = "\x26amp;";   // &
  const LT = "\x26lt;";    // <
  const GT = "\x26gt;";    // >
  const QUOT = "\x26quot;"; // "
  const escaped = text
    .replace(/&/g, AMP)
    .replace(/</g, LT)
    .replace(/>/g, GT)
    .replace(/"/g, QUOT);
  if (escaped.length > _METADATA_MAX_VALUE_LEN) {
    return escaped.slice(0, _METADATA_MAX_VALUE_LEN);
  }
  return escaped;
}

function _sanitizeMetadataValue(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return _sanitizeMetadataString(value);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return sanitizeMetadata(value as Record<string, unknown>);
  }
  if (Array.isArray(value)) {
    return value.slice(0, _METADATA_MAX_LIST_ITEMS).map(_sanitizeMetadataValue);
  }
  if (typeof value === "number" || value === null) return value;
  return _sanitizeMetadataString(value);
}

export function sanitizeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (metadata == null) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const cleanKey = _sanitizeMetadataString(key);
    if (!cleanKey) continue;
    result[cleanKey] = _sanitizeMetadataValue(value);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

export function normaliseCallableLabel(label: string): string {
  let s = label.trim();
  while (s.startsWith("(") || s.startsWith(")")) s = s.slice(1);
  while (s.endsWith("(") || s.endsWith(")")) s = s.slice(0, -1);
  while (s.startsWith(".")) s = s.slice(1);
  return s.toLowerCase();
}

export function nodeIsResolvableSymbol(node: Record<string, unknown>): boolean {
  if (node.file_type !== "code") return false;
  const label = String(node.label ?? "").trim();
  if (!label) return false;
  if (
    label.endsWith(".py") ||
    label.endsWith(".js") ||
    label.endsWith(".ts") ||
    label.endsWith(".tsx") ||
    label.endsWith(".java") ||
    label.endsWith(".go") ||
    label.endsWith(".rs")
  ) {
    return false;
  }
  return !!normaliseCallableLabel(label);
}

export function buildLabelIndex(
  nodes: Record<string, unknown>[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const node of nodes) {
    if (!nodeIsResolvableSymbol(node)) continue;
    const nodeId = node.id;
    if (!nodeId) continue;
    const key = normaliseCallableLabel(String(node.label ?? ""));
    if (!key) continue;
    const existing = index.get(key);
    if (existing) {
      existing.push(String(nodeId));
    } else {
      index.set(key, [String(nodeId)]);
    }
  }
  return index;
}

export function existingEdgePairs(
  edges: Record<string, unknown>[],
): Set<string> {
  const pairs = new Set<string>();
  for (const edge of edges) {
    const source = edge.source;
    const target = edge.target;
    const relation = edge.relation ?? "";
    if (source && target) {
      pairs.add(`${source}|${target}|${relation}`);
    }
  }
  return pairs;
}

export function iterRawCalls(
  perFile: unknown[],
): Record<string, unknown>[] {
  const calls: Record<string, unknown>[] = [];
  for (const result of perFile) {
    if (result === null || result === undefined || typeof result !== "object" || Array.isArray(result)) continue;
    const rawCalls = (result as Record<string, unknown>).raw_calls;
    if (!Array.isArray(rawCalls)) continue;
    for (const rawCall of rawCalls) {
      if (rawCall !== null && rawCall !== undefined && typeof rawCall === "object" && !Array.isArray(rawCall)) {
        calls.push(rawCall as Record<string, unknown>);
      }
    }
  }
  return calls;
}

export function moduleStem(moduleName: string | null): string {
  if (!moduleName) return "";
  return moduleName.replace(/^\.+|\.+$/g, "").split(".").pop() ?? "";
}

// ---------------------------------------------------------------------------
// Python import alias parser (regex-based, top-level only)
// ---------------------------------------------------------------------------

const _FROM_IMPORT_RE =
  /^from\s+(\S+)\s+import\s+((?:[^\n\r\\#]|\\.)+)$/gm;
const _IMPORT_ITEM_RE =
  /(\w+)\s*(?:as\s+(\w+))?/g;

export function parsePythonImportAliases(
  filePath: string,
): Map<string, ImportedSymbol> {
  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch {
    return new Map();
  }

  const aliases = new Map<string, ImportedSymbol>();
  const lines = source.split("\n");
  let lineNo = 0;

  for (const line of lines) {
    lineNo++;
    // Only match lines that start with "from" at column 0 (top-level)
    const trimmed = line.trimStart();
    if (trimmed !== line) continue; // indented → function-local, skip
    if (!trimmed.startsWith("from ")) continue;

    const m = trimmed.match(/^from\s+(\S+)\s+import\s+((?:[^\n\r\\#]|\\.)+)$/);
    if (!m) continue;

    const modStem = moduleStem(m[1]);
    if (!modStem) continue;

    const importList = m[2].trim();
    if (importList === "*") continue;

    // Parse comma-separated import items
    const items = importList.split(",");
    for (const item of items) {
      const im = item.trim().match(/^(\w+)\s*(?:as\s+(\w+))?$/);
      if (!im) continue;
      if (im[1] === "*") continue;
      const localName = im[2] || im[1];
      aliases.set(localName, {
        localName,
        importedName: im[1],
        moduleStem: modStem,
        sourceFile: filePath,
        sourceLocation: `L${lineNo}`,
      });
    }
  }

  return aliases;
}

// ---------------------------------------------------------------------------
// Python symbol index
// ---------------------------------------------------------------------------

export function nodeSourceStem(node: Record<string, unknown>): string {
  const sourceFile = String(node.source_file ?? "");
  if (!sourceFile) return "";
  const parsed = path.parse(sourceFile);
  return parsed.name;
}

export function buildPythonSymbolIndex(
  nodes: Record<string, unknown>[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const node of nodes) {
    if (!nodeIsResolvableSymbol(node)) continue;
    const sourceStem = nodeSourceStem(node);
    if (!sourceStem) continue;
    const label = normaliseCallableLabel(String(node.label ?? ""));
    if (!label) continue;
    const nodeId = node.id;
    if (!nodeId) continue;
    const key = `${sourceStem}\0${label}`;
    const existing = index.get(key);
    if (existing) {
      existing.push(String(nodeId));
    } else {
      index.set(key, [String(nodeId)]);
    }
  }
  return index;
}

export function findUniquePythonSymbol(
  symbolIndex: Map<string, string[]>,
  imported: ImportedSymbol,
): string | null {
  const candidates = symbolIndex.get(`${imported.moduleStem}\0${imported.importedName.toLowerCase()}`);
  if (candidates && candidates.length === 1) return candidates[0];
  return null;
}

// ---------------------------------------------------------------------------
// Python import-guided call resolver
// ---------------------------------------------------------------------------

export function resolvePythonImportGuidedCalls(
  perFile: unknown[],
  paths: string[],
  allNodes: Record<string, unknown>[],
  allEdges: Record<string, unknown>[],
): Record<string, unknown>[] {
  const symbolIndex = buildPythonSymbolIndex(allNodes);
  const knownPairs = existingEdgePairs(allEdges);

  const resultByFile = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (!p.endsWith(".py")) continue;
    const slot = i < perFile.length ? perFile[i] : null;
    resultByFile.set(
      p,
      slot !== null && slot !== undefined && typeof slot === "object" && !Array.isArray(slot)
        ? slot as Record<string, unknown>
        : { nodes: [], edges: [] },
    );
  }

  const resolvedEdges: Record<string, unknown>[] = [];

  for (const p of paths) {
    if (!p.endsWith(".py")) continue;
    const aliases = parsePythonImportAliases(p);
    if (aliases.size === 0) continue;
    const fileResult = resultByFile.get(p) ?? { raw_calls: [] };
    const rawCalls = (fileResult as Record<string, unknown>).raw_calls;
    if (!Array.isArray(rawCalls)) continue;

    for (const rawCall of rawCalls) {
      if (rawCall === null || rawCall === undefined || typeof rawCall !== "object" || Array.isArray(rawCall)) continue;
      const rc = rawCall as Record<string, unknown>;
      if (rc.is_member_call) continue;
      const callee = String(rc.callee ?? "").trim();
      if (!callee) continue;
      const imported = aliases.get(callee);
      if (!imported) continue;
      const target = findUniquePythonSymbol(symbolIndex, imported);
      if (target === null) continue;
      const caller = String(rc.caller_nid ?? "");
      if (!caller || caller === target) continue;
      const pair = `${caller}|${target}|calls`;
      if (knownPairs.has(pair)) continue;
      knownPairs.add(pair);
      resolvedEdges.push({
        source: caller,
        target,
        relation: "calls",
        context: "import_guided_call",
        confidence: "EXTRACTED",
        confidence_score: 1.0,
        source_file: rc.source_file ?? p,
        source_location: rc.source_location || imported.sourceLocation,
        weight: 1.0,
        metadata: sanitizeMetadata({
          resolver: "python_import_guided",
          local_name: imported.localName,
          imported_name: imported.importedName,
          module_stem: imported.moduleStem,
          import_source_location: imported.sourceLocation,
        }),
      });
    }
  }

  return resolvedEdges;
}

// ---------------------------------------------------------------------------
// Cross-file raw call resolver
// ---------------------------------------------------------------------------

export function resolveCrossFileRawCalls(
  perFile: unknown[],
  allNodes: Record<string, unknown>[],
  allEdges: Record<string, unknown>[],
): Record<string, unknown>[] {
  const labelIndex = buildLabelIndex(allNodes);
  const knownPairs = existingEdgePairs(allEdges);
  const resolved: Record<string, unknown>[] = [];

  for (const rawCall of iterRawCalls(perFile)) {
    const callee = String(rawCall.callee ?? "").trim();
    if (!callee) continue;
    if (rawCall.is_member_call) continue;
    const candidates = labelIndex.get(callee.toLowerCase());
    if (!candidates || candidates.length !== 1) continue;
    const target = candidates[0];
    const caller = String(rawCall.caller_nid ?? "");
    if (!caller) continue;
    if (target === caller) continue;
    const pair = `${caller}|${target}|calls`;
    if (knownPairs.has(pair)) continue;
    knownPairs.add(pair);
    resolved.push({
      source: caller,
      target,
      relation: "calls",
      context: "call",
      confidence: "INFERRED",
      confidence_score: 0.8,
      source_file: rawCall.source_file ?? "",
      source_location: rawCall.source_location ?? undefined,
      weight: 1.0,
    });
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Bash helpers (exact copies of extract._make_id / _file_stem)
// ---------------------------------------------------------------------------

export function bashMakeId(...parts: string[]): string {
  const combined = parts.filter((p) => p).map((p) => p.replace(/^_+|_+$/g, "")).join("_");
  const normalized = combined.normalize("NFKC");
  let cleaned = normalized.replace(/[^\w]+/gu, "_");
  cleaned = cleaned.replace(/_+/g, "_");
  return cleaned.replace(/^_+|_+$/g, "").toLocaleLowerCase();
}

export function bashFileStem(relPath: string): string {
  const parsed = path.parse(relPath);
  const parent = path.basename(path.dirname(relPath));
  if (parent && parent !== "." && parent !== "") {
    return `${parent}.${parsed.name}`;
  }
  return parsed.name;
}

function fileNodeIdForPath(filePath: string, root: string): string {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  let rel: string;
  try {
    rel = path.relative(resolvedRoot, resolved);
    if (rel.startsWith("..")) throw new Error("outside root");
  } catch {
    return bashMakeId(resolved);
  }
  return bashMakeId(bashFileStem(rel));
}

// ---------------------------------------------------------------------------
// Bash source edge resolver
// ---------------------------------------------------------------------------

export function resolveBashSourceEdges(
  perFile: (Record<string, unknown> | null | undefined)[],
  paths: string[],
  root: string,
  existingEdges?: Record<string, unknown>[],
): Record<string, unknown>[] {
  const pathByIndex = paths.map((p) => path.resolve(p));
  const fileNidByPath = new Map<string, string>();
  for (const p of pathByIndex) {
    fileNidByPath.set(p, fileNodeIdForPath(p, root));
  }

  const functionsByFile = new Map<string, Map<string, string>>();
  for (let i = 0; i < perFile.length && i < pathByIndex.length; i++) {
    const result = perFile[i];
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    const fileNid = fileNidByPath.get(pathByIndex[i])!;
    const nodes = result.nodes;
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes) {
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      const metadata = (node as Record<string, unknown>).metadata;
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
      if ((metadata as Record<string, unknown>).kind !== "bash_function") continue;
      const label = String((node as Record<string, unknown>).label ?? "");
      const name = label.replace(/\(\)$/, "").trim();
      const nodeId = (node as Record<string, unknown>).id;
      if (!name || !nodeId) continue;
      if (!functionsByFile.has(fileNid)) functionsByFile.set(fileNid, new Map());
      functionsByFile.get(fileNid)!.set(name, String(nodeId));
    }
  }

  const sourcedFiles = new Map<string, Set<string>>();
  const resolvedEdges: Record<string, unknown>[] = [];
  const existing = existingEdgePairs(existingEdges ?? []);

  for (let i = 0; i < perFile.length && i < pathByIndex.length; i++) {
    const result = perFile[i];
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    const srcFileNid = fileNidByPath.get(pathByIndex[i])!;
    const bashSources = result.bash_sources;
    if (!Array.isArray(bashSources)) continue;
    for (const source of bashSources) {
      if (!source || typeof source !== "object" || Array.isArray(source)) continue;
      const rawTarget = (source as Record<string, unknown>).target_path;
      if (typeof rawTarget !== "string" || !rawTarget.trim()) continue;
      let candidate = rawTarget;
      if (!path.isAbsolute(candidate)) {
        candidate = path.join(path.dirname(pathByIndex[i]), candidate);
      }
      let targetPath: string;
      try {
        targetPath = path.resolve(candidate);
      } catch {
        continue;
      }
      const targetFileNid = fileNidByPath.get(targetPath);
      if (targetFileNid === undefined) continue;
      if (!sourcedFiles.has(srcFileNid)) sourcedFiles.set(srcFileNid, new Set());
      sourcedFiles.get(srcFileNid)!.add(targetFileNid);
      const key = `${srcFileNid}|${targetFileNid}|imports_from`;
      if (existing.has(key)) continue;
      existing.add(key);
      resolvedEdges.push({
        source: srcFileNid,
        target: targetFileNid,
        relation: "imports_from",
        context: "import",
        confidence: "EXTRACTED",
        confidence_score: 1.0,
        source_file: (source as Record<string, unknown>).source_file ?? String(pathByIndex[i]),
        source_location: (source as Record<string, unknown>).source_location ?? "",
        weight: 1.0,
      });
    }
  }

  for (let i = 0; i < perFile.length && i < pathByIndex.length; i++) {
    const result = perFile[i];
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    const callerFileNid = fileNidByPath.get(pathByIndex[i])!;
    const importedFileIds = sourcedFiles.get(callerFileNid);
    if (!importedFileIds || importedFileIds.size === 0) continue;
    const rawCalls = result.raw_calls;
    if (!Array.isArray(rawCalls)) continue;
    for (const rawCall of rawCalls) {
      if (!rawCall || typeof rawCall !== "object" || Array.isArray(rawCall)) continue;
      const rc = rawCall as Record<string, unknown>;
      if (rc.language !== "bash") continue;
      const callee = rc.callee;
      const callerNid = rc.caller_nid;
      if (typeof callee !== "string" || !callee || !callerNid) continue;
      const matches: string[] = [];
      for (const fileNid of importedFileIds) {
        const funcs = functionsByFile.get(fileNid);
        if (funcs && funcs.has(callee)) {
          matches.push(funcs.get(callee)!);
        }
      }
      if (matches.length !== 1) continue;
      const target = matches[0];
      const key = `${String(callerNid)}|${target}|calls`;
      if (existing.has(key)) continue;
      existing.add(key);
      resolvedEdges.push({
        source: String(callerNid),
        target,
        relation: "calls",
        context: "call",
        confidence: "EXTRACTED",
        confidence_score: 1.0,
        source_file: rc.source_file ?? String(pathByIndex[i]),
        source_location: rc.source_location ?? "",
        weight: 1.0,
      });
    }
  }

  return resolvedEdges;
}
