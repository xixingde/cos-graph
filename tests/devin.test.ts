/** Tests for graphify devin install / uninstall commands.
 *  Ported from graphify/tests/test_devin.py.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { devinInstall, devinUninstall, devinRulesInstall, devinRulesUninstall } from "../src/install/platforms/devin.js";
import { PLATFORM_CONFIG, platformSkillDestination } from "../src/install/platform-config.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-devin-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Platform config sanity ──────────────────────────────────────────────────

describe("devin platform config", () => {
  it("devin is registered in PLATFORM_CONFIG", () => {
    expect("devin" in PLATFORM_CONFIG).toBe(true);
    expect(PLATFORM_CONFIG.devin.skillFile).toBe("skill-devin.md");
    expect(PLATFORM_CONFIG.devin.claudeMd).toBe(false);
  });

  it("devin user-scope destination uses home dir", () => {
    const dst = platformSkillDestination("devin", { project: false });
    expect(dst).toContain(".config");
    expect(dst).toContain("devin");
  });

  it("devin project-scope destination uses project dir", () => {
    const dst = platformSkillDestination("devin", { project: true, projectDir: tmpDir });
    expect(dst).toBe(path.join(tmpDir, ".devin", "skills", "graphify", "SKILL.md"));
  });
});

// ── Rules install ────────────────────────────────────────────────────────────

describe("devin rules install", () => {
  it("writes .windsurf/rules/graphify.md", () => {
    devinRulesInstall(tmpDir);
    const rulesPath = path.join(tmpDir, ".windsurf", "rules", "graphify.md");
    expect(fs.existsSync(rulesPath)).toBe(true);
    const content = fs.readFileSync(rulesPath, "utf-8");
    expect(content).toContain("graphify");
    expect(content).toContain("GRAPH_REPORT.md");
  });

  it("rules content recommends graphify query", () => {
    devinRulesInstall(tmpDir);
    const rulesPath = path.join(tmpDir, ".windsurf", "rules", "graphify.md");
    const content = fs.readFileSync(rulesPath, "utf-8");
    expect(content).toContain("graphify query");
  });

  it("install is idempotent", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    devinRulesInstall(tmpDir);
    devinRulesInstall(tmpDir);
    const output = logSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("no change");
    logSpy.mockRestore();
  });

  it("rules uninstall does nothing when not installed", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    devinRulesUninstall(tmpDir);
    logSpy.mockRestore();
  });
});

// ── Devin install (project) ──────────────────────────────────────────────────

describe("devin project install", () => {
  it("project install creates skill file and rules", () => {
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    devinInstall(projectDir, true);
    logSpy.mockRestore();

    const skillPath = path.join(projectDir, ".devin", "skills", "graphify", "SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("graphify");
  });

  it("project install creates rules file", () => {
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    devinInstall(projectDir, true);
    const rulesPath = path.join(projectDir, ".windsurf", "rules", "graphify.md");
    expect(fs.existsSync(rulesPath)).toBe(true);
    const content = fs.readFileSync(rulesPath, "utf-8");
    expect(content).toContain("graphify");
    expect(content).toContain("GRAPH_REPORT.md");
  });
});

// ── Devin uninstall ──────────────────────────────────────────────────────────

describe("devin uninstall", () => {
  it("project uninstall removes skill file and rules", () => {
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    devinInstall(projectDir, true);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    devinUninstall(projectDir, true);
    logSpy.mockRestore();

    const rulesPath = path.join(projectDir, ".windsurf", "rules", "graphify.md");
    expect(fs.existsSync(rulesPath)).toBe(false);
  });

  it("uninstall prints nothing to remove when not installed", () => {
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    devinUninstall(projectDir, true);
    const output = logSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("nothing to remove");
    logSpy.mockRestore();
  });
});
