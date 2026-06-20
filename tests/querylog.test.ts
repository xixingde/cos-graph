/** Tests for src/querylog.ts. Ported from graphify/querylog.py. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { logQuery, nodesFromResult } from "../src/querylog.js";

describe("nodesFromResult", () => {
  it("extracts node count from singular form", () => {
    expect(nodesFromResult("42 nodes found")).toBe(42);
  });

  it("extracts node count from plural form", () => {
    expect(nodesFromResult("1 node found")).toBe(1);
  });

  it("returns null when no match", () => {
    expect(nodesFromResult("nothing here")).toBeNull();
  });

  it("handles empty string", () => {
    expect(nodesFromResult("")).toBeNull();
  });

  it("extracts from longer text", () => {
    expect(nodesFromResult("Search complete: 150 nodes found in corpus")).toBe(150);
  });
});

describe("logQuery", () => {
  let tmpDir: string;
  let logFile: string;
  let origLog: string | undefined;
  let origDisable: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-qlog-"));
    logFile = path.join(tmpDir, "test-queries.log");
    origLog = process.env.GRAPHIFY_QUERY_LOG;
    origDisable = process.env.GRAPHIFY_QUERY_LOG_DISABLE;
    process.env.GRAPHIFY_QUERY_LOG = logFile;
    delete process.env.GRAPHIFY_QUERY_LOG_DISABLE;
  });

  afterEach(() => {
    if (origLog !== undefined) {
      process.env.GRAPHIFY_QUERY_LOG = origLog;
    } else {
      delete process.env.GRAPHIFY_QUERY_LOG;
    }
    if (origDisable !== undefined) {
      process.env.GRAPHIFY_QUERY_LOG_DISABLE = origDisable;
    } else {
      delete process.env.GRAPHIFY_QUERY_LOG_DISABLE;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a JSONL record to the log file", () => {
    logQuery({
      kind: "search",
      question: "find modules",
      corpus: "my-project",
    });
    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.kind).toBe("search");
    expect(rec.question).toBe("find modules");
    expect(rec.corpus).toBe("my-project");
  });

  it("includes ts, kind, question, corpus, nodes_returned fields", () => {
    logQuery({
      kind: "search",
      question: "find modules",
      corpus: "my-project",
      nodes_returned: 5,
    });
    const content = fs.readFileSync(logFile, "utf-8");
    const rec = JSON.parse(content.trim());
    expect(rec).toHaveProperty("ts");
    expect(rec.kind).toBe("search");
    expect(rec.question).toBe("find modules");
    expect(rec.corpus).toBe("my-project");
    expect(rec.nodes_returned).toBe(5);
  });

  it("extracts nodes_returned from result text when not provided", () => {
    const resultText = "42 nodes found";
    logQuery({
      kind: "search",
      question: "find modules",
      corpus: "my-project",
      result: resultText,
    });
    const content = fs.readFileSync(logFile, "utf-8");
    const rec = JSON.parse(content.trim());
    expect(rec.nodes_returned).toBe(42);
    expect(rec.result_chars).toBe(resultText.length);
  });

  it("respects GRAPHIFY_QUERY_LOG_DISABLE to disable logging", () => {
    process.env.GRAPHIFY_QUERY_LOG_DISABLE = "1";
    logQuery({
      kind: "search",
      question: "find modules",
      corpus: "my-project",
    });
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it("never throws even on invalid paths", () => {
    process.env.GRAPHIFY_QUERY_LOG = "/nonexistent/deep/path/that/cannot/be/created/queries.log";
    expect(() => {
      logQuery({
        kind: "search",
        question: "find modules",
        corpus: "my-project",
      });
    }).not.toThrow();
  });

  it("includes extra fields", () => {
    logQuery({
      kind: "search",
      question: "find modules",
      corpus: "my-project",
      custom_field: "hello",
    });
    const content = fs.readFileSync(logFile, "utf-8");
    const rec = JSON.parse(content.trim());
    expect(rec.custom_field).toBe("hello");
  });
});
