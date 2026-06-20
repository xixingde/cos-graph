/** Regression tests for `graphify explain` arrow direction (#853).
 *  Ported from graphify/tests/test_explain_cli.py.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { createProgram } from "../src/cli/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-explain-cli-test-"));
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
      { id: "validate", label: "validateSanitySession()", source_file: "server/sanity-validate-session.ts", community: 0 },
      { id: "create_patch", label: "createPatchHandler()", source_file: "server/create-patch-handler.ts", community: 0 },
      { id: "create_edit", label: "createEditHandler()", source_file: "server/create-edit-handler.ts", community: 0 },
      { id: "stable_stringify", label: "stableStringify()", source_file: "shared/stringify.ts", community: 0 },
    ],
    links: [
      { source: "create_patch", target: "validate", relation: "calls", confidence: "EXTRACTED" },
      { source: "create_edit", target: "validate", relation: "calls", confidence: "EXTRACTED" },
      { source: "validate", target: "stable_stringify", relation: "calls", confidence: "EXTRACTED" },
    ],
  };
  const p = path.join(tmpDir, "graph.json");
  fs.writeFileSync(p, JSON.stringify(graphData));
  return p;
}

describe("graphify explain arrow direction", () => {
  it("callee shows callers as inbound", async () => {
    const graphPath = writeGraph();
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync([
      "node", "graphify", "explain", "validateSanitySession",
      "--graph", graphPath,
    ], { from: "user" });
    const output = logSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("createPatchHandler");
    expect(output).toContain("createEditHandler");
    logSpy.mockRestore();
  });

  it("caller shows callee as outbound", async () => {
    const graphPath = writeGraph();
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync([
      "node", "graphify", "explain", "createPatchHandler",
      "--graph", graphPath,
    ], { from: "user" });
    const output = logSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("validateSanitySession");
    logSpy.mockRestore();
  });
});
