import type Graph from "graphology";
import { DirectedGraph } from "graphology";
import * as fs from "fs";
import * as path from "path";
import { nodeCommunityMap } from "../analyze.js";
import { degree, neighbors } from "../graph/operations.js";
import { sanitizeLabel } from "./obsidian.js";

export const COMMUNITY_COLORS = [
  "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F",
  "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC",
];

export const MAX_NODES_FOR_VIZ = 5_000;

/** Return the effective viz node limit, honoring GRAPHIFY_VIZ_NODE_LIMIT env var. */
export function vizNodeLimit(): number {
  const raw = process.env.GRAPHIFY_VIZ_NODE_LIMIT;
  if (raw === undefined || raw.trim() === "") return MAX_NODES_FOR_VIZ;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) return MAX_NODES_FOR_VIZ;
  return parsed;
}

/** HTML CSS styles for vis.js visualization. */
export function htmlStyles(): string {
  return `<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0f1a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; height: 100vh; overflow: hidden; }
  #graph { flex: 1; }
  #sidebar { width: 280px; background: #1a1a2e; border-left: 1px solid #2a2a4e; display: flex; flex-direction: column; overflow: hidden; }
  #search-wrap { padding: 12px; border-bottom: 1px solid #2a2a4e; }
  #search { width: 100%; background: #0f0f1a; border: 1px solid #3a3a5e; color: #e0e0e0; padding: 7px 10px; border-radius: 6px; font-size: 13px; outline: none; }
  #search:focus { border-color: #4E79A7; }
  #search-results { max-height: 140px; overflow-y: auto; padding: 4px 12px; border-bottom: 1px solid #2a2a4e; display: none; }
  .search-item { padding: 4px 6px; cursor: pointer; border-radius: 4px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .search-item:hover { background: #2a2a4e; }
  #info-panel { padding: 14px; border-bottom: 1px solid #2a2a4e; min-height: 140px; }
  #info-panel h3 { font-size: 13px; color: #aaa; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
  #info-content { font-size: 13px; color: #ccc; line-height: 1.6; }
  #info-content .field { margin-bottom: 5px; }
  #info-content .field b { color: #e0e0e0; }
  #info-content .empty { color: #555; font-style: italic; }
  .neighbor-link { display: block; padding: 2px 6px; margin: 2px 0; border-radius: 3px; cursor: pointer; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-left: 3px solid #333; }
  .neighbor-link:hover { background: #2a2a4e; }
  #neighbors-list { max-height: 160px; overflow-y: auto; margin-top: 4px; }
  #legend-wrap { flex: 1; overflow-y: auto; padding: 12px; }
  #legend-wrap h3 { font-size: 13px; color: #aaa; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  .legend-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; border-radius: 4px; font-size: 12px; }
  .legend-item:hover { background: #2a2a4e; padding-left: 4px; }
  .legend-item.dimmed { opacity: 0.35; }
  .legend-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .legend-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend-count { color: #666; font-size: 11px; }
  #stats { padding: 10px 14px; border-top: 1px solid #2a2a4e; font-size: 11px; color: #555; }
  #legend-controls { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 4px 0; }
  #legend-controls label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: #aaa; user-select: none; }
  #legend-controls label:hover { color: #e0e0e0; }
  .legend-cb, #select-all-cb { appearance: none; -webkit-appearance: none; width: 14px; height: 14px; border: 1.5px solid #3a3a5e; border-radius: 3px; background: #0f0f1a; cursor: pointer; position: relative; flex-shrink: 0; }
  .legend-cb:checked, #select-all-cb:checked { background: #4E79A7; border-color: #4E79A7; }
  .legend-cb:checked::after, #select-all-cb:checked::after { content: ''; position: absolute; left: 3.5px; top: 1px; width: 4px; height: 7px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
  #select-all-cb:indeterminate { background: #4E79A7; border-color: #4E79A7; }
  #select-all-cb:indeterminate::after { content: ''; position: absolute; left: 2px; top: 5px; width: 8px; height: 2px; background: #fff; border: none; transform: none; }
</style>`;
}

/** Hyperedge rendering script for vis.js. */
export function hyperedgeScript(hyperedgesJson: string): string {
  return `<script>
// Render hyperedges as shaded regions
const hyperedges = ${hyperedgesJson};
// afterDrawing passes ctx already transformed to network coordinate space.
// Draw node positions raw — no manual pan/zoom/DPR math needed.
network.on('afterDrawing', function(ctx) {
    hyperedges.forEach(h => {
        const positions = h.nodes
            .map(nid => network.getPositions([nid])[nid])
            .filter(p => p !== undefined);
        if (positions.length < 2) return;
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = '#6366f1';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Centroid and expanded hull in network coordinates
        const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
        const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;
        const expanded = positions.map(p => ({
            x: cx + (p.x - cx) * 1.15,
            y: cy + (p.y - cy) * 1.15
        }));
        ctx.moveTo(expanded[0].x, expanded[0].y);
        expanded.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.4;
        ctx.stroke();
        // Label
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#4f46e5';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(h.label, cx, cy - 5);
        ctx.restore();
    });
});
</script>`;
}

/** vis.js interactive script for the HTML visualization. */
export function htmlScript(nodesJson: string, edgesJson: string, legendJson: string): string {
  return `<script>
const RAW_NODES = ${nodesJson};
const RAW_EDGES = ${edgesJson};
const LEGEND = ${legendJson};

// HTML-escape helper — prevents XSS when injecting graph data into innerHTML
function esc(s) {
  return String(s).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"').replace(/'/g,''');
}

// Build vis datasets
const nodesDS = new vis.DataSet(RAW_NODES.map(n => ({
  id: n.id, label: n.label, color: n.color, size: n.size,
  font: n.font, title: n.title,
  _community: n.community, _community_name: n.community_name,
  _source_file: n.source_file, _file_type: n.file_type, _degree: n.degree,
})));

const edgesDS = new vis.DataSet(RAW_EDGES.map((e, i) => ({
  id: i, from: e.from, to: e.to,
  label: '',
  title: e.title,
  dashes: e.dashes,
  width: e.width,
  color: e.color,
  arrows: { to: { enabled: true, scaleFactor: 0.5 } },
})));

const container = document.getElementById('graph');
const network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: {
      gravitationalConstant: -60,
      centralGravity: 0.005,
      springLength: 120,
      springConstant: 0.08,
      damping: 0.4,
      avoidOverlap: 0.8,
    },
    stabilization: { iterations: 200, fit: true },
  },
  interaction: {
    hover: true,
    tooltipDelay: 100,
    hideEdgesOnDrag: true,
    navigationButtons: false,
    keyboard: false,
  },
  nodes: { shape: 'dot', borderWidth: 1.5 },
  edges: { smooth: { type: 'continuous', roundness: 0.2 }, selectionWidth: 3 },
});

network.once('stabilizationIterationsDone', () => {
  network.setOptions({ physics: { enabled: false } });
});

function showInfo(nodeId) {
  const n = nodesDS.get(nodeId);
  if (!n) return;
  const neighborIds = network.getConnectedNodes(nodeId);
  const neighborItems = neighborIds.map(nid => {
    const nb = nodesDS.get(nid);
    const color = nb ? nb.color.background : '#555';
    return \`<span class="neighbor-link" style="border-left-color:\${esc(color)}" onclick="focusNode(\${JSON.stringify(nid)})">\${esc(nb ? nb.label : nid)}</span>\`;
  }).join('');
  document.getElementById('info-content').innerHTML = \`
    <div class="field"><b>\${esc(n.label)}</b></div>
    <div class="field">Type: \${esc(n._file_type || 'unknown')}</div>
    <div class="field">Community: \${esc(n._community_name)}</div>
    <div class="field">Source: \${esc(n._source_file || '-')}</div>
    <div class="field">Degree: \${n._degree}</div>
    \${neighborIds.length ? \`<div class="field" style="margin-top:8px;color:#aaa;font-size:11px">Neighbors (\${neighborIds.length})</div><div id="neighbors-list">\${neighborItems}</div>\` : ''}
  \`;
}

function focusNode(nodeId) {
  network.focus(nodeId, { scale: 1.4, animation: true });
  network.selectNodes([nodeId]);
  showInfo(nodeId);
}

// Track hovered node — hover detection is more reliable than click params
let hoveredNodeId = null;
network.on('hoverNode', params => {
  hoveredNodeId = params.node;
  container.style.cursor = 'pointer';
});
network.on('blurNode', () => {
  hoveredNodeId = null;
  container.style.cursor = 'default';
});
container.addEventListener('click', () => {
  if (hoveredNodeId !== null) {
    showInfo(hoveredNodeId);
    network.selectNodes([hoveredNodeId]);
  }
});
network.on('click', params => {
  if (params.nodes.length > 0) {
    showInfo(params.nodes[0]);
  } else if (hoveredNodeId === null) {
    document.getElementById('info-content').innerHTML = '<span class="empty">Click a node to inspect it</span>';
  }
});

const searchInput = document.getElementById('search');
const searchResults = document.getElementById('search-results');
searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase().trim();
  searchResults.innerHTML = '';
  if (!q) { searchResults.style.display = 'none'; return; }
  const matches = RAW_NODES.filter(n => n.label.toLowerCase().includes(q)).slice(0, 20);
  if (!matches.length) { searchResults.style.display = 'none'; return; }
  searchResults.style.display = 'block';
  matches.forEach(n => {
    const el = document.createElement('div');
    el.className = 'search-item';
    el.textContent = n.label;
    el.style.borderLeft = \`3px solid \${n.color.background}\`;
    el.style.paddingLeft = '8px';
    el.onclick = () => {
      network.focus(n.id, { scale: 1.5, animation: true });
      network.selectNodes([n.id]);
      showInfo(n.id);
      searchResults.style.display = 'none';
      searchInput.value = '';
    };
    searchResults.appendChild(el);
  });
});
document.addEventListener('click', e => {
  if (!searchResults.contains(e.target) && e.target !== searchInput)
    searchResults.style.display = 'none';
});

const hiddenCommunities = new Set();

const selectAllCb = document.getElementById('select-all-cb');

function updateSelectAllState() {
  const total = LEGEND.length;
  const hidden = hiddenCommunities.size;
  selectAllCb.checked = hidden === 0;
  selectAllCb.indeterminate = hidden > 0 && hidden < total;
}

function toggleAllCommunities(hide) {
  document.querySelectorAll('.legend-item').forEach(item => {
    hide ? item.classList.add('dimmed') : item.classList.remove('dimmed');
  });
  document.querySelectorAll('.legend-cb').forEach(cb => {
    cb.checked = !hide;
  });
  LEGEND.forEach(c => {
    if (hide) hiddenCommunities.add(c.cid); else hiddenCommunities.delete(c.cid);
  });
  const updates = RAW_NODES.map(n => ({ id: n.id, hidden: hide }));
  nodesDS.update(updates);
  updateSelectAllState();
}

const legendEl = document.getElementById('legend');
LEGEND.forEach(c => {
  const item = document.createElement('div');
  item.className = 'legend-item';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'legend-cb';
  cb.checked = true;
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    if (cb.checked) {
      hiddenCommunities.delete(c.cid);
      item.classList.remove('dimmed');
    } else {
      hiddenCommunities.add(c.cid);
      item.classList.add('dimmed');
    }
    const updates = RAW_NODES
      .filter(n => n.community === c.cid)
      .map(n => ({ id: n.id, hidden: !cb.checked }));
    nodesDS.update(updates);
    updateSelectAllState();
  });
  item.innerHTML = \`<div class="legend-dot" style="background:\${c.color}"></div>
    <span class="legend-label">\${c.label}</span>
    <span class="legend-count">\${c.count}</span>\`;
  item.prepend(cb);
  item.onclick = (e) => {
    if (e.target === cb) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change'));
  };
  legendEl.appendChild(item);
});
</script>`;
}

/** Escape </script> sequences so embedded JSON cannot break out of the script tag */
function jsSafe(obj: unknown): string {
  return JSON.stringify(obj).replace(/<\//g, "<\\/");
}

/** Simple HTML escape for attribute values in the HTML template. */
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;")
    .replace(/'/g, "\u0026#39;");
}

/** Generate an interactive vis.js HTML visualization of the graph.
 *
 * Features: node size by degree, click-to-inspect panel, search box,
 * community filter, physics clustering by community, confidence-styled edges.
 * Raises ValueError if graph exceeds MAX_NODES_FOR_VIZ.
 */
export function toHtml(
  graph: Graph,
  communities: Record<number, string[]>,
  outputPath: string,
  options?: {
    communityLabels?: Record<number, string>;
    memberCounts?: Record<number, number>;
    nodeLimit?: number;
  }
): void {
  const { communityLabels, memberCounts, nodeLimit } = options ?? {};
  const limit = nodeLimit !== undefined ? nodeLimit : vizNodeLimit();

  if (graph.order > limit) {
    if (nodeLimit !== undefined) {
      // Build aggregated community meta-graph
      console.log(`Graph has ${graph.order} nodes (above ${limit} limit). Building aggregated community view...`);
      const nodeToCommunity: Record<string, number> = {};
      for (const [cid, members] of Object.entries(communities)) {
        for (const nid of members) {
          nodeToCommunity[nid] = Number(cid);
        }
      }
      const meta = new DirectedGraph();
      for (const [cid, members] of Object.entries(communities)) {
        meta.addNode(String(cid), {
          label: (communityLabels ?? {})[Number(cid)] ?? `Community ${cid}`,
        });
      }
      // Count cross-community edges
      const edgeCounts: Record<string, number> = {};
      graph.forEachEdge((_edge: string, _attrs: Record<string, unknown>, u: string, v: string) => {
        const cu = nodeToCommunity[u];
        const cv = nodeToCommunity[v];
        if (cu !== undefined && cv !== undefined && cu !== cv) {
          const key = `${Math.min(cu, cv)}_${Math.max(cu, cv)}`;
          edgeCounts[key] = (edgeCounts[key] ?? 0) + 1;
        }
      });
      for (const [key, w] of Object.entries(edgeCounts)) {
        const [cu, cv] = key.split("_").map(Number);
        meta.addEdge(String(cu), String(cv), {
          weight: w,
          relation: `${w} cross-community edges`,
          confidence: "AGGREGATED",
        });
      }
      if (meta.order <= 1) {
        console.log("Single community - aggregated view not useful. Skipping graph.html.");
        return;
      }
      const metaCommunities: Record<number, string[]> = {};
      for (const cid of Object.keys(communities).map(Number)) {
        metaCommunities[cid] = [String(cid)];
      }
      const mc: Record<number, number> = {};
      for (const [cid, members] of Object.entries(communities)) {
        mc[Number(cid)] = members.length;
      }
      // Remap hyperedges from semantic node IDs to community IDs
      const rawHyperedges = (graph.getAttribute("hyperedges") as Record<string, unknown>[]) ?? [];
      if (rawHyperedges.length) {
        const remapped: Record<string, unknown>[] = [];
        for (const he of rawHyperedges) {
          const heMembers = (he["nodes"] as string[]) ?? (he["members"] as string[]) ?? [];
          const commIds: string[] = [];
          const seen = new Set<string>();
          for (const nid of heMembers) {
            const c = nodeToCommunity[nid];
            if (c === undefined) continue;
            const s = String(c);
            if (seen.has(s)) continue;
            seen.add(s);
            commIds.push(s);
          }
          if (commIds.length < 2) continue;
          remapped.push({
            id: (he["id"] as string) ?? "",
            label: (he["label"] as string) ?? ((he["relation"] as string) ?? "").replace(/_/g, " "),
            nodes: commIds,
          });
        }
        meta.setAttribute("hyperedges", remapped);
      }
      toHtml(meta, metaCommunities, outputPath, {
        communityLabels,
        memberCounts: mc,
      });
      console.log(`graph.html written (aggregated: ${meta.order} community nodes, ${meta.size} cross-community edges)`);
      console.log("Tip: run with --obsidian for full node-level detail.");
      return;
    }
    throw new Error(
      `Graph has ${graph.order} nodes - too large for HTML viz ` +
      `(limit: ${limit}). Use --no-viz, raise GRAPHIFY_VIZ_NODE_LIMIT, ` +
      `or reduce input size.`
    );
  }

  const nodeCommunity = nodeCommunityMap(communities);

  // Compute degree map
  const degMap: Record<string, number> = {};
  graph.forEachNode((node: string) => {
    degMap[node] = degree(graph, node);
  });
  const maxDeg = Math.max(...Object.values(degMap), 1) || 1;
  const maxMc = memberCounts ? Math.max(...Object.values(memberCounts), 1) || 1 : 1;

  // Build nodes list for vis.js
  const visNodes: Record<string, unknown>[] = [];
  for (const nodeId of graph.nodes()) {
    const data = graph.getNodeAttributes(nodeId);
    const cid = nodeCommunity[nodeId] ?? 0;
    const color = COMMUNITY_COLORS[cid % COMMUNITY_COLORS.length];
    const label = sanitizeLabel((data["label"] as string) ?? nodeId);
    const deg = degMap[nodeId] ?? 1;
    let size: number;
    let fontSize: number;
    if (memberCounts) {
      const mc = memberCounts[cid] ?? 1;
      size = 10 + 30 * (mc / maxMc);
      fontSize = 12;
    } else {
      size = 10 + 30 * (deg / maxDeg);
      fontSize = deg >= maxDeg * 0.15 ? 12 : 0;
    }
    visNodes.push({
      id: nodeId,
      label,
      color: { background: color, border: color, highlight: { background: "#ffffff", border: color } },
      size: Math.round(size * 10) / 10,
      font: { size: fontSize, color: "#ffffff" },
      title: htmlEscape(label),
      community: cid,
      community_name: sanitizeLabel((communityLabels ?? {})[cid] ?? `Community ${cid}`),
      source_file: sanitizeLabel(String(data["source_file"] ?? "")),
      file_type: data["file_type"] ?? "",
      degree: deg,
    });
  }

  // Build edges list. Restore original edge direction from _src/_tgt
  const visEdges: Record<string, unknown>[] = [];
  graph.forEachEdge((_edge: string, attrs: Record<string, unknown>, u: string, v: string) => {
    const confidence = (attrs["confidence"] as string) ?? "EXTRACTED";
    const relation = (attrs["relation"] as string) ?? "";
    const trueSrc = (attrs["_src"] as string) ?? u;
    const trueTgt = (attrs["_tgt"] as string) ?? v;
    visEdges.push({
      from: trueSrc,
      to: trueTgt,
      label: relation,
      title: htmlEscape(`${relation} [${confidence}]`),
      dashes: confidence !== "EXTRACTED",
      width: confidence === "EXTRACTED" ? 2 : 1,
      color: { opacity: confidence === "EXTRACTED" ? 0.7 : 0.35 },
      confidence,
    });
  });

  // Build community legend data
  const legendData: Record<string, unknown>[] = [];
  for (const cid of Object.keys(communityLabels ?? {}).map(Number).sort((a, b) => a - b)) {
    const color = COMMUNITY_COLORS[cid % COMMUNITY_COLORS.length];
    const lbl = htmlEscape(sanitizeLabel((communityLabels ?? {})[cid] ?? `Community ${cid}`));
    const n = memberCounts
      ? (memberCounts[cid] ?? (communities[cid] ?? []).length)
      : (communities[cid] ?? []).length;
    legendData.push({ cid, color, label: lbl, count: n });
  }

  const hyperedgesJson = jsSafe((graph.getAttribute("hyperedges") as Record<string, unknown>[]) ?? []);
  const title = htmlEscape(sanitizeLabel(String(outputPath)));
  const stats = `${graph.order} nodes &middot; ${graph.size} edges &middot; ${Object.keys(communities).length} communities`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>graphify - ${title}</title>
<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"
        integrity="sha384-Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1"
        crossorigin="anonymous"></script>
${htmlStyles()}
</head>
<body>
<div id="graph"></div>
<div id="sidebar">
  <div id="search-wrap">
    <input id="search" type="text" placeholder="Search nodes..." autocomplete="off">
    <div id="search-results"></div>
  </div>
  <div id="info-panel">
    <h3>Node Info</h3>
    <div id="info-content"><span class="empty">Click a node to inspect it</span></div>
  </div>
  <div id="legend-wrap">
    <h3>Communities</h3>
    <div id="legend-controls">
      <label><input type="checkbox" id="select-all-cb" checked onchange="toggleAllCommunities(!this.checked)">Select All</label>
    </div>
    <div id="legend"></div>
  </div>
  <div id="stats">${stats}</div>
</div>
${htmlScript(jsSafe(visNodes), jsSafe(visEdges), jsSafe(legendData))}
${hyperedgeScript(hyperedgesJson)}
</body>
</html>`;

  fs.writeFileSync(outputPath, html, "utf-8");
}

/** Backward-compatible alias — skill.md calls generateHtml */
export const generateHtml = toHtml;
