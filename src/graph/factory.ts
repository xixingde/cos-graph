import Graph, { DirectedGraph } from "graphology";
import type { NodeAttributes, EdgeAttributes } from "../types/graph.js";

export type { Graph };

export interface GraphJSON {
  nodes: NodeAttributes[];
  edges: EdgeAttributes[];
}

export function createGraph(directed?: boolean): Graph {
  if (directed) {
    return new DirectedGraph();
  }
  return new Graph({ type: "undirected" });
}

export function graphFromJSON(data: GraphJSON): Graph {
  const hasDirectedEdge = data.edges.some(
    (e) => e.relation === "DEPENDS_ON" || e.relation === "CALLS"
  );
  const graph = createGraph(hasDirectedEdge);

  for (const node of data.nodes) {
    const { id, ...attrs } = node;
    graph.addNode(id, attrs);
  }

  for (const edge of data.edges) {
    const { source, target, ...attrs } = edge;
    if (graph.hasNode(source) && graph.hasNode(target)) {
      graph.addEdge(source, target, attrs);
    }
  }

  return graph;
}

export function graphToJSON(graph: Graph): GraphJSON {
  const nodes: NodeAttributes[] = [];
  const edges: EdgeAttributes[] = [];

  graph.forEachNode((node: string, attrs: Record<string, unknown>) => {
    nodes.push({ id: node, ...attrs } as unknown as NodeAttributes);
  });

  graph.forEachEdge(
    (
      _edge: string,
      attrs: Record<string, unknown>,
      source: string,
      target: string
    ) => {
      edges.push({ source, target, ...attrs } as unknown as EdgeAttributes);
    }
  );

  return { nodes, edges };
}
