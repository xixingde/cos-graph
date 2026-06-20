/** AST extraction generic framework — shared by all language extractors. */
import { sourceLocation } from "./framework.js";

// ---------------------------------------------------------------------------
// AST extraction context
// ---------------------------------------------------------------------------

/** Mutable context passed through a single file's AST extraction pass. */
export interface AstExtractionContext {
  filePath: string;
  source: string;
  tree: unknown; // Tree from web-tree-sitter
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
}

/** Create a fresh extraction context for a file. */
export function createAstContext(
  filePath: string,
  source: string,
  tree: unknown,
): AstExtractionContext {
  return {
    filePath,
    source,
    tree,
    nodes: [],
    edges: [],
  };
}

// ---------------------------------------------------------------------------
// Node / edge helpers
// ---------------------------------------------------------------------------

/** Add a node to the extraction context and return its ID. */
export function addNode(
  ctx: AstExtractionContext,
  id: string,
  label: string,
  line: number,
  attrs?: Record<string, unknown>,
): string {
  const node: Record<string, unknown> = {
    id,
    label,
    source_file: ctx.filePath,
    source_location: sourceLocation(line),
    ...attrs,
  };
  ctx.nodes.push(node);
  return id;
}

/** Add an edge to the extraction context. */
export function addEdge(
  ctx: AstExtractionContext,
  source: string,
  target: string,
  relation: string,
  line: number,
  attrs?: Record<string, unknown>,
): void {
  const edge: Record<string, unknown> = {
    source,
    target,
    relation,
    source_file: ctx.filePath,
    source_location: sourceLocation(line),
    ...attrs,
  };
  ctx.edges.push(edge);
}
