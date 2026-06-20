import * as fs from "fs";
import * as path from "path";
import type Graph from "graphology";
import { nodeCommunityMap } from "../analyze.js";
import { safeName } from "./obsidian.js";

/** Export graph as an Obsidian Canvas file - communities as groups, nodes as cards. */
export function toCanvas(
  graph: Graph,
  communities: Record<number, string[]>,
  outputPath: string,
  options?: {
    communityLabels?: Record<number, string>;
    nodeFilenames?: Record<string, string>;
  }
): void {
  const { communityLabels, nodeFilenames: providedNodeFilenames } = options ?? {};

  // Obsidian canvas color codes (cycle through for communities)
  const CANVAS_COLORS = ["1", "2", "3", "4", "5", "6"]; // red, orange, yellow, green, cyan, purple

  // Build nodeFilenames if not provided (same dedup logic as toObsidian)
  const nodeFilenames: Record<string, string> = {};
  if (providedNodeFilenames) {
    Object.assign(nodeFilenames, providedNodeFilenames);
  } else {
    const seenNames: Record<string, number> = {};
    graph.forEachNode((nodeId: string, attrs: Record<string, unknown>) => {
      const base = safeName((attrs["label"] as string) ?? nodeId);
      if (base in seenNames) {
        seenNames[base] += 1;
        nodeFilenames[nodeId] = `${base}_${seenNames[base]}`;
      } else {
        seenNames[base] = 0;
        nodeFilenames[nodeId] = base;
      }
    });
  }

  // Fallback: with no community data, emit every node into one synthetic community
  let effectiveCommunities = communities;
  if (Object.keys(communities).length === 0 && graph.order > 0) {
    effectiveCommunities = { 0: graph.nodes() };
  }

  const numCommunities = Object.keys(effectiveCommunities).length;
  const cols = Math.ceil(Math.sqrt(numCommunities)) || 1;
  const rows = Math.ceil(numCommunities / cols) || 1;

  const canvasNodes: Record<string, unknown>[] = [];
  const canvasEdges: Record<string, unknown>[] = [];

  const gap = 80;
  const sortedCids = Object.keys(effectiveCommunities).map(Number).sort((a, b) => a - b);

  // Precompute group sizes
  const groupSizes: Record<number, [number, number]> = {};
  for (const cid of sortedCids) {
    const members = effectiveCommunities[cid];
    const n = members.length;
    const w = Math.max(600, n > 0 ? 220 * Math.ceil(Math.sqrt(n)) : 600);
    const h = Math.max(400, n > 0 ? 100 * Math.ceil(n / 3) + 120 : 400);
    groupSizes[cid] = [w, h];
  }

  // Compute col widths and row heights
  const colWidths: number[] = [];
  for (let colIdx = 0; colIdx < cols; colIdx++) {
    let maxW = 0;
    for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
      const linear = rowIdx * cols + colIdx;
      if (linear < sortedCids.length) {
        const cid = sortedCids[linear];
        const [w] = groupSizes[cid];
        maxW = Math.max(maxW, w);
      }
    }
    colWidths.push(maxW);
  }

  const rowHeights: number[] = [];
  for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
    let maxH = 0;
    for (let colIdx = 0; colIdx < cols; colIdx++) {
      const linear = rowIdx * cols + colIdx;
      if (linear < sortedCids.length) {
        const cid = sortedCids[linear];
        const [, h] = groupSizes[cid];
        maxH = Math.max(maxH, h);
      }
    }
    rowHeights.push(maxH);
  }

  // Map from cid → (group_x, group_y, group_w, group_h)
  const groupLayout: Record<number, [number, number, number, number]> = {};
  for (let idx = 0; idx < sortedCids.length; idx++) {
    const cid = sortedCids[idx];
    const colIdx = idx % cols;
    const rowIdx = Math.floor(idx / cols);
    const gx = colWidths.slice(0, colIdx).reduce((a, b) => a + b, 0) + colIdx * gap;
    const gy = rowHeights.slice(0, rowIdx).reduce((a, b) => a + b, 0) + rowIdx * gap;
    const [gw, gh] = groupSizes[cid];
    groupLayout[cid] = [gx, gy, gw, gh];
  }

  // Build set of all node_ids in canvas for edge filtering
  const allCanvasNodes = new Set<string>();
  for (const members of Object.values(effectiveCommunities)) {
    for (const m of members) allCanvasNodes.add(m);
  }

  // Generate group and node canvas entries
  for (let idx = 0; idx < sortedCids.length; idx++) {
    const cid = sortedCids[idx];
    const members = effectiveCommunities[cid];
    const communityName = communityLabels
      ? (communityLabels[cid] ?? `Community ${cid}`)
      : `Community ${cid}`;
    const [gx, gy, gw, gh] = groupLayout[cid];
    const canvasColor = CANVAS_COLORS[idx % CANVAS_COLORS.length];

    // Group node
    canvasNodes.push({
      id: `g${cid}`,
      type: "group",
      label: communityName,
      x: gx,
      y: gy,
      width: gw,
      height: gh,
      color: canvasColor,
    });

    // Node cards inside the group - rows of 3
    const sortedMembers = [...members].sort((a, b) => {
      const la = (graph.getNodeAttributes(a)["label"] as string) ?? a;
      const lb = (graph.getNodeAttributes(b)["label"] as string) ?? b;
      return la.localeCompare(lb);
    });
    for (let mIdx = 0; mIdx < sortedMembers.length; mIdx++) {
      const nodeId = sortedMembers[mIdx];
      const col = mIdx % 3;
      const row = Math.floor(mIdx / 3);
      const nxX = gx + 20 + col * (180 + 20);
      const nxY = gy + 80 + row * (60 + 20);
      const fname = nodeFilenames[nodeId] ?? safeName((graph.getNodeAttributes(nodeId)["label"] as string) ?? nodeId);
      canvasNodes.push({
        id: `n_${nodeId}`,
        type: "file",
        file: `${fname}.md`,
        x: nxX,
        y: nxY,
        width: 180,
        height: 60,
      });
    }
  }

  // Generate edges - only between nodes both in canvas, cap at 200 highest-weight
  const allEdgesWeighted: [number, string, string, string][] = [];
  graph.forEachEdge((_edge: string, attrs: Record<string, unknown>, u: string, v: string) => {
    if (allCanvasNodes.has(u) && allCanvasNodes.has(v)) {
      const weight = (attrs["weight"] as number) ?? 1.0;
      const relation = (attrs["relation"] as string) ?? "";
      const conf = (attrs["confidence"] as string) ?? "EXTRACTED";
      const label = relation ? `${relation} [${conf}]` : `[${conf}]`;
      allEdgesWeighted.push([weight, u, v, label]);
    }
  });

  allEdgesWeighted.sort((a, b) => b[0] - a[0]);
  for (const [, u, v, label] of allEdgesWeighted.slice(0, 200)) {
    canvasEdges.push({
      id: `e_${u}_${v}`,
      fromNode: `n_${u}`,
      toNode: `n_${v}`,
      label,
    });
  }

  const canvasData = { nodes: canvasNodes, edges: canvasEdges };
  fs.writeFileSync(outputPath, JSON.stringify(canvasData, null, 2), "utf-8");
}
