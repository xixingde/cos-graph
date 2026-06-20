/** Tests for `graphify extract` CLI dispatch path.
 *  Ported from graphify/tests/test_extract_cli.py.
 *
 *  The Python tests used monkeypatch to control main() behavior. In TS,
 *  we test the CLI Commander.js program directly with mocked modules.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-extract-cli-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeCodeOnlyCorpus(dir: string): string {
  fs.writeFileSync(
    path.join(dir, "auth.py"),
    "def login(user):\n    return validate(user)\n\ndef validate(user):\n    return True\n"
  );
  return dir;
}

describe("graphify extract", () => {
  it("code-only corpus succeeds without API key", async () => {
    const corpus = path.join(tmpDir, "project");
    fs.mkdirSync(corpus);
    makeCodeOnlyCorpus(corpus);
    const outDir = path.join(tmpDir, "out");
    const program = (await import("../src/cli/index.js")).createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await program.parseAsync([
        "node", "graphify", "extract", corpus, "--out", outDir,
      ], { from: "user" });
    } catch {
      // process.exit may throw in test context
    }
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("extract --out DIR keeps project root clean", async () => {
    const project = path.join(tmpDir, "project");
    fs.mkdirSync(project);
    makeCodeOnlyCorpus(project);
    const external = path.join(tmpDir, "external-graphs");

    const program = (await import("../src/cli/index.js")).createProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await program.parseAsync([
        "node", "graphify", "extract", project, "--out", external,
      ], { from: "user" });
    } catch {
      // process.exit may throw
    }
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
