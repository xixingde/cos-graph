import * as path from "path";
import type { ExtractionResult } from "../types/extraction.js";

// ---------------------------------------------------------------------------
// Language built-in globals
// ---------------------------------------------------------------------------

// Language built-in globals that AST may classify as call targets when used as
// constructors or coercion functions (e.g. String(x), Number(x), Boolean(x)).
// Without this filter they become god-nodes accumulating spurious edges from
// every call site. Filter applied at same-file and cross-file resolution.
export const LANGUAGE_BUILTIN_GLOBALS: Set<string> = new Set([
  // JavaScript / TypeScript ECMAScript built-ins
  "String", "Number", "Boolean", "Object", "Array", "Symbol", "BigInt",
  "Date", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError",
  "ReferenceError", "EvalError", "URIError",
  "Promise", "Map", "Set", "WeakMap", "WeakSet", "JSON", "Math",
  "Reflect", "Proxy", "Intl",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
  // Browser / Node common globals
  "URL", "URLSearchParams", "FormData", "Blob", "File",
  "Headers", "Request", "Response", "AbortController", "AbortSignal",
  "TextEncoder", "TextDecoder", "console",
  // Python built-in callables
  "str", "int", "float", "bool", "list", "dict", "set", "tuple", "bytes",
  "len", "range", "enumerate", "zip", "map", "filter", "sum", "min", "max",
  "print", "open", "isinstance", "type", "super", "sorted", "reversed",
  "any", "all", "abs", "round", "next", "iter", "hash", "id", "repr",
  "callable", "getattr", "setattr", "hasattr", "delattr", "vars", "dir",
]);

// ---------------------------------------------------------------------------
// Semantic relation / context constants
// ---------------------------------------------------------------------------

export const SEMANTIC_RELATIONS: Set<string> = new Set([
  "inherits", "implements", "mixes_in", "embeds", "references",
  "calls", "imports", "imports_from", "re_exports", "contains", "method",
]);

export const REFERENCE_CONTEXTS: Set<string> = new Set([
  "field", "parameter_type", "return_type", "generic_arg", "attribute", "value", "type",
]);

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

/** Build a stable node ID from one or more name parts.
 *
 * Preserves Unicode letters/digits (CJK, Cyrillic, Arabic, accented Latin,
 * etc.) so non-ASCII identifiers produce distinct IDs and don't collapse to
 * a single per-file node. NFKC normalization ensures composed and decomposed
 * forms of the same character produce the same ID. */
export function makeId(...parts: string[]): string {
  let combined = parts
    .filter((p) => p)
    .map((p) => p.trim().replace(/^[_.]+|[_.]+$/g, ""))
    .join("_");
  combined = combined.normalize("NFKC");
  let cleaned = combined.replace(/[^\w]+/gu, "_");
  cleaned = cleaned.replace(/_+/g, "_");
  return cleaned.replace(/^_+|_+$/g, "").toLowerCase();
}

/** Return a stem qualified with the parent directory name to avoid ID collisions
 * when multiple files share the same filename in different directories. */
export function fileStem(filePath: string): string {
  const parsed = path.parse(filePath);
  const parent = path.basename(path.dirname(filePath));
  if (parent && parent !== "." && parent !== "") {
    return `${parent}.${parsed.name}`;
  }
  return parsed.name;
}

/** File-level node ID matching the skill.md spec: {parent_dir}_{stem} —
 * one parent directory level, no extension. relPath MUST be relative to
 * the project root so top-level files collapse to a bare stem. */
export function fileNodeId(relPath: string): string {
  return makeId(fileStem(relPath));
}

// ---------------------------------------------------------------------------
// Source location
// ---------------------------------------------------------------------------

/** Format a line number (or line string) into a source_location string.
 * Returns null if the line is null or undefined. */
export function sourceLocation(line: number | string | null | undefined): string | null {
  if (line === null || line === undefined) return null;
  return String(line);
}

// ---------------------------------------------------------------------------
// Semantic reference edge
// ---------------------------------------------------------------------------

/** Create a semantic reference edge dict with validation. */
export function semanticReferenceEdge(
  source: string,
  target: string,
  context: string,
  sourceFile: string,
  line: number | string | null | undefined,
): Record<string, unknown> {
  if (!REFERENCE_CONTEXTS.has(context)) {
    throw new Error(`unknown reference context: ${context}`);
  }
  return {
    source,
    target,
    relation: "references",
    context,
    confidence: "EXTRACTED",
    source_file: sourceFile,
    source_location: sourceLocation(line),
    weight: 1.0,
  };
}

// ---------------------------------------------------------------------------
// Safe extract
// ---------------------------------------------------------------------------

/** Wrap an extractor call so exceptions don't kill the batch. */
export function safeExtract(
  extractor: (filePath: string) => ExtractionResult,
  filePath: string,
): ExtractionResult {
  try {
    return extractor(filePath);
  } catch (e: unknown) {
    const msg = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
    if (process.env.GRAPHIFY_DEBUG) {
      console.error(e);
    }
    console.error(`  warning: skipped ${filePath} (${msg})`);
    return { nodes: [], edges: [], languages: {}, error: msg };
  }
}
