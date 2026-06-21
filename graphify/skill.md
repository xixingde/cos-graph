---
name: graphify
description: "Use for any question about a codebase, its architecture, file relationships, or project content — especially when .graphify/ exists, where the question should be treated as a graphify query first. Turns any input (code, docs, papers, images, videos) into a persistent knowledge graph with god nodes, community detection, and query/path/explain tools."
---

# /graphify

Turn any folder of files into a navigable knowledge graph with community detection, an honest audit trail, and three outputs: interactive HTML, GraphRAG-ready JSON, and a plain-language GRAPH_REPORT.md.

## Usage

```
/graphify                                             # full pipeline on current directory → Obsidian vault
/graphify <path>                                      # full pipeline on specific path
/graphify https://github.com/<owner>/<repo>           # clone repo then run full pipeline on it
/graphify https://github.com/<owner>/<repo> --branch <branch>  # clone a specific branch
/graphify <url1> <url2> ...                           # clone multiple repos, build each, merge into one cross-repo graph
/graphify <path> --mode deep                          # thorough extraction, richer INFERRED edges
/graphify update <path>                             # incremental - re-extract only new/changed files
/graphify <path> --directed                            # build directed graph (preserves edge direction: source→target)
/graphify <path> --whisper-model medium                # use a larger Whisper model for better transcription accuracy
/graphify cluster-only <path>                       # rerun clustering on existing graph
/graphify <path> --no-viz                             # skip visualization, just report + JSON
/graphify studio export <dir>                        # bundle interactive graph studio into <dir>
/graphify <path> --svg                                # also export graph.svg (embeds in Notion, GitHub)
/graphify <path> --graphml                            # export graph.graphml (Gephi, yEd)
/graphify <path> --neo4j                              # generate .graphify/cypher.txt for Neo4j
/graphify <path> --neo4j-push bolt://localhost:7687   # push directly to Neo4j
/graphify <path> --falkordb                           # generate .graphify/cypher.txt for FalkorDB
/graphify <path> --falkordb-push falkordb://localhost:6379   # push directly to FalkorDB
/graphify <path> --mcp                                # start MCP stdio server for agent access
/graphify <path> --watch                              # watch folder, auto-rebuild on code changes (no LLM needed)
/graphify <path> --wiki                               # build agent-crawlable wiki (index.md + one article per community)
/graphify <path> --obsidian --obsidian-dir ~/vaults/my-project  # write vault to custom path (e.g. existing vault)
/graphify add <url>                                   # fetch URL, save to ./raw, update graph
/graphify add <url> --author "Name"                   # tag who wrote it
/graphify add <url> --contributor "Name"              # tag who added it to the corpus
/graphify query "<question>"                          # BFS traversal - broad context
/graphify query "<question>" --dfs                    # DFS - trace a specific path
/graphify query "<question>" --budget 1500            # cap answer at N tokens
/graphify path "AuthModule" "Database"                # shortest path between two concepts
/graphify explain "SwinTransformer"                   # plain-language explanation of a node
```

## What graphify is for

Drop any folder of code, docs, papers, images, or video into graphify and get a queryable knowledge graph. Persistent across sessions, honest audit trail (EXTRACTED/INFERRED/AMBIGUOUS), community detection surfaces cross-document connections you wouldn't think to ask about.

## What You Must Do When Invoked

If the user invoked `/graphify --help` or `/graphify -h` (with no other arguments), print the contents of the `## Usage` section above verbatim and stop. Do not run any commands, do not detect files, do not default the path to `.`. Just print the Usage block and return.

**Fast path — existing graph:** Before doing anything else, check whether `.graphify/graph.json` exists. The expected location is `.graphify/graph.json` relative to the **current working directory** (i.e. the project root where you are running commands). If it exists AND the user's request is a natural-language question about the codebase (e.g. "How does X work?", "What calls Y?", "Trace the data flow through Z") and NOT an explicit rebuild command (`graphify update`, `graphify cluster-only`, or a bare path/URL that implies fresh extraction): **skip Steps 1–5 entirely and jump straight to `## For /graphify query`.** Run `graphify query "<question>"` immediately. Do not run detect. Do not check corpus size. Do not ask the user to narrow. The graph is already built — use it.

If no path was given, use `.` (current directory). Do not ask the user for a path.

If the path argument starts with `https://github.com/` or `http://github.com/`, treat it as a GitHub URL - run Step 0 before anything else, then continue with the resolved local path.

Follow these steps in order. Do not skip steps.

### Step 0 - GitHub repos and multi-path merge (only if a URL or several paths)

Only when the path is one or more `https://github.com/...` URLs, or several local subfolders to merge. See `references/github-and-merge.md` for the clone, cross-repo merge, and monorepo flow, then continue with the resolved local path. A plain local path skips this step.

### Step 1 - Resolve interpreter and save root

graphify is assumed to be already installed. This step only resolves the Node interpreter path and saves the scan root for subsequent steps.

```bash
# Detect the correct Node.js / graphify CLI setup
GRAPHIFY_BIN=$(which graphify 2>/dev/null)
NODE=""
# 1. If graphify binary exists, derive the Node interpreter from its shebang or environment
if [ -n "$GRAPHIFY_BIN" ]; then
    _SHEBANG=$(head -1 "$GRAPHIFY_BIN" | sed 's/^#!//')
    case "$_SHEBANG" in
        *node*) NODE="$_SHEBANG" ;;
        *) NODE="" ;;
    esac
fi
# 2. Fall back to node from PATH
if [ -z "$NODE" ]; then NODE="node"; fi
# Write interpreter path for all subsequent steps (persists across invocations)
mkdir -p .graphify
echo "$NODE" > .graphify/.graphify_node
# Save scan root so `graphify update` (no args) knows where to look next time
echo "$(cd INPUT_PATH && pwd)" > .graphify/.graphify_root
```

Move straight to Step 2.

**In every subsequent bash block, replace `node` with `$(cat .graphify/.graphify_node)` to use the correct interpreter.**

### Step 2 - Detect files

Use the `graphify detect` CLI command. If the default scope (`--scope auto`) fails with an ENOBUFS error (caused by `git ls-files` returning too many untracked paths), add `--scope all` to bypass the git inventory step, or `--exclude` to filter out large directories like `node_modules`:

```bash
graphify detect INPUT_PATH
# If ENOBUFS: graphify detect INPUT_PATH --scope all
# Or:        graphify detect INPUT_PATH --exclude node_modules --exclude dist
```

The result is written to `.graphify/.graphify_detect.json`. Read it silently and present a clean summary instead:

```
Corpus: X files · ~Y words
  code:     N files (.py .ts .go ...)
  docs:     N files (.md .txt ...)
  papers:   N files (.pdf ...)
  images:   N files
  video:    N files (.mp4 .mp3 ...)
```

Omit any category with 0 files from the summary.

Then act on it:
- If `total_files` is 0: stop with "No supported files found in [path]."
- If `skipped_sensitive` is non-empty: mention file count skipped, not the file names.
- If `total_words` > 2,000,000 OR `total_files` > 500: show the warning. Then compute the top 5 first-level subdirectories by file count:
  - Read `scan_root` from the detect JSON (always an absolute path to the resolved INPUT_PATH).
  - Concatenate all file lists across all types (`code`, `document`, `paper`, `image`, `video`).
  - Filter out any path that starts with `scan_root + "/.graphify/"` to exclude converted sidecars.
  - For each file, strip the `scan_root` prefix and take the first path component. Files directly in `scan_root` with no subdirectory count as `(root)`.
  - If all files are in `(root)` with no subdirectories, do not ask to narrow — no subfolders exist. Instead suggest `--no-cluster` to skip the expensive clustering step and proceed.
  - Otherwise rank by count, show the top 5 with file counts, then ask which subfolder to run on. Wait for the user's answer before proceeding.
- Otherwise: proceed directly to Step 2.5 if video files were detected, or Step 3 if not.

### Step 2.5 - Video and audio (only if video files detected)

Skip this step entirely if `detect` returned zero `video` files. When the corpus has video or audio, see `references/transcribe.md` to transcribe them to text first, then treat the transcripts as doc files in Step 3.

### Step 3 - Extract entities and relationships

**Before starting:** note whether `--mode deep` was given. You must pass `DEEP_MODE=true` to every subagent in Step B2 if it was. Track this from the original invocation - do not lose it.

This step has two parts: **structural extraction** (deterministic, free) and **semantic extraction** (LLM, costs tokens).

**Before dispatching subagents:** check whether `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set. If neither is set, print this one-liner to the user:
> Tip: set `GEMINI_API_KEY` or `GOOGLE_API_KEY` to use Gemini for semantic extraction.

Print it once, then continue. If `GEMINI_API_KEY` or `GOOGLE_API_KEY` IS set, use `graphify.llm.extract_corpus_parallel(files, backend="gemini")` for semantic extraction instead of dispatching Claude subagents. The default Gemini model is `gemini-3-flash-preview`; set `GRAPHIFY_GEMINI_MODEL` or pass `--model` in headless CLI flows to override it.

> **No other API keys are read.** If `GEMINI_API_KEY`/`GOOGLE_API_KEY` are unset, fall straight through to Claude Code subagent dispatch (Part B below) — the host session itself is the LLM. graphify does **not** read `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or any other provider key from the environment. If a host agent prompts the user for `ANTHROPIC_API_KEY` to run extraction, that prompt is a misread of this skill — ignore it and dispatch subagents as written.

**Run Part A (AST) and Part B (semantic) in parallel. Dispatch all semantic subagents AND start AST extraction in the same message. Both can run simultaneously since they operate on different file types. Merge results in Part C as before.**

Note: Parallelizing AST + semantic saves 5-15s on large corpora. AST is deterministic and fast; start it while subagents are processing docs/papers.

#### Part A - Structural extraction for code files

For any code files detected, run AST extraction in parallel with Part B subagents:

```bash
$(cat .graphify/.graphify_node) --input-type=module -e "
import { collectFiles, extract } from 'graphifyy';
import fs from 'fs';
import path from 'path';

const detect = JSON.parse(fs.readFileSync('.graphify/.graphify_detect.json', 'utf-8'));
const codePaths = detect.files?.code || [];
const codeFiles = [];
for (const f of codePaths) {
  try {
    const stat = fs.statSync(f);
    if (stat.isDirectory()) {
      codeFiles.push(...collectFiles(f));
    } else {
      codeFiles.push(path.resolve(f));
    }
  } catch { /* skip missing */ }
}

if (codeFiles.length > 0) {
  const result = extract(codeFiles, '.');
  fs.writeFileSync('.graphify/.graphify_ast.json', JSON.stringify(result, null, 2));
  console.log('AST: ' + result.nodes.length + ' nodes, ' + result.edges.length + ' edges');
} else {
  fs.writeFileSync('.graphify/.graphify_ast.json', JSON.stringify({nodes:[],edges:[],input_tokens:0,output_tokens:0}));
  console.log('No code files - skipping AST extraction');
}
"
```

#### Part B - Semantic extraction (parallel subagents)

**Fast path:** If detection found zero docs, papers, and images (code-only corpus), skip Part B entirely and go straight to Part C. AST handles code - there is nothing for semantic subagents to do.

**MANDATORY: You MUST use the Agent tool here. Reading files yourself one-by-one is forbidden - it is 5-10x slower. If you do not use the Agent tool you are doing this wrong.**

Before dispatching subagents, print a timing estimate:
- Load `total_words` and file counts from `.graphify/.graphify_detect.json`
- Estimate agents needed: `ceil(uncached_non_code_files / 22)` (chunk size is 20-25)
- Estimate time: ~45s per agent batch (they run in parallel, so total ≈ 45s × ceil(agents/parallel_limit))
- Print: "Semantic extraction: ~N files → X agents, estimated ~Ys"

**Step B0 - Check extraction cache first**

Before dispatching any subagents, check which files already have cached extraction results:

```bash
$(cat .graphify/.graphify_node) --input-type=module -e "
import { checkSemanticCache } from 'graphifyy';
import fs from 'fs';

const detect = JSON.parse(fs.readFileSync('.graphify/.graphify_detect.json', 'utf-8'));
const allFiles = Object.values(detect.files).flat();

const { cachedNodes, cachedEdges, cachedHyperedges, uncachedFiles } = checkSemanticCache(allFiles, '.');

if (cachedNodes.length > 0 || cachedEdges.length > 0 || cachedHyperedges.length > 0) {
  fs.writeFileSync('.graphify/.graphify_cached.json', JSON.stringify({
    nodes: cachedNodes, edges: cachedEdges, hyperedges: cachedHyperedges
  }));
}
fs.writeFileSync('.graphify/.graphify_uncached.txt', uncachedFiles.join('\n'));
console.log('Cache: ' + (allFiles.length - uncachedFiles.length) + ' files hit, ' + uncachedFiles.length + ' files need extraction');
"
```

Only dispatch subagents for files listed in `.graphify/.graphify_uncached.txt`. If all files are cached, skip to Part C directly.

**Step B1 - Split into chunks**

Load files from `.graphify/.graphify_uncached.txt`. Split into chunks of 20-25 files each. Each image gets its own chunk (vision needs separate context). When splitting, group files from the same directory together so related artifacts land in the same chunk and cross-file relationships are more likely to be extracted.

**Step B2 - Dispatch ALL subagents in a single message**

Call the Agent tool multiple times IN THE SAME RESPONSE - one call per chunk. This is the only way they run in parallel. If you make one Agent call, wait, then make another, you are doing it sequentially and defeating the purpose.

**IMPORTANT - subagent type:** Always use `subagent_type="general-purpose"`. Do NOT use `Explore` - it is read-only and cannot write chunk files to disk, which silently drops extraction results. General-purpose has Write and Bash access which the subagent needs.

Concrete example for 3 chunks:
```
[Agent tool call 1: files 1-15, subagent_type="general-purpose"]
[Agent tool call 2: files 16-30, subagent_type="general-purpose"]
[Agent tool call 3: files 31-45, subagent_type="general-purpose"]
```
All three in one message. Not three separate messages.

Each subagent receives this exact prompt (substitute FILE_LIST, CHUNK_NUM, TOTAL_CHUNKS, DEEP_MODE, and CHUNK_PATH).

CHUNK_PATH must be an **absolute** path — derive it before dispatching:
```bash
PROJECT_ROOT=$(cat .graphify/.graphify_root)
# Then for chunk N: CHUNK_PATH="${PROJECT_ROOT}/.graphify/.graphify_chunk_0N.json"
```

Subagent prompt template:

See `references/extraction-spec.md` for the exact subagent prompt (JSON schema, node-ID rules, confidence rubric, frontmatter, hyperedge, and vision rules). Load it only here, only when at least one chunk holds a doc, paper, or image; a pure-code corpus has skipped Part B and never reads it. Pass each subagent that prompt verbatim with FILE_LIST, CHUNK_NUM, TOTAL_CHUNKS, DEEP_MODE, and CHUNK_PATH substituted, and have it write the result to CHUNK_PATH.

**Step B3 - Collect, cache, and merge**

Wait for all subagents. For each result:
- Check that `.graphify/.graphify_chunk_NN.json` exists on disk — this is the success signal
- If the file exists and contains valid JSON with `nodes` and `edges`, include it and save to cache
- If the file is missing, the subagent was likely dispatched as read-only (Explore type) — print a warning: "chunk N missing from disk — subagent may have been read-only. Re-run with general-purpose agent." Do not silently skip.
- If a subagent failed or returned invalid JSON, print a warning and skip that chunk - do not abort

If more than half the chunks failed or are missing, stop and tell the user to re-run and ensure `subagent_type="general-purpose"` is used.

Merge all chunk files into `.graphify_semantic_new.json`. **After each Agent call completes, read the real token counts from the Agent tool result's `usage` field and write them back into the chunk JSON before merging** — the chunk JSON itself always has placeholder zeros. Then run:
```bash
$(cat .graphify/.graphify_node) --input-type=module -e "
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const chunks = await glob('.graphify/.graphify_chunk_*.json');
const allNodes = [], allEdges = [], allHyperedges = [];
let totalIn = 0, totalOut = 0;
for (const c of chunks.sort()) {
  const d = JSON.parse(fs.readFileSync(c, 'utf-8'));
  allNodes.push(...(d.nodes || []));
  allEdges.push(...(d.edges || []));
  allHyperedges.push(...(d.hyperedges || []));
  totalIn += (d.input_tokens || 0);
  totalOut += (d.output_tokens || 0);
}
fs.writeFileSync('.graphify/.graphify_semantic_new.json', JSON.stringify({
  nodes: allNodes, edges: allEdges, hyperedges: allHyperedges,
  input_tokens: totalIn, output_tokens: totalOut,
}, null, 2));
console.log('Merged ' + chunks.length + ' chunks: ' + totalIn.toLocaleString() + ' in / ' + totalOut.toLocaleString() + ' out tokens');
"
```

Save new results to cache:
```bash
$(cat .graphify/.graphify_node) --input-type=module -e "
import { saveSemanticCache } from 'graphifyy';
import fs from 'fs';

const newExists = fs.existsSync('.graphify/.graphify_semantic_new.json');
const newResult = newExists
  ? JSON.parse(fs.readFileSync('.graphify/.graphify_semantic_new.json', 'utf-8'))
  : { nodes: [], edges: [], hyperedges: [] };
const saved = saveSemanticCache(
  newResult.nodes || [],
  newResult.edges || [],
  newResult.hyperedges || [],
  '.'
);
console.log('Cached ' + saved + ' files');
"
```

Merge cached + new results into `.graphify/.graphify_semantic.json`:
```bash
$(cat .graphify/.graphify_node) --input-type=module -e "
import fs from 'fs';

const cachedExists = fs.existsSync('.graphify/.graphify_cached.json');
const cached = cachedExists
  ? JSON.parse(fs.readFileSync('.graphify/.graphify_cached.json', 'utf-8'))
  : { nodes: [], edges: [], hyperedges: [] };
const newExists = fs.existsSync('.graphify/.graphify_semantic_new.json');
const newResult = newExists
  ? JSON.parse(fs.readFileSync('.graphify/.graphify_semantic_new.json', 'utf-8'))
  : { nodes: [], edges: [], hyperedges: [] };

const allNodes = [...(cached.nodes || []), ...(newResult.nodes || [])];
const allEdges = [...(cached.edges || []), ...(newResult.edges || [])];
const allHyperedges = [...(cached.hyperedges || []), ...(newResult.hyperedges || [])];
const seen = new Set();
const deduped = [];
for (const n of allNodes) {
  if (!seen.has(n.id)) { seen.add(n.id); deduped.push(n); }
}

const merged = {
  nodes: deduped,
  edges: allEdges,
  hyperedges: allHyperedges,
  input_tokens: newResult.input_tokens || 0,
  output_tokens: newResult.output_tokens || 0,
};
fs.writeFileSync('.graphify/.graphify_semantic.json', JSON.stringify(merged, null, 2));
console.log('Extraction complete - ' + deduped.length + ' nodes, ' + allEdges.length + ' edges (' + (cached.nodes || []).length + ' from cache, ' + (newResult.nodes || []).length + ' new)');
"
```
Clean up temp files: `rm -f .graphify/.graphify_cached.json .graphify/.graphify_uncached.txt .graphify/.graphify_semantic_new.json`

#### Part C - Merge AST + semantic into final extraction

```bash
$(cat .graphify/.graphify_node) --input-type=module -e "
import fs from 'fs';

const ast = JSON.parse(fs.readFileSync('.graphify/.graphify_ast.json', 'utf-8'));
const sem = JSON.parse(fs.readFileSync('.graphify/.graphify_semantic.json', 'utf-8'));

// Merge: AST nodes first, semantic nodes deduplicated by id
const seen = new Set(ast.nodes.map(n => n.id));
const mergedNodes = [...ast.nodes];
for (const n of sem.nodes) {
  if (!seen.has(n.id)) {
    mergedNodes.push(n);
    seen.add(n.id);
  }
}

const mergedEdges = [...ast.edges, ...sem.edges];
const mergedHyperedges = sem.hyperedges || [];
const merged = {
  nodes: mergedNodes,
  edges: mergedEdges,
  hyperedges: mergedHyperedges,
  input_tokens: sem.input_tokens || 0,
  output_tokens: sem.output_tokens || 0,
};
fs.writeFileSync('.graphify/.graphify_extract.json', JSON.stringify(merged, null, 2));
const total = mergedNodes.length;
const edges = mergedEdges.length;
console.log('Merged: ' + total + ' nodes, ' + edges + ' edges (' + ast.nodes.length + ' AST + ' + sem.nodes.length + ' semantic)');
"
```

### Step 4 - Build graph, cluster, analyze, generate outputs

**Before starting:** note whether `--directed` was given. If so, pass `directed: true` to `buildFromJson()` in the code block below. This builds a `DiGraph` that preserves edge direction (source→target) instead of the default undirected `Graph`.

```bash
mkdir -p .graphify
$(cat .graphify/.graphify_node) --input-type=module -e "
import fs from 'fs';
import { buildFromJson } from 'graphifyy';
import { cluster, scoreAll } from 'graphifyy';
import { godNodes, surprisingConnections, suggestQuestions } from 'graphifyy';
import { generate } from 'graphifyy';
import { toJson } from 'graphifyy';

const extraction = JSON.parse(fs.readFileSync('.graphify/.graphify_extract.json', 'utf-8'));
const detection  = JSON.parse(fs.readFileSync('.graphify/.graphify_detect.json', 'utf-8'));

// root= mirrors the --update runbook (#1361): relativize source_file to the same
// base so the full build and incremental --update never drift apart on re-extract.
const G = buildFromJson(extraction, { root: 'INPUT_PATH' });
const communities = cluster(G);
const cohesion = scoreAll(G, communities);
const tokens = { input: extraction.input_tokens || 0, output: extraction.output_tokens || 0 };
const gods = godNodes(G);
const surprises = surprisingConnections(G, communities);
const labels = {};
for (const cid of Object.values(communities)) {
  if (labels[cid] === undefined) labels[cid] = 'Community ' + cid;
}
// Placeholder questions - regenerated with real labels in Step 5
const questions = suggestQuestions(G, communities, labels);

const report = generate({
  graph: G,
  communities: (() => {
    const groups = {};
    for (const [node, cid] of Object.entries(communities)) {
      if (!groups[cid]) groups[cid] = [];
      groups[cid].push(node);
    }
    return groups;
  })(),
  cohesionScores: cohesion,
  communityLabels: labels,
  godNodeList: gods,
  surpriseList: surprises,
  detectionResult: detection,
  tokenCost: tokens,
  root: '.',
  suggestedQuestions: questions,
});
fs.writeFileSync('.graphify/GRAPH_REPORT.md', report, 'utf-8');
toJson(G, (() => {
  const groups = {};
  for (const [node, cid] of Object.entries(communities)) {
    if (!groups[cid]) groups[cid] = [];
    groups[cid].push(node);
  }
  return groups;
})(), '.graphify/graph.json');

const analysis = {
  communities: communities,
  cohesion: cohesion,
  gods: gods,
  surprises: surprises,
  questions: questions,
};
fs.writeFileSync('.graphify/.graphify_analysis.json', JSON.stringify(analysis, null, 2));
if (G.order === 0) {
  console.log('ERROR: Graph is empty - extraction produced no nodes.');
  console.log('Possible causes: all files were skipped, binary-only corpus, or extraction failed.');
  process.exit(1);
}
console.log('Graph: ' + G.order + ' nodes, ' + G.size + ' edges, ' + new Set(Object.values(communities)).size + ' communities');
"
```

If this step prints `ERROR: Graph is empty`, stop and tell the user what happened - do not proceed to labeling or visualization.

Replace INPUT_PATH with the actual path.

### Step 5 - Label communities

Read `.graphify/.graphify_analysis.json`. For each community key, look at its node labels and write a 2-5 word plain-language name (e.g. "Attention Mechanism", "Training Pipeline", "Data Loading").

Then regenerate the report and save the labels for the visualizer:

```bash
$(cat .graphify/.graphify_node) --input-type=module -e "
import fs from 'fs';
import { buildFromJson } from 'graphifyy';
import { scoreAll } from 'graphifyy';
import { godNodes, surprisingConnections, suggestQuestions } from 'graphifyy';
import { generate } from 'graphifyy';

const extraction = JSON.parse(fs.readFileSync('.graphify/.graphify_extract.json', 'utf-8'));
const detection  = JSON.parse(fs.readFileSync('.graphify/.graphify_detect.json', 'utf-8'));
const analysis   = JSON.parse(fs.readFileSync('.graphify/.graphify_analysis.json', 'utf-8'));

// root= as in Step 4 / the --update runbook (#1361) — same base for node-key parity.
const G = buildFromJson(extraction, { root: 'INPUT_PATH' });
const communities = {};
for (const [k, v] of Object.entries(analysis.communities)) { communities[Number(k)] = v; }
const cohesion = {};
for (const [k, v] of Object.entries(analysis.cohesion)) { cohesion[Number(k)] = v; }
const tokens = { input: extraction.input_tokens || 0, output: extraction.output_tokens || 0 };

// LABELS - replace these with the names you chose above
const labels = LABELS_DICT;

// Regenerate questions with real community labels (labels affect question phrasing)
const questions = suggestQuestions(G, communities, labels);

const report = generate({
  graph: G,
  communities: (() => {
    const groups = {};
    for (const [node, cid] of Object.entries(communities)) {
      if (!groups[cid]) groups[cid] = [];
      groups[cid].push(node);
    }
    return groups;
  })(),
  cohesionScores: cohesion,
  communityLabels: labels,
  godNodeList: analysis.gods,
  surpriseList: analysis.surprises,
  detectionResult: detection,
  tokenCost: tokens,
  root: '.',
  suggestedQuestions: questions,
});
fs.writeFileSync('.graphify/GRAPH_REPORT.md', report, 'utf-8');
fs.writeFileSync('.graphify/.graphify_labels.json', JSON.stringify(labels));
console.log('Report updated with community labels');
"
```

Replace `LABELS_DICT` with the actual object you constructed (e.g. `{0: "Attention Mechanism", 1: "Training Pipeline"}`).
Replace INPUT_PATH with the actual path.

### Step 6 - Generate Obsidian vault (opt-in) + HTML

**Generate HTML always** (unless `--no-viz`). **Obsidian vault only if `--obsidian` was explicitly given** — skip it otherwise, it generates one file per node.

If `--obsidian` was given:

- If `--obsidian-dir <path>` was also given, pass it via `--dir`. Otherwise defaults to `.graphify/obsidian`.

```bash
graphify export obsidian
# or with custom dir: graphify export obsidian --dir ~/vaults/my-project
```

Generate the interactive Studio HTML (always, unless `--no-viz`):

```bash
graphify studio export .graphify/studio  # bundles a self-contained static studio
```

### Steps 6b-8 - Wiki, Neo4j, FalkorDB, SVG, GraphML, MCP, benchmark (only on their flags)

These run only when their flag is present (`--wiki`, `--neo4j`/`--neo4j-push`, `--falkordb`/`--falkordb-push`, `--svg`, `--graphml`, `--mcp`) or, for the token-reduction benchmark, when `total_words` exceeds 5,000. A default run with no export flags skips all of them. See `references/exports.md` for each one. Run any `--wiki` export before Step 9 cleanup so `.graphify_labels.json` is still available.

---

### Step 9 - Save manifest, update cost tracker, clean up, and report

```bash
$(cat .graphify/.graphify_node) --input-type=module -e "
import fs from 'fs';
import { saveManifest } from 'graphifyy';

// Save manifest for --update
const detect = JSON.parse(fs.readFileSync('.graphify/.graphify_detect.json', 'utf-8'));
// In --update mode, 'all_files' carries the full corpus; 'files' is the changed
// subset. Full-rebuild mode populates only 'files', so the fallback handles that.
const filesToSave = detect.all_files || detect.files;
saveManifest(filesToSave);

// Update cumulative cost tracker
const extract = JSON.parse(fs.readFileSync('.graphify/.graphify_extract.json', 'utf-8'));
const inputTok = extract.input_tokens || 0;
const outputTok = extract.output_tokens || 0;

const costPath = '.graphify/cost.json';
let cost;
if (fs.existsSync(costPath)) {
  cost = JSON.parse(fs.readFileSync(costPath, 'utf-8'));
} else {
  cost = { runs: [], total_input_tokens: 0, total_output_tokens: 0 };
}

cost.runs.push({
  date: new Date().toISOString(),
  input_tokens: inputTok,
  output_tokens: outputTok,
  files: detect.total_files || 0,
});
cost.total_input_tokens += inputTok;
cost.total_output_tokens += outputTok;
fs.writeFileSync(costPath, JSON.stringify(cost, null, 2));

console.log('This run: ' + inputTok.toLocaleString() + ' input tokens, ' + outputTok.toLocaleString() + ' output tokens');
console.log('All time: ' + cost.total_input_tokens.toLocaleString() + ' input, ' + cost.total_output_tokens.toLocaleString() + ' output (' + cost.runs.length + ' runs)');
"
rm -f .graphify/.graphify_detect.json .graphify/.graphify_extract.json .graphify/.graphify_ast.json .graphify/.graphify_semantic.json .graphify/.graphify_analysis.json
find .graphify -maxdepth 1 -name '.graphify_chunk_*.json' -delete 2>/dev/null
rm -f .graphify/.needs_update 2>/dev/null || true
```

Tell the user (omit the obsidian line unless --obsidian was given):
```
Graph complete. Outputs in PATH_TO_DIR/.graphify/

  studio/                - interactive graph studio, open studio/index.html in browser
  GRAPH_REPORT.md       - audit report
  graph.json            - raw graph data
  obsidian/             - Obsidian vault (only if --obsidian was given)
```

If graphify saved you time, consider supporting it: https://github.com/sponsors/safishamsi

Replace PATH_TO_DIR with the actual absolute path of the directory that was processed.

Then paste these sections from GRAPH_REPORT.md directly into the chat:
- God Nodes
- Surprising Connections
- Suggested Questions

Do NOT paste the full report - just those three sections. Keep it concise.

Then immediately offer to explore. Pick the single most interesting suggested question from the report - the one that crosses the most community boundaries or has the most surprising bridge node - and ask:

> "The most interesting question this graph can answer: **[question]**. Want me to trace it?"

If the user says yes, run `/graphify query "[question]"` on the graph and walk them through the answer using the graph structure - which nodes connect, which community boundaries get crossed, what the path reveals. Keep going as long as they want to explore. Each answer should end with a natural follow-up ("this connects to X - want to go deeper?") so the session feels like navigation, not a one-shot report.

The graph is the map. Your job after the pipeline is to be the guide.

---

## Interpreter guard for subcommands

Before running any subcommand below (`update`, `cluster-only`, `query`, `path`, `explain`, `add`), check that `.graphify/.graphify_node` exists. If it's missing (e.g. user deleted `.graphify/`), re-resolve the interpreter first. graphify is assumed to be already installed — do not attempt to install it.

```bash
if [ ! -f .graphify/.graphify_node ]; then
    GRAPHIFY_BIN=$(which graphify 2>/dev/null)
    if [ -n "$GRAPHIFY_BIN" ]; then
        NODE=$(head -1 "$GRAPHIFY_BIN" | sed 's/^#!//')
        case "$NODE" in *node*) ;; *) NODE="node" ;; esac
    else
        NODE="node"
    fi
    mkdir -p .graphify
    echo "$NODE" > .graphify/.graphify_node
fi
```

## For `graphify update` and `graphify cluster-only`

Both are non-default subcommands. `graphify update [path]` re-extracts only new or changed files; `graphify cluster-only [path]` reruns clustering on the existing graph. See `references/update.md` for both flows.

---

## For /graphify query

When `.graphify/graph.json` already exists and the user asks a question about the corpus, answer from the graph rather than rebuilding it:

```bash
graphify query "<question>"
```

Before traversal, expand the question against the graph's own vocabulary so a wording mismatch does not collapse the answer to noise. If the `graphify query` CLI is unavailable, fall back to an inline Graphology traversal of `.graphify/graph.json`. Answer using only what the graph output contains, and quote `source_location` when citing a specific fact. For that vocab-expansion step, the BFS/DFS traversal modes, the `--budget` cap, the Graphology fallback, `save-result` feedback, and the `/graphify path` and `/graphify explain` flows, see `references/query.md`.

---

## For /graphify add and --watch

Neither is part of the default build. When the user runs `/graphify add <url>` to fetch a URL into the corpus, or passes `--watch` to auto-rebuild on file changes, see `references/add-watch.md`.

---

## For the commit hook and native CLAUDE.md integration

When the user asks to install the post-commit auto-rebuild hook or wire graphify into a project's CLAUDE.md, see `references/hooks.md`.

---

## Honesty Rules

- Never invent an edge. If unsure, use AMBIGUOUS.
- Never skip the corpus check warning.
- Always show token cost in the report.
- Never hide cohesion scores behind symbols - show the raw number.
- Never run HTML viz on a graph with more than 5,000 nodes without warning the user.
