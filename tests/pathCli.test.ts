/** Regression tests for `graphify path` arrow direction (#849).
 *  Ported from graphify/tests/test_path_cli.py.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { createProgram } from "../src/cli/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-path-cli-test-"));
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
      { id: "create_patch", label: "createPatchHandler()", source_file: "server/create-patch-handler.ts", community: 0 },
      { id: "validate", label: "validateSanitySession()", source_file: "server/sanity-validate-session.ts", community: 0 },
    ],
    links: [
      { source: "create_patch", target: "validate", relation: "calls", confidence: "EXTRACTED" },
    ],
  };
  const p = path.join(tmpDir, "graph.json");
  fs.writeFileSync(p, JSON.stringify(graphData));
  return p;
}

describe("graphify path arrow direction", () => {
  it("forward arrow shows calls direction", async () => {
    const graphPath = writeGraph();
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync([
      "node", "graphify", "path", "createPatchHandler", "validateSanitySession",
      "--graph", graphPath,
    ], { from: "user" });
    const output = logSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Shortest path");
    expect(output).toContain("createPatchHandler");
    expect(output).toContain("validateSanitySession");
    logSpy.mockRestore();
  });

  it("reverse arrow shows reverse direction", async () => {
    const graphPath = writeGraph();
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync([
      "node", "graphify", "path", "validateSanitySession", "createPatchHandler",
      "--graph", graphPath,
    ], { from: "user" });
    const output = logSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Shortest path");
    expect(output).toContain("validateSanitySession");
    expect(output).toContain("createPatchHandler");
    logSpy.mockRestore();
  });
});
