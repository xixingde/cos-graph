/**
 * Regression tests for UnicodeEncodeError on Windows cp1252 console.
 *
 * On Windows with the default cp1252 codepage, subprocess.run(..., text=True)
 * without an explicit encoding= defaults to cp1252, causing UnicodeEncodeError
 * when chunk content contains characters outside cp1252 (e.g. → ✅ ≥).
 *
 * These tests mock subprocess.run to:
 *   a) Assert that the subprocess call is made with encoding="utf-8" (or
 *      equivalent environment forcing UTF-8), so non-ASCII chars never hit
 *      cp1252 encoding.
 *   b) Assert that extract_corpus_parallel reports loud failure (non-zero exit
 *      or summary block) when ≥1 chunk fails.
 */
import { describe, it, expect, test, vi } from "vitest";

// The TS llm module does not yet expose the internal subprocess/CLI functions
// that these tests target. Skipping until those are migrated.
// import * as llm from "../src/llm/index.js";

describe.skip("SubprocessEncoding — llm subprocess internals not yet migrated", () => {
  it("subprocess called with utf8 encoding", () => {
    // Python test: llm._call_claude_cli must pass encoding="utf-8" to subprocess.run
  });

  it("subprocess does not use text true without encoding", () => {
    // Python test: text=True without encoding= relies on the locale codec
  });

  it("unicode chars survive subprocess roundtrip", () => {
    // Python test: writing file with → ✅ ≥ then passing through _call_claude_cli
  });

  it("call_llm claude-cli subprocess encoding", () => {
    // Python test: _call_llm with backend='claude-cli' must also use encoding='utf-8'
  });
});

describe.skip("LoudChunkFailure — extract_corpus_parallel not yet migrated", () => {
  it("failure count in merged result", () => {
    // Python test: failed_chunks > 0 when chunks fail
  });

  it("summary printed when chunks fail", () => {
    // Python test: summary line must appear on stderr when ≥1 chunk fails
  });

  it("no false alarm when all chunks succeed", () => {
    // Python test: failed_chunks must be 0 and no failure summary
  });
});
