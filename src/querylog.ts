/** Query logging for graphify — append-only JSONL, fail-silent. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const _NODES_RE = /(\d+)\s+nodes?\s+found/;

function _logPath(): string | null {
  if (
    (process.env.GRAPHIFY_QUERY_LOG_DISABLE || "").toLowerCase() === "1" ||
    (process.env.GRAPHIFY_QUERY_LOG_DISABLE || "").toLowerCase() === "true" ||
    (process.env.GRAPHIFY_QUERY_LOG_DISABLE || "").toLowerCase() === "yes"
  ) {
    return null;
  }
  const override = (process.env.GRAPHIFY_QUERY_LOG || "").trim();
  if (override) {
    return override.startsWith("~")
      ? path.join(os.homedir(), override.slice(1))
      : override;
  }
  return path.join(os.homedir(), ".cache", "graphify-queries.log");
}

function _logResponses(): boolean {
  const v = (process.env.GRAPHIFY_QUERY_LOG_RESPONSES || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function nodesFromResult(result: string): number | null {
  const m = _NODES_RE.exec(result || "");
  return m ? parseInt(m[1], 10) : null;
}

export interface LogQueryOptions {
  kind: string;
  question: string;
  corpus: string;
  result?: string;
  nodes_returned?: number | null;
  duration_ms?: number | null;
  [key: string]: unknown;
}

export function logQuery(opts: LogQueryOptions): void {
  try {
    const p = _logPath();
    if (p === null) return;

    let nodesReturned = opts.nodes_returned ?? null;
    if (nodesReturned === null && opts.result != null) {
      nodesReturned = nodesFromResult(opts.result);
    }

    const rec: Record<string, unknown> = {
      ts: new Date().toISOString(),
      kind: opts.kind,
      question: opts.question,
      corpus: opts.corpus,
      nodes_returned: nodesReturned,
    };

    if (opts.result != null) {
      rec.result_chars = opts.result.length;
    }
    if (opts.duration_ms != null) {
      rec.duration_ms = Math.round(opts.duration_ms * 1000) / 1000;
    }

    for (const [k, v] of Object.entries(opts)) {
      if (
        k !== "kind" &&
        k !== "question" &&
        k !== "corpus" &&
        k !== "result" &&
        k !== "nodes_returned" &&
        k !== "duration_ms" &&
        v != null
      ) {
        rec[k] = v;
      }
    }

    if (opts.result != null && _logResponses()) {
      rec.response = opts.result;
    }

    const dir = path.dirname(p);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(p, JSON.stringify(rec) + "\n", "utf-8");
  } catch {
    // fail-silent: never throw
  }
}
