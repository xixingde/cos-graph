// Token-reduction benchmark -- measures how much context graphify saves vs naive full-corpus approach

import * as fs from "fs";
import * as path from "path";

import Graph from "graphology";
import { edgeData } from "./build.js";
import { checkGraphFileSizeCap } from "./security.js";
import { graphFromJSON } from "./graph/index.js";

const _CHARS_PER_TOKEN = 4;

export interface BenchmarkResult {
  corpus_tokens?: number;
  corpus_words?: number;
  nodes?: number;
  edges?: number;
  avg_query_tokens?: number;
  reduction_ratio?: number;
  per_question?: any[];
  error?: string;
}

const _STOP_WORDS = new Set([
  "the", "a", "is", "how", "what", "are", "does", "to", "of",
  "in", "on", "for", "from", "with", "that", "this", "and",
  "or", "but", "it",
]);

export function queryTerms(question: string): string[] {
  return question
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !_STOP_WORDS.has(w));
}

function _safe(unicodeChar: string, asciiFallback: string): string {
  const encoding = (process.stdout as any).encoding || "";
  try {
    if (encoding) {
      // Check if the encoding can represent the character
      const buf = Buffer.from(unicodeChar, encoding);
      return buf.toString(encoding) === unicodeChar ? unicodeChar : asciiFallback;
    }
    return unicodeChar;
  } catch {
    return asciiFallback;
  }
}

function _hr(width: number = 50): string {
  return _safe("--", "-").repeat(width);
}

function _estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / _CHARS_PER_TOKEN));
}

function _querySubgraphTokens(G: Graph, question: string, depth: number = 3): number {
  const terms = queryTerms(question);
  const scored: [number, string][] = [];
  G.forEachNode((nid: string, attrs: Record<string, unknown>) => {
    const label = String(attrs.label || "").toLowerCase();
    const score = terms.filter((t) => label.includes(t)).length;
    if (score > 0) {
      scored.push([score, nid]);
    }
  });
  scored.sort((a, b) => b[0] - a[0]);
  const startNodes = scored.slice(0, 3).map(([, nid]) => nid);
  if (startNodes.length === 0) return 0;

  const visited: Set<string> = new Set(startNodes);
  let frontier = new Set(startNodes);
  const edgesSeen: [string, string][] = [];
  for (let i = 0; i < depth; i++) {
    const nextFrontier: Set<string> = new Set();
    for (const n of frontier) {
      for (const neighbor of G.neighbors(n)) {
        if (!visited.has(neighbor)) {
          nextFrontier.add(neighbor);
          edgesSeen.push([n, neighbor]);
        }
      }
    }
    for (const n of nextFrontier) {
      visited.add(n);
    }
    frontier = nextFrontier;
  }

  const lines: string[] = [];
  for (const nid of visited) {
    const d = G.getNodeAttributes(nid);
    lines.push(
      `NODE ${d.label || nid} src=${d.source_file || ""} loc=${d.source_location || ""}`
    );
  }
  for (const [u, v] of edgesSeen) {
    if (visited.has(u) && visited.has(v)) {
      const d = edgeData(G, u, v);
      const uLabel = G.getNodeAttributes(u).label || u;
      const vLabel = G.getNodeAttributes(v).label || v;
      lines.push(
        `EDGE ${uLabel} --${d.relation || ""}--> ${vLabel}`
      );
    }
  }

  return _estimateTokens(lines.join("\n"));
}

const _SAMPLE_QUESTIONS = [
  "how does authentication work",
  "what is the main entry point",
  "how are errors handled",
  "what connects the data layer to the api",
  "what are the core abstractions",
];

export function runBenchmark(
  graphPath: string = "graphify-out/graph.json",
  corpusWords?: number,
  questions?: string[]
): BenchmarkResult {
  checkGraphFileSizeCap(graphPath);
  let data = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
  if (!("links" in data) && "edges" in data) {
    data.links = data.edges;
  }
  const G = graphFromJSON(data);

  if (corpusWords === undefined) {
    corpusWords = G.order * 50;
  }

  const corpusTokens = Math.floor((corpusWords * 100) / 75);

  const qs = questions || _SAMPLE_QUESTIONS;
  const perQuestion: any[] = [];
  for (const q of qs) {
    const qt = _querySubgraphTokens(G, q);
    if (qt > 0) {
      perQuestion.push({
        question: q,
        query_tokens: qt,
        reduction: Math.round((corpusTokens / qt) * 10) / 10,
      });
    }
  }

  if (perQuestion.length === 0) {
    return { error: "No matching nodes found for sample questions. Build the graph first." };
  }

  const avgQueryTokens =
    Math.floor(perQuestion.reduce((s, p) => s + p.query_tokens, 0) / perQuestion.length);
  const reductionRatio =
    avgQueryTokens > 0 ? Math.round((corpusTokens / avgQueryTokens) * 10) / 10 : 0;

  return {
    corpus_tokens: corpusTokens,
    corpus_words: corpusWords,
    nodes: G.order,
    edges: G.size,
    avg_query_tokens: avgQueryTokens,
    reduction_ratio: reductionRatio,
    per_question: perQuestion,
  };
}

export function printBenchmark(result: BenchmarkResult): void {
  if (result.error) {
    console.log(`Benchmark error: ${result.error}`);
    return;
  }

  const arrow = _safe("->", "->");
  console.log(`\ngraphify token reduction benchmark`);
  console.log(_hr(50));
  console.log(
    `  Corpus:          ${result.corpus_words!.toLocaleString()} words ${arrow} ~${result.corpus_tokens!.toLocaleString()} tokens (naive)`
  );
  console.log(
    `  Graph:           ${result.nodes!.toLocaleString()} nodes, ${result.edges!.toLocaleString()} edges`
  );
  console.log(
    `  Avg query cost:  ~${result.avg_query_tokens!.toLocaleString()} tokens`
  );
  console.log(
    `  Reduction:       ${result.reduction_ratio}x fewer tokens per query`
  );
  console.log(`\n  Per question:`);
  for (const p of result.per_question!) {
    console.log(`    [${p.reduction}x] ${p.question.slice(0, 55)}`);
  }
  console.log();
}
