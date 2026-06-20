// Semantic fragment sanitizer — converts sentence-like rationale nodes into
// attributes on related nodes and removes invalid file_type values.

import * as fs from "node:fs";
import * as path from "node:path";

// Labels longer than this many characters, or containing >= this many words,
// are candidates for being sentence-like rationale text rather than entity names.
const _RATIONALE_MIN_CHARS = 80;
const _RATIONALE_MIN_WORDS = 8;

// Validation limits for untrusted semantic-fragment payloads.
export const MAX_SEMANTIC_FRAGMENT_BYTES = 25 * 1024 * 1024;
export const MAX_SEMANTIC_FRAGMENT_NODES = 10_000;
export const MAX_SEMANTIC_FRAGMENT_EDGES = 100_000;
export const MAX_SEMANTIC_FRAGMENT_HYPEREDGES = 10_000;
export const MAX_SEMANTIC_HYPEREDGE_NODES = 256;
export const MAX_SEMANTIC_ID_LENGTH = 256;
export const VALID_SEMANTIC_FILE_TYPES = new Set([
  "code", "document", "paper", "image", "rationale", "concept",
]);
const _SEMANTIC_ID_RE = /^[A-Za-z0-9._:-]+$/;

/**
 * Return validation errors for an untrusted semantic extraction fragment.
 * Empty list means valid. Called by skill merge code before
 * sanitizeSemanticFragment() so malformed or malicious agent JSON is
 * rejected before it touches the graph.
 */
export function validateSemanticFragment(fragment: unknown): string[] {
  if (typeof fragment !== "object" || fragment === null || Array.isArray(fragment)) {
    return ["fragment must be a JSON object"];
  }

  const errors: string[] = [];
  let payload: Uint8Array;
  try {
    payload = new TextEncoder().encode(JSON.stringify(fragment));
  } catch (exc: unknown) {
    return [`fragment is not JSON-serializable: ${exc}`];
  }

  if (payload.length > MAX_SEMANTIC_FRAGMENT_BYTES) {
    errors.push(`payload is ${payload.length} bytes; max is ${MAX_SEMANTIC_FRAGMENT_BYTES}`);
  }

  const frag = fragment as Record<string, unknown>;
  let nodes = frag.nodes as unknown[];
  let edges = frag.edges as unknown[];
  if (!Array.isArray(nodes)) {
    errors.push("nodes must be a list");
    nodes = [];
  } else if (nodes.length > MAX_SEMANTIC_FRAGMENT_NODES) {
    errors.push(`nodes has ${nodes.length} entries; max is ${MAX_SEMANTIC_FRAGMENT_NODES}`);
  }

  if (!Array.isArray(edges)) {
    errors.push("edges must be a list");
    edges = [];
  } else if (edges.length > MAX_SEMANTIC_FRAGMENT_EDGES) {
    errors.push(`edges has ${edges.length} entries; max is ${MAX_SEMANTIC_FRAGMENT_EDGES}`);
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Record<string, unknown>;
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      errors.push(`nodes[${i}] must be an object`);
      continue;
    }
    _validateSemanticId(errors, `nodes[${i}].id`, node.id);
    const fileType = node.file_type;
    if (fileType !== undefined && fileType !== null && !VALID_SEMANTIC_FILE_TYPES.has(fileType as string)) {
      errors.push(
        `nodes[${i}].file_type '${fileType}' is not one of ` +
        `${[...VALID_SEMANTIC_FILE_TYPES].sort().join(",")}`
      );
    }
  }

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i] as Record<string, unknown>;
    if (typeof edge !== "object" || edge === null || Array.isArray(edge)) {
      errors.push(`edges[${i}] must be an object`);
      continue;
    }
    _validateSemanticId(errors, `edges[${i}].source`, edge.source);
    _validateSemanticId(errors, `edges[${i}].target`, edge.target);
  }

  let hyperedges = frag.hyperedges as unknown[];
  if (hyperedges === null || hyperedges === undefined) {
    hyperedges = [];
  }
  if (!Array.isArray(hyperedges)) {
    errors.push("hyperedges must be a list");
  } else {
    if (hyperedges.length > MAX_SEMANTIC_FRAGMENT_HYPEREDGES) {
      errors.push(
        `hyperedges has ${hyperedges.length} entries; ` +
        `max is ${MAX_SEMANTIC_FRAGMENT_HYPEREDGES}`
      );
    }
    for (let i = 0; i < hyperedges.length; i++) {
      const he = hyperedges[i] as Record<string, unknown>;
      if (typeof he !== "object" || he === null || Array.isArray(he)) {
        errors.push(`hyperedges[${i}] must be an object`);
        continue;
      }
      _validateSemanticId(errors, `hyperedges[${i}].id`, he.id);
      const heNodes = he.nodes;
      if (!Array.isArray(heNodes)) {
        errors.push(`hyperedges[${i}].nodes must be a list`);
        continue;
      }
      if (heNodes.length > MAX_SEMANTIC_HYPEREDGE_NODES) {
        errors.push(
          `hyperedges[${i}].nodes has ${heNodes.length} entries; ` +
          `max is ${MAX_SEMANTIC_HYPEREDGE_NODES}`
        );
      }
      for (let j = 0; j < heNodes.length; j++) {
        _validateSemanticId(errors, `hyperedges[${i}].nodes[${j}]`, heNodes[j]);
      }
    }
  }

  return errors;
}

/**
 * Load and validate a semantic chunk, rejecting oversize files before parsing.
 * Returns [fragment, []] on success or [null, errors] on failure.
 */
export function loadValidatedSemanticFragment(
  filePath: string,
): [Record<string, unknown> | null, string[]] {
  let size: number;
  try {
    const stat = fs.statSync(filePath);
    size = stat.size;
  } catch (exc: unknown) {
    return [null, [`could not stat ${filePath}: ${exc}`]];
  }
  if (size > MAX_SEMANTIC_FRAGMENT_BYTES) {
    return [null, [`payload is ${size} bytes; max is ${MAX_SEMANTIC_FRAGMENT_BYTES}`]];
  }
  let fragment: unknown;
  try {
    const text = fs.readFileSync(filePath, "utf-8");
    fragment = JSON.parse(text);
  } catch (exc: unknown) {
    if (exc instanceof SyntaxError) {
      return [null, [`invalid JSON: ${exc}`]];
    }
    return [null, [`could not read ${filePath}: ${exc}`]];
  }
  const errors = validateSemanticFragment(fragment);
  return errors.length ? [null, errors] : [fragment as Record<string, unknown>, []];
}

function _validateSemanticId(
  errors: string[],
  field: string,
  value: unknown,
): void {
  if (typeof value !== "string") {
    errors.push(`${field} must be a string`);
    return;
  }
  if (!value) {
    errors.push(`${field} must not be empty`);
    return;
  }
  if (value.length > MAX_SEMANTIC_ID_LENGTH) {
    errors.push(`${field} is ${value.length} chars; max is ${MAX_SEMANTIC_ID_LENGTH}`);
  }
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    errors.push(`${field} must not contain path separators or '..'`);
  }
  if (!_SEMANTIC_ID_RE.test(value)) {
    errors.push(`${field} contains unsupported characters`);
  }
}

/**
 * Clean up a semantic extraction fragment in-place.
 *
 * Operations:
 * 1. Removes nodes with file_type "rationale" or "concept" that were emitted
 *    by an LLM (these are not valid semantic entity types).
 * 2. Detects nodes whose label reads like a sentence / rationale paragraph AND
 *    that participate in a rationale_for edge, then converts the label into a
 *    rationale attribute on the target node and removes the source-node + its edges.
 * 3. Strips nodes whose only distinguishing field is the label itself (empty id).
 * 4. Filters hyperedges so they cannot reference removed or unknown node IDs
 *    after the cleanup passes above. A hyperedge with fewer than two surviving
 *    members is dropped.
 *
 * Returns the same dict for convenience.
 */
export function sanitizeSemanticFragment(
  fragment: Record<string, any>,
): Record<string, any> {
  const _invalidFt = new Set(["rationale", "concept"]);

  const nodes: Record<string, any>[] = fragment.nodes || [];
  const edges: Record<string, any>[] = fragment.edges || [];
  const hyperedges: Record<string, any>[] = fragment.hyperedges || [];

  // ---- build lookup maps --------------------------------------------------
  const nodeById: Record<string, Record<string, any>> = {};
  for (const n of nodes) {
    const nid = n.id || "";
    if (nid) {
      nodeById[nid] = n;
    }
  }

  // Pre-collect node IDs that source a `rationale_for` edge
  const rationaleForSources = new Set<string>();
  for (const e of edges) {
    if (e.relation === "rationale_for") {
      const src = e.source || "";
      if (src) {
        rationaleForSources.add(src);
      }
    }
  }

  // ---- pass 1: identify nodes to remove + rationale candidates -----------
  const rationaleCandidates: Record<string, any>[] = [];
  const removeIds = new Set<string>();
  const keepNodes: Record<string, any>[] = [];
  for (const n of nodes) {
    const nid = n.id || "";
    if (!nid) {
      continue;
    }
    const ft = n.file_type || "";
    const label = n.label || "";
    if (_invalidFt.has(ft)) {
      if (isSentenceLikeRationaleLabel(label)) {
        rationaleCandidates.push(n);
      }
      removeIds.add(nid);
      continue;
    }
    if (rationaleForSources.has(nid) && isSentenceLikeRationaleLabel(label)) {
      rationaleCandidates.push(n);
      removeIds.add(nid);
      continue;
    }
    keepNodes.push(n);
  }

  // ---- pass 2: convert sentence-nodes → rationale attributes --------------
  const rationaleAttrs: Record<string, string[]> = {};
  for (const rn of rationaleCandidates) {
    const rnId = rn.id || "";
    const text = (rn.label || "").trim();
    for (const e of edges) {
      if (e.relation !== "rationale_for") {
        continue;
      }
      if (e.source !== rnId) {
        continue;
      }
      const targetId = e.target;
      if (!(targetId in nodeById) || removeIds.has(targetId)) {
        continue;
      }
      if (!rationaleAttrs[targetId]) {
        rationaleAttrs[targetId] = [];
      }
      rationaleAttrs[targetId].push(text);
    }
  }

  for (const [targetId, texts] of Object.entries(rationaleAttrs)) {
    if (targetId in nodeById && !removeIds.has(targetId)) {
      _appendRationaleAttr(nodeById[targetId], texts);
    }
  }

  // ---- pass 3: strip edges referencing removed nodes ----------------------
  const keepEdges: Record<string, any>[] = [];
  for (const e of edges) {
    const src = e.source || "";
    const tgt = e.target || "";
    if (removeIds.has(src) || removeIds.has(tgt)) {
      continue;
    }
    keepEdges.push(e);
  }

  // ---- pass 4: filter hyperedges to surviving node IDs --------------------
  const survivingIds = new Set(keepNodes.map((n) => n.id || "").filter(Boolean));
  const keepHyperedges: Record<string, any>[] = [];
  for (const he of hyperedges) {
    if (typeof he !== "object" || he === null) {
      continue;
    }
    const heNodes = he.nodes;
    if (!Array.isArray(heNodes)) {
      continue;
    }
    const filtered = heNodes.filter(
      (ref: unknown) => typeof ref === "string" && survivingIds.has(ref),
    ) as string[];
    if (filtered.length < 2) {
      continue;
    }
    if (filtered.length !== heNodes.length) {
      const clonedHe = { ...he, nodes: filtered };
      keepHyperedges.push(clonedHe);
    } else {
      keepHyperedges.push(he);
    }
  }

  fragment.nodes = keepNodes;
  fragment.edges = keepEdges;
  fragment.hyperedges = keepHyperedges;
  return fragment;
}

/**
 * Return True if label looks like prose / rationale text rather than an
 * entity or concept name.
 *
 * Heuristics (no false positives on short-concept-edge-cases):
 * - Longer than _RATIONALE_MIN_CHARS chars, OR
 * - At least _RATIONALE_MIN_WORDS whitespace-delimited tokens, AND
 * - Contains at least one sentence-ending punctuation mark (. ! ?) or a colon.
 */
export function isSentenceLikeRationaleLabel(label: string): boolean {
  if (!label) {
    return false;
  }
  label = label.trim();
  if (label.length < _RATIONALE_MIN_CHARS) {
    const wordCount = label.split(/\s+/).length;
    if (wordCount < _RATIONALE_MIN_WORDS) {
      return false;
    }
  }
  // Must look like actual prose: has sentence-ending punctuation or a colon.
  return /[.!?:]/.test(label);
}

function _appendRationaleAttr(node: Record<string, any>, texts: string[]): void {
  const existing = node.rationale || "";
  const newText = texts.join("\n\n").trim();
  if (existing) {
    node.rationale = existing + "\n\n" + newText;
  } else {
    node.rationale = newText;
  }
}
