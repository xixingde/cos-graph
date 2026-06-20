import * as fs from "fs";
import type Graph from "graphology";
import { nodeCommunityMap } from "../analyze.js";

/** Escape a string for XML attribute values. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

/** Escape a string for XML text content. */
function xmlTextEscape(s: string): string {
  return s
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;");
}

/** Export graph as GraphML - opens in Gephi, yEd, and any GraphML-compatible tool.
 *
 * Community IDs are written as a node attribute so Gephi can colour by community.
 * Edge confidence (EXTRACTED/INFERRED/AMBIGUOUS) is preserved as an edge attribute.
 *
 * Self-implemented simplified GraphML writer (based on XML template).
 */
export function toGraphml(
  graph: Graph,
  communities: Record<number, string[]>,
  outputPath: string,
): void {
  const nodeCommunity = nodeCommunityMap(communities);

  // Collect all attribute keys used on nodes and edges
  const nodeAttrKeys = new Set<string>();
  const edgeAttrKeys = new Set<string>();

  graph.forEachNode((_node: string, attrs: Record<string, unknown>) => {
    for (const k of Object.keys(attrs)) {
      if (!k.startsWith("_")) nodeAttrKeys.add(k);
    }
  });
  // Always include community
  nodeAttrKeys.add("community");

  graph.forEachEdge((_edge: string, attrs: Record<string, unknown>) => {
    for (const k of Object.keys(attrs)) {
      if (!k.startsWith("_")) edgeAttrKeys.add(k);
    }
  });

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<graphml xmlns="http://graphml.graphstruct.org/xmlns"');
  lines.push('         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  lines.push('         xsi:schemaLocation="http://graphml.graphstruct.org/xmlns http://graphml.graphstruct.org/xmlns/1.0/graphml.xsd">');

  // Attribute definitions
  const sortedNodeKeys = [...nodeAttrKeys].sort();
  const sortedEdgeKeys = [...edgeAttrKeys].sort();

  for (const key of sortedNodeKeys) {
    lines.push(`  <key id="${xmlEscape(key)}" for="node" attr.name="${xmlEscape(key)}" attr.type="string"/>`);
  }
  for (const key of sortedEdgeKeys) {
    lines.push(`  <key id="${xmlEscape(key)}" for="edge" attr.name="${xmlEscape(key)}" attr.type="string"/>`);
  }

  const directed = graph.type === "directed" ? "directed" : "undirected";
  lines.push(`  <graph id="G" edgedefault="${directed}">`);

  // Nodes
  for (const nodeId of graph.nodes()) {
    const attrs = graph.getNodeAttributes(nodeId);
    const cid = nodeCommunity[nodeId] ?? -1;

    lines.push(`    <node id="${xmlEscape(nodeId)}">`);
    for (const key of sortedNodeKeys) {
      let value: string;
      if (key === "community") {
        value = String(cid);
      } else {
        value = String(attrs[key] ?? "");
      }
      lines.push(`      <data key="${xmlEscape(key)}">${xmlTextEscape(value)}</data>`);
    }
    lines.push("    </node>");
  }

  // Edges
  let edgeId = 0;
  graph.forEachEdge((_edge: string, attrs: Record<string, unknown>, source: string, target: string) => {
    lines.push(`    <edge id="e${edgeId}" source="${xmlEscape(source)}" target="${xmlEscape(target)}">`);
    for (const key of sortedEdgeKeys) {
      const value = String(attrs[key] ?? "");
      lines.push(`      <data key="${xmlEscape(key)}">${xmlTextEscape(value)}</data>`);
    }
    lines.push("    </edge>");
    edgeId++;
  });

  lines.push("  </graph>");
  lines.push("</graphml>");

  fs.writeFileSync(outputPath, lines.join("\n"), "utf-8");
}
