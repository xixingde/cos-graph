/** Tests for graphify query CLI context filtering.
 *  Ported from graphify/tests/test_query_cli.py.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { createProgram } from "../src/cli/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-query-cli-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeGraph(): string {
  const graphData = {
    directed: false,
    multigraph: false,
    graph: {},
    nodes: [
      { id: "n1", label: "extract", source_file: "extract.py", source_location: "L10", community: 0 },
      { id: "n2", label: "cluster", source_file: "cluster.py", source_location: "L5", community: 0 },
      { id: "n3", label: "build", source_file: "build.py", source_location: "L1", community: 1 },
    ],
    links: [
      { source: "n1", target: "n2", relation: "calls", confidence: "EXTRACTED", context: "call" },
      { source: "n2", target: "n3", relation: "imports", confidence: "EXTRACTED", context: "import" },
    ],
  };
  const p = path.join(tmpDir, "graph.json");
  fs.writeFileSync(p, JSON.stringify(graphData));
  return p;
}

describe("graphify query CLI", () => {
  it("explicit context filter works", async () => {
    const graphPath = writeGraph();
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync([
      "node", "graphify", "query", "extract",
      "--context", "call",
      "--graph", graphPath,
    ], { from: "user" });
    const output = logSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("cluster");
    logSpy.mockRestore();
  });

  it("heuristic context filter works", async () => {
    const graphPath = writeGraph();
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync([
      "node", "graphify", "query", "who calls extract",
      "--graph", graphPath,
    ], { from: "user" });
    const output = logSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("cluster");
    logSpy.mockRestore();
  });

  it("rejects oversized graph", async () => {
    const graphPath = writeGraph();
    // Temporarily set _MAX_GRAPH_FILE_BYTES to 16 via env
    const origMax = process.env.GRAPHIFY_MAX_GRAPH_FILE_BYTES;
    process.env.GRAPHIFY_MAX_GRAPH_FILE_BYTES = "16";
    const program = createProgram();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await program.parseAsync([
        "node", "graphify", "query", "extract",
        "--graph", graphPath,
      ], { from: "user" });
    } catch (e: any) {
      expect(e.message).toContain("process.exit");
    }
    exitSpy.mockRestore();
    if (origMax !== undefined) process.env.GRAPHIFY_MAX_GRAPH_FILE_BYTES = origMax;
    else delete process.env.GRAPHIFY_MAX_GRAPH_FILE_BYTES;
  });
});
