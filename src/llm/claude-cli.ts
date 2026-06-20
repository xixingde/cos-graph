import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import type { ImageRef, RawExtractionResult } from "../types/llm.js";
import { BACKENDS, noWindowKwargs, resolveApiTimeout } from "./backends.js";
import { parseLlmJson, responseIsHollow } from "./parser.js";

/** Parse the JSON returned by `claude -p --output-format json`.
 *  Older CLI versions return a single envelope object. Newer (>= ~2.1)
 *  emit a JSON ARRAY of streamed event objects. Normalize both to the
 *  result dict. */
export function claudeCliEnvelope(stdout: string): Record<string, unknown> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch (exc) {
    throw new Error(
      `claude -p produced unparseable JSON envelope: ${exc}; ` +
        `first 500 chars of stdout: ${JSON.stringify(stdout.substring(0, 500))}`
    );
  }
  if (Array.isArray(envelope)) {
    const resultEvents = (envelope as Record<string, unknown>[]).filter(
      (e) => typeof e === "object" && e !== null && e.type === "result"
    );
    if (resultEvents.length > 0) return resultEvents[resultEvents.length - 1];
    if (envelope.length > 0 && typeof envelope[envelope.length - 1] === "object") {
      return envelope[envelope.length - 1] as Record<string, unknown>;
    }
    throw new Error(
      "claude -p returned a JSON array with no result object; " +
        `first 500 chars of stdout: ${JSON.stringify(stdout.substring(0, 500))}`
    );
  }
  return envelope as Record<string, unknown>;
}

/** Build user message with image notes for CLI mode (paths instead of inline base64). */
function withImageNotes(userMessage: string, refs: ImageRef[], withPaths = false): string {
  if (!refs.length) return userMessage;
  const lines = refs.map((r) => {
    if (withPaths) return `  - ${r.rel} (absolute path: ${r.path})`;
    return `  - ${r.rel}`;
  });
  return userMessage + "\n\nImage files in this chunk:\n" + lines.join("\n") +
    "\nOpen each image with your Read tool before extracting the graph.";
}

/** Call Claude via the locally-installed Claude Code CLI (`claude -p`). */
export function callClaudeCli(
  userMessage: string,
  maxTokens = 8192,
  opts: { deepMode?: boolean; images?: ImageRef[]; extractionSystem?: string } = {}
): RawExtractionResult {
  const { deepMode = false, images, extractionSystem } = opts;

  // On Windows, prefer claude.cmd over claude.ps1
  let claudeCmd = "claude";
  if (process.platform === "win32") {
    // Use which-equivalent: just try .cmd suffix
    claudeCmd = "claude.cmd";
  }

  const addDirArgs: string[] = [];
  let msg = userMessage;
  if (images && images.length > 0) {
    msg = withImageNotes(msg, images, true);
    const seenDirs = new Set<string>();
    for (const r of images) {
      const d = dirname(r.path);
      if (!seenDirs.has(d)) {
        seenDirs.add(d);
        addDirArgs.push("--add-dir", d);
      }
    }
  }

  const cliArgs = [
    claudeCmd, "-p",
    "--output-format", "json",
    "--no-session-persistence",
    ...addDirArgs,
    "--system-prompt", extractionSystem || "",
  ];

  const cliModel = (process.env.GRAPHIFY_CLAUDE_CLI_MODEL || "").trim();
  if (cliModel) cliArgs.push("--model", cliModel);

  const timeout = resolveApiTimeout();
  const noWindow = noWindowKwargs();

  let stdout: string;
  let stderr: string;
  try {
    const result = execFileSync(claudeCmd, cliArgs.slice(1), {
      input: msg,
      encoding: "utf-8",
      timeout: timeout * 1000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: !!(noWindow.windowsHide),
    });
    stdout = result;
    stderr = "";
  } catch (exc: unknown) {
    const err = exc as { status?: number; stderr?: string };
    throw new Error(
      `claude -p exited ${err.status || "unknown"}: ${(err.stderr || "").substring(0, 500)}`
    );
  }

  const envelope = claudeCliEnvelope(stdout);

  const rawContent = (envelope.result as string) || "";
  const parsed = parseLlmJson(rawContent || "{}") as Record<string, unknown>;
  const resultObj = parsed as unknown as RawExtractionResult;

  const usage = (envelope.usage as Record<string, unknown>) || {};
  resultObj.input_tokens =
    (Number(usage.input_tokens) || 0) +
    (Number(usage.cache_read_input_tokens) || 0) +
    (Number(usage.cache_creation_input_tokens) || 0);
  resultObj.output_tokens = Number(usage.output_tokens) || 0;

  const modelUsage = (envelope.modelUsage as Record<string, unknown>) || {};
  resultObj.model = Object.keys(modelUsage)[0] || "claude-code-plan";

  const stopReason = (envelope.stop_reason as string) || "";
  resultObj.finish_reason = stopReason === "max_tokens" ? "length" : "stop";

  if (responseIsHollow(rawContent, parsed) && resultObj.finish_reason !== "length") {
    console.error(
      "[graphify] claude-cli returned a hollow response; treating as " +
        "truncation so adaptive retry can bisect the chunk."
    );
    resultObj.finish_reason = "length";
  }
  return resultObj;
}
