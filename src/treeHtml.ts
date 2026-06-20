// treeHtml -- emit a D3 v7 collapsible-tree HTML view of a graph.
// Ported from graphify/tree_html.py (583 lines).

import * as fs from "fs";
import * as path from "path";

export const DEFAULT_MAX_CHILDREN = 200;

export interface TreeNode {
  name: string;
  total_count: number;
  children: TreeNode[];
}

// ── HTML-escape helper ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Tree builder ────────────────────────────────────────────────────────────────

function _commonRoot(paths: string[]): string {
  if (paths.length === 0) return "";
  const parts = paths
    .filter((p) => p)
    .map((p) => p.replace(/\\/g, "/").split("/"));
  if (parts.length === 0) return "";
  let common = parts[0];
  for (const p of parts.slice(1)) {
    let i = 0;
    while (i < common.length && i < p.length && common[i] === p[i]) {
      i++;
    }
    common = common.slice(0, i);
  }
  return common.length > 0 ? common.join("/") : "";
}

function _makeTruncationLeaf(extra: number): TreeNode {
  return { name: `(+${extra} more)`, total_count: extra, children: [] };
}

export function buildTree(
  graph: Record<string, unknown>,
  opts?: { root?: string; maxChildren?: number; projectLabel?: string },
): TreeNode {
  const root = opts?.root;
  const maxChildren = opts?.maxChildren ?? DEFAULT_MAX_CHILDREN;
  const projectLabel = opts?.projectLabel;

  const nodes = (graph["nodes"] as Array<Record<string, unknown>>) ?? [];
  const fileNodes = nodes.filter(
    (n) => n["source_file"] && String(n["source_file"]).length > 0,
  );
  if (fileNodes.length === 0) {
    return { name: "(empty graph)", total_count: 0, children: [] };
  }

  const resolvedRoot = root ?? _commonRoot(
    fileNodes.map((n) => String(n["source_file"])),
  );

  // Group by file
  const byFile: Record<string, Array<Record<string, unknown>>> = {};
  for (const n of fileNodes) {
    const sf = String(n["source_file"]);
    if (!byFile[sf]) byFile[sf] = [];
    byFile[sf].push(n);
  }

  // Build dir tree
  const dirIndex: Record<string, TreeNode> = {};
  const labelRoot =
    projectLabel || (resolvedRoot ? resolvedRoot.split("/").pop() : resolvedRoot) || "/";
  const rootNode: TreeNode = {
    name: labelRoot ?? "/",
    total_count: 0,
    children: [],
  };
  dirIndex[resolvedRoot || "/"] = rootNode;

  function ensureDir(absPath: string): TreeNode {
    const key = absPath;
    if (key in dirIndex) return dirIndex[key];
    const parentPath = absPath.substring(0, absPath.lastIndexOf("/")) || resolvedRoot || "/";
    if (absPath === parentPath) return rootNode;
    const parent = ensureDir(parentPath);
    const dirName = absPath.substring(absPath.lastIndexOf("/") + 1);
    const node: TreeNode = { name: dirName, total_count: 0, children: [] };
    dirIndex[key] = node;
    parent.children.push(node);
    return node;
  }

  const sortedFiles = Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b));

  for (const [srcFile, syms] of sortedFiles) {
    const srcPath = srcFile.replace(/\\/g, "/");
    let parentPath: string;
    if (resolvedRoot && srcPath.startsWith(resolvedRoot + "/")) {
      const rel = srcPath.slice(resolvedRoot.length + 1);
      parentPath = (resolvedRoot + "/" + rel).substring(
        0,
        (resolvedRoot + "/" + rel).lastIndexOf("/"),
      );
      if (!parentPath) parentPath = resolvedRoot;
    } else {
      parentPath = resolvedRoot || "/";
    }
    const parentDir = ensureDir(parentPath);

    // File node
    const srcFileName = srcPath.split("/").pop()!;
    const symChildren: TreeNode[] = [];
    for (const n of syms) {
      const label = (n["label"] as string) ?? (n["id"] as string) ?? "?";
      // Skip the redundant file-name node
      if (label === srcFileName && n["file_type"] === "code") continue;
      symChildren.push({ name: label, total_count: 1, children: [] });
    }
    // Sort: code symbols first by name, then anything else
    symChildren.sort((a, b) => {
      const aPrivate = a.name.startsWith("_") ? 1 : 0;
      const bPrivate = b.name.startsWith("_") ? 1 : 0;
      if (aPrivate !== bPrivate) return aPrivate - bPrivate;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    if (symChildren.length > maxChildren) {
      const extra = symChildren.length - maxChildren;
      symChildren.length = maxChildren;
      symChildren.push(_makeTruncationLeaf(extra));
    }
    const fileNode: TreeNode = {
      name: srcFileName,
      total_count: symChildren.length || 1,
      children: symChildren,
    };
    parentDir.children.push(fileNode);
  }

  // Sort each dir's children + propagate total_count up
  function finalise(d: TreeNode): number {
    const kids = d.children || [];
    kids.sort((a, b) => {
      const aHasKids = a.children && a.children.length > 0 ? 0 : 1;
      const bHasKids = b.children && b.children.length > 0 ? 0 : 1;
      if (aHasKids !== bHasKids) return aHasKids - bHasKids;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    if (kids.length === 0) return d.total_count || 1;
    let n = 0;
    for (const c of kids) n += finalise(c);
    d.total_count = n || 1;
    return d.total_count;
  }

  finalise(rootNode);
  return rootNode;
}

// ── HTML emitter ────────────────────────────────────────────────────────────────

const _HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{title}</title>
  <style>
    body {
      font-family: 'Segoe UI', sans-serif;
      margin: 0;
      padding: 0;
      background: #f9f9f9;
      color: #333;
    }
    h1 {
      margin: 20px 0 0 24px;
      font-size: 2.2rem;
      font-weight: bold;
      color: #1e3a56;
    }
    .controls {
      margin: 20px 0 15px 24px;
    }
    button {
      margin-right: 10px;
      padding: 8px 18px;
      background: #007bff;
      color: #fff;
      border: none;
      border-radius: 5px;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.2s ease-in-out;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    button:hover {
      background: #0056b3;
    }
    button:active {
      background: #004085;
    }
    #tree-container {
      width: calc(100vw - 48px);
      height: 85vh;
      overflow: auto;
      border-radius: 8px;
      background: #fff;
      margin-left: 24px;
      margin-right: 24px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      border: 1px solid #ddd;
    }
    svg {
      background: #fff;
      border-radius: 8px;
      display: block;
    }
    .node circle {
      stroke-width: 2.5px;
    }
    .node text {
      font: 13px 'Segoe UI', sans-serif;
      paint-order: stroke fill;
      stroke: #fff;
      stroke-width: 3px;
      stroke-linejoin: round;
      stroke-opacity: 0.85;
    }
    .link {
      fill: none;
      stroke-opacity: 0.7;
      stroke-width: 2px;
    }
  </style>
</head>
<body>
  <h1>{header}</h1>
  <div class="controls">
    <button onclick="expandAll()">Expand All</button>
    <button onclick="collapseAll()">Collapse All</button>
    <button onclick="resetView()">Reset View</button>
  </div>
  <div id="tree-container">
    <svg id="tree-svg" width="{svg_width}" height="{svg_height}"></svg>
  </div>

  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script>
    const initialJsonData = {data_json};

    function transformData(jsonData) {
        function processNode(node, parentL1StageName) {
            let displayName = node.name;
            if (node.total_count !== undefined) {
                if (!/\\(Total Count: \\d+\\)$/.test(displayName)) {
                    displayName += \` (Total Count: \${node.total_count})\`;
                }
            }

            const newNode = { name: displayName };

            if (parentL1StageName === "Root") {
                 newNode.originalStageName = node.name;
            } else {
                newNode.originalStageName = parentL1StageName;
            }

            if (node.children && node.children.length > 0) {
                const stageNameToPass = (parentL1StageName === "Root") ? node.name : parentL1StageName;
                newNode.children = node.children.map(child => processNode(child, stageNameToPass));
            }

            return newNode;
        }

        let rootDisplayName = jsonData.name;
        if (jsonData.total_count !== undefined && !/\\(Total Count: \\d+\\)$/.test(rootDisplayName)) {
            rootDisplayName += \` (Total Count: \${jsonData.total_count})\`;
        }

        return {
            name: rootDisplayName,
            originalStageName: "Root",
            children: (jsonData.children || []).map(child => processNode(child, "Root"))
        };
    }

    const treeData = transformData(initialJsonData);

    const PALETTE = [
      ["#3498DB","#2980B9","#AED6F1"], ["#2ECC71","#27AE60","#A9DFBF"],
      ["#E74C3C","#C0392B","#F5B7B1"], ["#9B59B6","#8E44AD","#D7BDE2"],
      ["#F39C12","#D68910","#FAD7A0"], ["#1ABC9C","#117864","#A2D9CE"],
      ["#34495E","#1B2631","#ABB2B9"], ["#E67E22","#BA4A00","#F5CBA7"],
      ["#16A085","#0E6655","#A2D9CE"], ["#D35400","#A04000","#EDBB99"],
      ["#7F8C8D","#566573","#D5DBDB"], ["#C0392B","#7B241C","#F5B7B1"],
      ["#2E86C1","#1B4F72","#A9CCE3"], ["#28B463","#196F3D","#A9DFBF"],
      ["#AF7AC5","#6C3483","#D2B4DE"],
    ];
    const phaseColors = { "Root": { fill: "#4A4A4A", stroke: "#333333", collapsedFill: "#6C757D" },
                          "Default": { fill: "#BDC3C7", stroke: "#95A5A6", collapsedFill: "#ECF0F1" } };
    (initialJsonData.children || []).forEach((c, i) => {
      const pal = PALETTE[i % PALETTE.length];
      phaseColors[c.name] = { fill: pal[0], stroke: pal[1], collapsedFill: pal[2] };
    });

    const levelSpecificPalettes = {
      0: { fill: "#4A4A4A", stroke: "#333333", collapsedFill: "#6C757D" },
      2: { fill: "#6ab04c", stroke: "#508a38", collapsedFill: "#a3d391" },
      3: { fill: "#f0932b", stroke: "#d0730f", collapsedFill: "#f6c07e" },
      4: { fill: "#be2edd", stroke: "#a01cb3", collapsedFill: "#e08bf2" },
      5: { fill: "#00a8ff", stroke: "#007ac1", collapsedFill: "#74d2ff" },
      6: { fill: "#e55039", stroke: "#c23620", collapsedFill: "#f09a8d" },
      default: { fill: "#747d8c", stroke: "#57606f", collapsedFill: "#a4b0be" }
    };

    const svgElement = d3.select("#tree-svg");
    const initialSvgWidth = +svgElement.attr("width");
    const initialSvgHeight = +svgElement.attr("height");
    const margin = { top: 40, right: 120, bottom: 80, left: 450 };
    let width = initialSvgWidth - margin.left - margin.right;
    let height = initialSvgHeight - margin.top - margin.bottom;
    const duration = 500;
    let nodeCounter = 0;
    const g = svgElement.append("g").attr("transform", \`translate(\${margin.left},\${margin.top})\`);
    const treemap = d3.tree().nodeSize([40, 0]);
    let rootNode = d3.hierarchy(treeData, d => d.children);
    rootNode.x0 = 0;
    rootNode.y0 = 0;

    if (rootNode.children) {
      rootNode.children.forEach(d_child => {
        if (d_child.children) { collapseBranch(d_child); }
      });
    }
    updateTree(rootNode);

    function collapseBranch(d) { if (d.children) { d._children = d.children; d._children.forEach(collapseBranch); d.children = null; } }
    function expandBranch(d) { if (d._children) { d.children = d._children; d._children = null; } if (d.children) { d.children.forEach(expandBranch); } }
    window.expandAll = () => { expandBranch(rootNode); updateTree(rootNode); };
    window.collapseAll = () => { if (rootNode.children) { rootNode.children.forEach(collapseBranch); } updateTree(rootNode); };
    window.resetView = () => { if (rootNode.children) { rootNode.children.forEach(d_child => { if (d_child.children || d_child._children) { collapseBranch(d_child); } }); } if (rootNode._children && !rootNode.children) { rootNode.children = rootNode._children; rootNode._children = null; } updateTree(rootNode); };

    function updateTree(source) {
      const treeLayoutData = treemap(rootNode);
      let nodes = treeLayoutData.descendants();
      let links = treeLayoutData.descendants().slice(1);

      let minX = 0;
      let maxX = 0;
      if (nodes.length > 0) {
        minX = d3.min(nodes, d => d.x);
        maxX = d3.max(nodes, d => d.x);
      }

      let neededHeight = Math.max(initialSvgHeight, maxX - minX + margin.top + margin.bottom + 100);
      svgElement.transition().duration(duration / 2).attr("height", neededHeight);
      g.transition().duration(duration / 2).attr("transform", \`translate(\${margin.left},\${margin.top - minX + 40})\`);

      nodes.forEach(d => { d.y = d.depth * 400; });

      const node = g.selectAll('g.node').data(nodes, d => d.id || (d.id = ++nodeCounter));
      const nodeEnter = node.enter().append('g')
        .attr('class', d => "node" + (d.children || d._children ? " node--internal" : " node--leaf") + (d._children ? " _children" : ""))
        .attr('transform', d => \`translate(\${source.y0},\${source.x0})\`)
        .on('click', (event, d) => { if (d.children) { d._children = d.children; d.children = null; } else if (d._children) { d.children = d._children; d._children = null; } updateTree(d); })
        .style('cursor', d => (d.children || d._children) ? 'pointer' : 'default');

      nodeEnter.append('circle').attr('r', 1e-6);

      nodeEnter.append('text')
        .attr('dy', '.35em')
        .attr('x', d => d.children || d._children ? -14 : 14)
        .attr('text-anchor', d => d.children || d._children ? 'end' : 'start')
        .style("fill-opacity", 1e-6)
        .call(wrapText, 380);

      const nodeUpdate = nodeEnter.merge(node);
      nodeUpdate.transition().duration(duration)
        .attr('transform', d => \`translate(\${d.y},\${d.x})\`)
        .attr('class', d => "node" + (d.children ? " node--internal" : " node--leaf") + (d._children ? " node--internal _children" : ""));

      nodeUpdate.select('circle').attr('r', 8.5)
        .style('fill', d => {
            let palette;
            if (d.depth === 0) {
                palette = levelSpecificPalettes[0];
            } else if (d.depth === 1) {
                palette = phaseColors[d.data.originalStageName] || phaseColors.Default;
            } else {
                palette = levelSpecificPalettes[d.depth] || levelSpecificPalettes.default;
            }
            if (d._children) return palette.collapsedFill;
            if (d.children) return palette.fill;
            return "#fff";
        })
        .style('stroke', d => {
            let palette;
            if (d.depth === 0) {
                palette = levelSpecificPalettes[0];
            } else if (d.depth === 1) {
                palette = phaseColors[d.data.originalStageName] || phaseColors.Default;
            } else {
                palette = levelSpecificPalettes[d.depth] || levelSpecificPalettes.default;
            }
            return palette.stroke;
        });
      nodeUpdate.select('text').style("fill-opacity", 1).call(wrapText, 380);

      const nodeExit = node.exit().transition().duration(duration).attr('transform', d => \`translate(\${source.y},\${source.x})\`).remove();
      nodeExit.select('circle').attr('r', 1e-6);
      nodeExit.select('text').style('fill-opacity', 1e-6);

      const link = g.selectAll('path.link').data(links, d => d.id);
      const linkEnter = link.enter().insert('path', "g").attr('class', 'link').attr('d', d => { const o = { x: source.x0, y: source.y0 }; return diagonal(o, o); });

      linkEnter.merge(link).transition().duration(duration).attr('d', d => diagonal(d, d.parent))
        .style('stroke', d => {
            const sourceNode = d.parent;
            if (!sourceNode) return phaseColors.Default.stroke;
            const l1AncestorName = sourceNode.data.originalStageName;
            const colorPalette = phaseColors[l1AncestorName] || phaseColors.Default;
            return colorPalette.stroke;
        });
      link.exit().transition().duration(duration).attr('d', d => { const o = { x: source.x, y: source.y }; return diagonal(o, o); }).remove();
      nodes.forEach(d => { d.x0 = d.x; d.y0 = d.y; });
    }

    function diagonal(s, d) { return \`M \${s.y} \${s.x} C \${(s.y + d.y) / 2} \${s.x}, \${(s.y + d.y) / 2} \${d.x}, \${d.y} \${d.x}\`; }

    function wrapText(textElements, maxWidth) {
        const textPartColors = {
            name: '#343a40',
            count: '#0056b3'
        };
        const countRegex = /(\\s\\(Total Count: \\d+\\))$/;

        textElements.each(function () {
            const textD3 = d3.select(this);
            const originalNodeText = textD3.datum().data.name;
            const x = parseFloat(textD3.attr("x") || 0);
            const initialDy = textD3.attr("dy");
            const textAnchor = textD3.attr("text-anchor");
            const lineHeight = 1.1;

            textD3.text(null);

            let namePart = originalNodeText;
            let countPartText = "";

            const countMatch = originalNodeText.match(countRegex);
            if (countMatch && originalNodeText.endsWith(countMatch[0])) {
                namePart = originalNodeText.substring(0, originalNodeText.length - countMatch[0].length).trim();
                countPartText = countMatch[0].trim();
            }

            const tokens = [];
            namePart.split(/\\s+/).filter(Boolean).forEach(word => {
                tokens.push({ text: word, type: 'name' });
            });
            if (countPartText) {
                tokens.push({ text: countPartText, type: 'count' });
            }

            if (tokens.length === 0 && originalNodeText) {
                tokens.push({ text: originalNodeText, type: 'name' });
            }

            let currentTspan = textD3.append("tspan").attr("x", x).attr("dy", initialDy);
            if (textAnchor === "end") currentTspan.attr("text-anchor", "end");

            let lineTokens = [];

            for (let i = 0; i < tokens.length; i++) {
                const tokenObj = tokens[i];

                lineTokens.push(tokenObj);
                currentTspan.text(lineTokens.map(t => t.text).join(" "));

                if (currentTspan.node().getComputedTextLength() > maxWidth && lineTokens.length > 1) {
                    lineTokens.pop();

                    currentTspan.text(null);
                    lineTokens.forEach((prevToken, idx) => {
                        currentTspan.append("tspan")
                            .text((idx > 0 ? " " : "") + prevToken.text)
                            .style("fill", textPartColors[prevToken.type] || textPartColors.name)
                            .style("font-weight", prevToken.type === 'count' ? "bold" : "normal");
                    });

                    lineTokens = [tokenObj];
                    currentTspan = textD3.append("tspan").attr("x", x).attr("dy", lineHeight + "em");
                    if (textAnchor === "end") currentTspan.attr("text-anchor", "end");
                }
            }

            currentTspan.text(null);
            lineTokens.forEach((token, idx) => {
                currentTspan.append("tspan")
                    .text((idx > 0 ? " " : "") + token.text)
                    .style("fill", textPartColors[token.type] || textPartColors.name)
                    .style("font-weight", token.type === 'count' ? "bold" : "normal");
            });

            if (textD3.selectAll("tspan > tspan").empty() && textD3.select("tspan").text().length === 0 && originalNodeText) {
                let t = textD3.select("tspan");
                let displayText = originalNodeText;
                t.text(displayText).style("fill", textPartColors.name);
                if (t.node() && t.node().getComputedTextLength() > maxWidth && displayText.length > 20) {
                    let estimatedChars = Math.floor(maxWidth / (t.node().getComputedTextLength()/displayText.length) );
                    displayText = displayText.substring(0, Math.max(0, estimatedChars - 3)) + "...";
                    t.text(displayText);
                }
            }
        });
    }
  </script>
</body>
</html>
`;

export function emitHtml(
  tree: TreeNode,
  opts: { title: string; header: string; svgWidth?: number; svgHeight?: number },
): string {
  const dataJson = JSON.stringify(tree)
    .replace(/<\//g, "<\\/");

  return _HTML_TEMPLATE
    .replace("{title}", escapeHtml(opts.title))
    .replace("{header}", escapeHtml(opts.header))
    .replace("{svg_width}", String(opts.svgWidth ?? 6000))
    .replace("{svg_height}", String(opts.svgHeight ?? 8000))
    .replace("{data_json}", dataJson);
}

export function writeTreeHtml(
  graphPath: string,
  outputPath: string,
  opts?: { root?: string; maxChildren?: number; projectLabel?: string },
): string {
  // Inline file-size cap: 200 MiB
  const stat = fs.statSync(graphPath);
  const maxBytes = 200 * 1024 * 1024;
  if (stat.size > maxBytes) {
    throw new Error(`graph file too large (${Math.round(stat.size / 1024 / 1024)} MiB > 200 MiB cap): ${graphPath}`);
  }
  const graphRaw = fs.readFileSync(graphPath, "utf-8");
  const graph = JSON.parse(graphRaw);
  const tree = buildTree(graph, opts);
  const title = `${tree.name} -- graphify tree viewer`;
  const header = `${tree.name} -- Knowledge Graph`;
  const html = emitHtml(tree, { title, header });
  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, html, "utf-8");
  return outputPath;
}

// Export escapeHtml for testing
export { escapeHtml };
