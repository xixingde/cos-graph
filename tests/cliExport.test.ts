/** Integration tests for graphify CLI export commands.
 *  Ported from graphify/tests/test_cli_export.py.
 *
 *  These tests exercise the Commander.js CLI command registration by
 *  calling createProgram().parseAsync() with mocked dependencies.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { createProgram } from "../src/cli/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-cli-export-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeMinimalGraph(outDir: string): void {
  const graphDir = path.join(outDir, "graphify-out");
  fs.mkdirSync(graphDir, { recursive: true });
  const graphData = {
    directed: false,
    multigraph: false,
    graph: {},
    nodes: [
      { id: "n1", label: "AuthService", source_file: "src/auth.py", community: 0 },
      { id: "n2", label: "UserService", source_file: "src/user.py", community: 0 },
      { id: "n3", label: "DBHelper", source_file: "src/db.ts", community: 1 },
    ],
    links: [
      { source: "n1", target: "n2", relation: "IMPORTS", confidence: "EXTRACTED" },
      { source: "n2", target: "n3", relation: "CALLS", confidence: "INFERRED" },
    ],
  };
  fs.writeFileSync(path.join(graphDir, "graph.json"), JSON.stringify(graphData));

  const labelsData: Record<string, string> = { "0": "Auth", "1": "DB" };
  fs.writeFileSync(
    path.join(graphDir, ".graphify_labels.json"),
    JSON.stringify(labelsData)
  );
}

// ── export html ──────────────────────────────────────────────────────────────

describe("graphify export html", () => {
  it("creates graph.html file", async () => {
    writeMinimalGraph(tmpDir);
    const program = createProgram();
    await program.parseAsync([
      "node", "graphify", "export", "html",
      "--graph", path.join(tmpDir, "graphify-out", "graph.json"),
    ], { from: "user" });
    const htmlPath = path.join(tmpDir, "graphify-out", "graph.html");
    expect(fs.existsSync(htmlPath)).toBe(true);
    expect(fs.statSync(htmlPath).size).toBeGreaterThan(0);
  });

  it("errors when graph file not found", async () => {
    const program = createProgram();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await program.parseAsync([
        "node", "graphify", "export", "html",
        "--graph", path.join(tmpDir, "nonexistent", "graph.json"),
      ], { from: "user" });
    } catch (e: any) {
      expect(e.message).toContain("process.exit(1)");
    }
    exitSpy.mockRestore();
  });
});

// ── export graphml ───────────────────────────────────────────────────────────

describe("graphify export graphml", () => {
  it("creates graph.graphml file", async () => {
    writeMinimalGraph(tmpDir);
    const program = createProgram();
    await program.parseAsync([
      "node", "graphify", "export", "graphml",
      "--graph", path.join(tmpDir, "graphify-out", "graph.json"),
    ], { from: "user" });
    const gmlPath = path.join(tmpDir, "graphify-out", "graph.graphml");
    expect(fs.existsSync(gmlPath)).toBe(true);
    const content = fs.readFileSync(gmlPath, "utf-8");
    expect(content).toContain("<graphml");
  });
});

// ── export unknown format ───────────────────────────────────────────────────

describe("graphify export unknown format", () => {
  it("errors on unknown export format", async () => {
    const program = createProgram();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await program.parseAsync([
        "node", "graphify", "export", "pdf",
        "--graph", path.join(tmpDir, "graphify-out", "graph.json"),
      ], { from: "user" });
    } catch (e: any) {
      expect(e.message).toContain("process.exit");
    }
    exitSpy.mockRestore();
  });
});

// ── query ────────────────────────────────────────────────────────────────────

describe("graphify query", () => {
  it("returns output", async () => {
    writeMinimalGraph(tmpDir);
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync([
      "node", "graphify", "query", "test",
      "--graph", path.join(tmpDir, "graphify-out", "graph.json"),
    ], { from: "user" });
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("errors when graph missing", async () => {
    const program = createProgram();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await program.parseAsync([
        "node", "graphify", "query", "anything",
        "--graph", path.join(tmpDir, "nonexistent", "graph.json"),
      ], { from: "user" });
    } catch (e: any) {
      expect(e.message).toContain("process.exit");
    }
    exitSpy.mockRestore();
  });
});

// ── path ─────────────────────────────────────────────────────────────────────

describe("graphify path", () => {
  it("runs without error when graph exists", async () => {
    writeMinimalGraph(tmpDir);
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync([
      "node", "graphify", "path", "AuthService", "DBHelper",
      "--graph", path.join(tmpDir, "graphify-out", "graph.json"),
    ], { from: "user" });
    logSpy.mockRestore();
  });

  it("errors when graph missing", async () => {
    const program = createProgram();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await program.parseAsync([
        "node", "graphify", "path", "a", "b",
        "--graph", path.join(tmpDir, "nonexistent", "graph.json"),
      ], { from: "user" });
    } catch (e: any) {
      expect(e.message).toContain("process.exit");
    }
    exitSpy.mockRestore();
  });
});

// ── explain ──────────────────────────────────────────────────────────────────

describe("graphify explain", () => {
  it("runs without error when graph exists", async () => {
    writeMinimalGraph(tmpDir);
    const program = createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync([
      "node", "graphify", "explain", "test",
      "--graph", path.join(tmpDir, "graphify-out", "graph.json"),
    ], { from: "user" });
    logSpy.mockRestore();
  });

  it("errors when graph missing", async () => {
    const program = createProgram();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await program.parseAsync([
        "node", "graphify", "explain", "anything",
        "--graph", path.join(tmpDir, "nonexistent", "graph.json"),
      ], { from: "user" });
    } catch (e: any) {
      expect(e.message).toContain("process.exit");
    }
    exitSpy.mockRestore();
  });
});
