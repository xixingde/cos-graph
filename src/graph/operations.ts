import type Graph from "graphology";
import { subgraph, toUndirected } from "graphology-operators";
import type { NodeAttributes, EdgeAttributes } from "../types/graph.js";

export function degree(graph: Graph, nodeId: string): number {
  return graph.degree(nodeId);
}

export function neighbors(graph: Graph, nodeId: string): string[] {
  return graph.neighbors(nodeId);
}

export function subgraphFromNodes(graph: Graph, nodeIds: string[]): Graph {
  return subgraph(graph, nodeIds);
}

export function toUndirectedGraph(graph: Graph): Graph {
  return toUndirected(graph);
}

export function addNode(
  graph: Graph,
  nodeId: string,
  attrs: NodeAttributes
): void {
  const { id, ...rest } = attrs;
  graph.addNode(nodeId, rest);
}

export function addEdge(
  graph: Graph,
  source: string,
  target: string,
  attrs: EdgeAttributes
): void {
  const { source: _s, target: _t, ...rest } = attrs;
  graph.addEdge(source, target, rest);
}

export function getNodeAttributes(
  graph: Graph,
  nodeId: string
): NodeAttributes {
  const attrs = graph.getNodeAttributes(nodeId);
  return { id: nodeId, ...attrs } as unknown as NodeAttributes;
}

export function getEdgeAttributes(
  graph: Graph,
  source: string,
  target: string
): EdgeAttributes {
  const attrs = graph.getEdgeAttributes(source, target);
  return { source, target, ...attrs } as unknown as EdgeAttributes;
}

export function hasNode(graph: Graph, nodeId: string): boolean {
  return graph.hasNode(nodeId);
}

export function hasEdge(
  graph: Graph,
  source: string,
  target: string
): boolean {
  return graph.hasEdge(source, target);
}
