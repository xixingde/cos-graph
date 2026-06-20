import type Graph from "graphology";
import { bidirectional } from "graphology-shortest-path";

export function shortestPath(
  graph: Graph,
  source: string,
  target: string
): string[] | null {
  return bidirectional(graph, source, target);
}
