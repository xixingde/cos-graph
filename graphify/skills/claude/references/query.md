# graphify reference: query, path, explain

Load this when the user asks a question against an existing graph, or runs `/graphify path` or `/graphify explain`. The core's query stub points here for the full traversal flow. These flows use the `graphify query` CLI when it is available and fall back to an inline graphology traversal otherwise.

Two traversal modes - choose based on the question:

| Mode | Flag | Best for |
|------|------|----------|
| BFS (default) | _(none)_ | "What is X connected to?" - broad context, nearest neighbors first |
| DFS | `--dfs` | "How does X reach Y?" - trace a specific chain or dependency path |

First check the graph exists:
```bash
$(cat .graphify/.graphify_node) -e "
const fs = require('fs');
if (!fs.existsSync('graphify-out/graph.json')) {
  console.log('ERROR: No graph found. Run /graphify <path> first to build the graph.');
  process.exit(1);
}
"
```
If it fails, stop and tell the user to run `/graphify <path>` first.

### Step 0 — Constrained query expansion (REQUIRED before traversal)

graphify's `query` CLI matches nodes via case-folded substring + IDF — there is **no stemming, no synonyms, no cross-language match** inside the binary, and the inline fallback below matches the same way. If the user's question uses different language or different domain vocabulary than the graph's labels (user says "обработчик" / graph says "handler"; user says "authentication" / graph says "Guardian"), the literal matcher returns 0 hits and the answer collapses to noise.

Fix this **without inventing tokens** by expanding the query against the actual graph vocabulary first:

1. Extract the token vocabulary from node labels:
```bash
$(cat .graphify/.graphify_node) -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('graphify-out/graph.json', 'utf-8'));
const vocab = new Set();
for (const n of data.nodes) {
  const words = (n.label || '').match(/[A-Za-z]+/g) || [];
  for (const w of words) {
    const parts = w.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+/g) || [w];
    for (const p of parts) {
      const t = p.toLowerCase();
      if (t.length >= 3 && t.length <= 30) vocab.add(t);
    }
  }
}
fs.writeFileSync('graphify-out/.vocab.txt', [...vocab].sort().join('\n'));
console.log('vocab: ' + vocab.size + ' tokens');
"
```

2. Read `graphify-out/.vocab.txt`. Then for the user's question, select **up to 12 tokens from this exact list** that semantically match the query intent. Hard constraints:
   - You MUST pick only tokens present in the vocabulary file. Do NOT invent tokens.
   - If a query concept has no plausible token in the vocab, skip it — do not substitute a near-synonym from training memory.
   - If **no** vocab tokens match the query at all, output an empty list and tell the user the corpus has no relevant vocabulary for this question. Do not fabricate a search.
   - Translate cross-language: Russian "аутентификация" → look for `auth`, `credential`, `token`, `security` IFF present in vocab.
   - Morphology: "handlers" maps to `handler` IFF present; "todos" maps to `todo` IFF present.

3. Print the selection explicitly to the user before running the query, so the expansion is auditable:
```
Query expanded to (from graph vocab, N tokens): [token1, token2, ...]
```
If the list is empty, say so plainly and stop — do not proceed to traversal.

### Step 1 — Traversal

Build the **expanded query string** by joining the selected tokens with spaces. Use this string as `QUESTION` below — NOT the original user question. (The original question is preserved only for `save-result` at the end.)

Prefer the CLI when it is installed:
```bash
graphify query "QUESTION"
# or: graphify query "QUESTION" --dfs --budget 3000
```

If the CLI is unavailable, load `graphify-out/graph.json` and run the traversal inline:

1. Find the 1-3 nodes whose label best matches the expanded tokens.
2. Run the appropriate traversal from each starting node.
3. Read the subgraph - node labels, edge relations, confidence tags, source locations.
4. Answer using **only** what the graph contains. Quote `source_location` when citing a specific fact.
5. If the graph lacks enough information, say so - do not hallucinate edges.

```bash
$(cat .graphify/.graphify_node) --input-type=module -e "
import fs from 'fs';
import { GraphologyGraph } from 'graphology';

const data = JSON.parse(fs.readFileSync('graphify-out/graph.json', 'utf-8'));
const G = new GraphologyGraph({ type: 'undirected', multi: false });
for (const n of data.nodes) G.addNode(n.id, n);
for (const e of data.links) G.addEdge(e.source, e.target, e);

const question = 'QUESTION';
const mode = 'MODE';  // 'bfs' or 'dfs'
const terms = question.split(' ').filter(t => t.length > 3).map(t => t.toLowerCase());

// Preferred node types for high-level overview queries
const PREFERRED_TYPES = new Set(['concept', 'rationale', 'document', 'summary']);

// Find best-matching start nodes, preferring concept/rationale/document types
const scored = [];
G.forEachNode((nid, ndata) => {
  const label = (ndata.label || '').toLowerCase();
  const ftype = (ndata.file_type || '').toLowerCase();
  let score = 0;
  for (const t of terms) { if (label.includes(t)) score++; }
  if (score > 0) {
    // Boost preferred node types so they rank above code nodes
    const typeBonus = PREFERRED_TYPES.has(ftype) ? 2 : 0;
    scored.push({ score: score + typeBonus, nid });
  }
});
scored.sort((a, b) => b.score - a.score);
const startNodes = scored.slice(0, 3).map(s => s.nid);

if (startNodes.length === 0) {
  console.log('No matching nodes found for query terms:', terms);
  process.exit(0);
}

const subgraphNodes = new Set();
const subgraphEdges = [];

if (mode === 'dfs') {
  // DFS: follow one path as deep as possible before backtracking.
  // Depth-limited to 6 to avoid traversing the whole graph.
  const visited = new Set();
  const stack = startNodes.reverse().map(n => [n, 0]);
  while (stack.length > 0) {
    const [node, depth] = stack.pop();
    if (visited.has(node) || depth > 6) continue;
    visited.add(node);
    subgraphNodes.add(node);
    G.forEachNeighbor(node, (neighbor) => {
      if (!visited.has(neighbor)) {
        stack.push([neighbor, depth + 1]);
        subgraphEdges.push([node, neighbor]);
      }
    });
  }
} else {
  // BFS: explore all neighbors layer by layer.
  // Default depth 2 (not 3) to avoid returning the entire graph on
  // broad overview queries. Override by passing --budget N (>=4000)
  // which signals a deeper need and switches to depth 3.
  const MAX_BFS_DEPTH = BUDGET >= 4000 ? 3 : 2;  // default 2000
  const MAX_FRONTIER = 80;  // cap per layer to limit explosion
  let frontier = new Set(startNodes);
  for (const sn of startNodes) subgraphNodes.add(sn);
  for (let i = 0; i < MAX_BFS_DEPTH; i++) {
    const nextFrontier = new Set();
    for (const n of frontier) {
      G.forEachNeighbor(n, (neighbor) => {
        if (!subgraphNodes.has(neighbor) && nextFrontier.size < MAX_FRONTIER) {
          nextFrontier.add(neighbor);
          subgraphEdges.push([n, neighbor]);
        }
      });
    }
    for (const nn of nextFrontier) subgraphNodes.add(nn);
    frontier = nextFrontier;
  }
}

// Token-budget aware output: rank by relevance, cut at budget (~4 chars/token)
const tokenBudget = BUDGET;  // default 2000
const charBudget = tokenBudget * 4;

// Score each node by term overlap for ranked output
function relevance(nid) {
  const label = (G.getNodeAttributes(nid).label || '').toLowerCase();
  let s = 0;
  for (const t of terms) { if (label.includes(t)) s++; }
  return s;
}

const rankedNodes = [...subgraphNodes].sort((a, b) => relevance(b) - relevance(a));

const lines = ['Traversal: ' + mode.toUpperCase() + ' | Start: ' + startNodes.map(n => G.getNodeAttributes(n).label || n).join(', ') + ' | ' + subgraphNodes.size + ' nodes'];
for (const nid of rankedNodes) {
  const d = G.getNodeAttributes(nid);
  lines.push('  NODE ' + (d.label || nid) + ' [src=' + (d.source_file || '') + ' loc=' + (d.source_location || '') + ']');
}
for (const [u, v] of subgraphEdges) {
  if (subgraphNodes.has(u) && subgraphNodes.has(v)) {
    const edge = G.getEdgeAttributes(G.edge(u, v)) || {};
    lines.push('  EDGE ' + (G.getNodeAttributes(u).label || u) + ' --' + (edge.relation || '') + ' [' + (edge.confidence || '') + ']--> ' + (G.getNodeAttributes(v).label || v));
  }
}

let output = lines.join('\n');
if (output.length > charBudget) {
  output = output.slice(0, charBudget) + '\n... (truncated at ~' + tokenBudget + ' token budget - use --budget N for more)';
}
console.log(output);
"
```

Replace `QUESTION` with the **expanded** query string, `MODE` with `bfs` or `dfs`, and `BUDGET` with the token budget (default `2000`, or whatever `--budget N` specifies). Then answer based on the subgraph output above, using only what the graph contains.

After writing the answer, save it back into the graph so it improves future queries. Include the expanded tokens inside the `--answer` text (e.g. `"Expanded from original query via vocab: [tokens]. Then traversed..."`) so the next `--update` extracts the expansion history as a graph node:

```bash
graphify save-result --question "ORIGINAL_QUESTION" --answer "ANSWER" --type query --memory-dir graphify-out/memory --nodes NODE1 NODE2
```

If the `graphify` CLI is unavailable, use the Node.js API directly with the local CJS bundle. **Do NOT use `require('@sentropic/graphify')`** — that package name is only valid after a global `npm install -g @sentropic/graphify`. In a local repo, use the CJS bundle:

```bash
$(cat .graphify/.graphify_node) -e "
const { saveQueryResult } = require('./dist/index.cjs');
const out = saveQueryResult(
  'ORIGINAL_QUESTION',
  'ANSWER',
  'graphify-out/memory',
  'query',
  ['NODE1', 'NODE2']
);
console.log('Saved to ' + out);
"
```

**Important:** `saveQueryResult` uses positional arguments `(question, answer, memoryDir, queryType, sourceNodes)`, not a single object. Passing an object as the first argument causes `memoryDir` to be `undefined`, which crashes `fs.mkdirSync`.

Replace `ORIGINAL_QUESTION` with the user's verbatim question, `ANSWER` with your full answer text (containing the expanded-token trace), `NODE1 NODE2` with the list of node labels you cited. This closes the feedback loop: the next `--update` will extract this Q&A as a node in the graph.

---

## For /graphify path

Find the shortest path between two named concepts in the graph. Prefer the CLI when installed:

```bash
graphify path "NODE_A" "NODE_B"
```

If the CLI is unavailable, run it inline:

```bash
$(cat .graphify/.graphify_node) --input-type=module -e "
import fs from 'fs';
import { GraphologyGraph } from 'graphology';

const data = JSON.parse(fs.readFileSync('graphify-out/graph.json', 'utf-8'));
const G = new GraphologyGraph({ type: 'undirected', multi: false });
for (const n of data.nodes) G.addNode(n.id, n);
for (const e of data.links) G.addEdge(e.source, e.target, e);

const aTerm = 'NODE_A';
const bTerm = 'NODE_B';

function findNode(term) {
  const tl = term.toLowerCase();
  const words = tl.split(' ');
  let best = null;
  let bestScore = 0;
  G.forEachNode((nid, ndata) => {
    const label = (ndata.label || '').toLowerCase();
    let score = 0;
    for (const w of words) { if (label.includes(w)) score++; }
    if (score > bestScore) { bestScore = score; best = nid; }
  });
  return bestScore > 0 ? best : null;
}

const src = findNode(aTerm);
const tgt = findNode(bTerm);

if (!src || !tgt) {
  console.log('Could not find nodes matching: ' + aTerm + ' or ' + bTerm);
  process.exit(0);
}

try {
  const path = G.bidirectional(src, tgt);
  console.log('Shortest path (' + (path.length - 1) + ' hops):');
  for (let i = 0; i < path.length; i++) {
    const label = G.getNodeAttributes(path[i]).label || path[i];
    if (i < path.length - 1) {
      const edge = G.getEdgeAttributes(G.edge(path[i], path[i + 1])) || {};
      const rel = edge.relation || '';
      const conf = edge.confidence || '';
      console.log('  ' + label + ' --' + rel + '--> [' + conf + ']');
    } else {
      console.log('  ' + label);
    }
  }
} catch (e) {
  if (e.message && e.message.includes('not found')) {
    console.log('No path found between ' + aTerm + ' and ' + bTerm);
  } else {
    throw e;
  }
}
"
```

Replace `NODE_A` and `NODE_B` with the actual concept names from the user. Then explain the path in plain language - what each hop means, why it's significant.

After writing the explanation, save it back:

```bash
graphify save-result --question "Path from NODE_A to NODE_B" --answer "ANSWER" --type path_query --memory-dir graphify-out/memory --nodes NODE_A NODE_B
```

Node.js fallback (local repo only — use `require('./dist/index.cjs')`, not `require('@sentropic/graphify')`; positional args, not object):

```bash
$(cat .graphify/.graphify_node) -e "
const { saveQueryResult } = require('./dist/index.cjs');
const out = saveQueryResult(
  'Path from NODE_A to NODE_B',
  'ANSWER',
  'graphify-out/memory',
  'path_query',
  ['NODE_A', 'NODE_B']
);
console.log('Saved to ' + out);
"
```

---

## For /graphify explain

Give a plain-language explanation of a single node - everything connected to it. Prefer the CLI when installed:

```bash
graphify explain "NODE_NAME"
```

If the CLI is unavailable, run it inline:

```bash
$(cat .graphify/.graphify_node) --input-type=module -e "
import fs from 'fs';
import { GraphologyGraph } from 'graphology';

const data = JSON.parse(fs.readFileSync('graphify-out/graph.json', 'utf-8'));
const G = new GraphologyGraph({ type: 'undirected', multi: false });
for (const n of data.nodes) G.addNode(n.id, n);
for (const e of data.links) G.addEdge(e.source, e.target, e);

const term = 'NODE_NAME';
const termLower = term.toLowerCase();

// Find best matching node
let bestNid = null;
let bestScore = 0;
const words = termLower.split(' ');
G.forEachNode((nid, ndata) => {
  const label = (ndata.label || '').toLowerCase();
  let score = 0;
  for (const w of words) { if (label.includes(w)) score++; }
  if (score > bestScore) { bestScore = score; bestNid = nid; }
});

if (bestScore === 0) {
  console.log('No node matching ' + term);
  process.exit(0);
}

const d = G.getNodeAttributes(bestNid);
console.log('NODE: ' + (d.label || bestNid));
console.log('  source: ' + (d.source_file || 'unknown'));
console.log('  type: ' + (d.file_type || 'unknown'));
console.log('  degree: ' + G.degree(bestNid));
console.log();
console.log('CONNECTIONS:');
G.forEachNeighbor(bestNid, (neighbor) => {
  const edge = G.getEdgeAttributes(G.edge(bestNid, neighbor)) || {};
  const nlabel = G.getNodeAttributes(neighbor).label || neighbor;
  const rel = edge.relation || '';
  const conf = edge.confidence || '';
  const srcFile = G.getNodeAttributes(neighbor).source_file || '';
  console.log('  --' + rel + '--> ' + nlabel + ' [' + conf + '] (' + srcFile + ')');
});
"
```

Replace `NODE_NAME` with the concept the user asked about. Then write a 3-5 sentence explanation of what this node is, what it connects to, and why those connections are significant. Use the source locations as citations.

After writing the explanation, save it back:

```bash
graphify save-result --question "Explain NODE_NAME" --answer "ANSWER" --type explain --memory-dir graphify-out/memory --nodes NODE_NAME
```

Node.js fallback (local repo only — use `require('./dist/index.cjs')`, not `require('@sentropic/graphify')`; positional args, not object):

```bash
$(cat .graphify/.graphify_node) -e "
const { saveQueryResult } = require('./dist/index.cjs');
const out = saveQueryResult(
  'Explain NODE_NAME',
  'ANSWER',
  'graphify-out/memory',
  'explain',
  ['NODE_NAME']
);
console.log('Saved to ' + out);
"
```
