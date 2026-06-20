import type Graph from "graphology";

/** Export graph as an SVG file — TODO stub.
 *
 * Requires a JS layout library equivalent to matplotlib's spring_layout.
 * Not yet implemented.
 */
export function toSvg(
  _graph: Graph,
  _communities: Record<number, string[]>,
  _outputPath: string,
  _options?: {
    communityLabels?: Record<number, string>;
    figsize?: [number, number];
  }
): void {
  throw new Error("Not implemented: toSvg requires a JS layout library (e.g. d3-force). Install a layout engine and re-enable.");
}
