import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPlatforms,
  render,
  renderAll,
  renderAlwaysOn,
  check,
  type Platform,
  type RenderedArtifact,
} from "../tools/skillgen/index.js";

const __filename = fileURLToPath(import.meta.url);
const TESTS_DIR = path.dirname(__filename);
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const SKILLGEN_DIR = path.join(REPO_ROOT, "tools", "skillgen");
const EXPECTED_DIR = path.join(SKILLGEN_DIR, "expected");

describe("skillgen", () => {
  let platforms: Record<string, Platform>;

  beforeAll(() => {
    platforms = loadPlatforms();
  });

  describe("loadPlatforms", () => {
    it("loads all platforms from platforms.toml", () => {
      const keys = Object.keys(platforms);
      expect(keys.length).toBeGreaterThan(0);
    });

    it("each platform has required fields", () => {
      for (const [key, p] of Object.entries(platforms)) {
        expect(p.key).toBe(key);
        expect(p.name).toBeTruthy();
        expect(p.bucket).toMatch(/^(split|monolith)$/);
        if (p.bucket === "split") {
          expect(p.core).toBeTruthy();
          expect(p.refs_dst).toBeTruthy();
          expect(p.dispatch).toBeTruthy();
        } else {
          expect(p.core).toBeNull();
          expect(p.refs_dst).toBeNull();
          expect(p.dispatch).toBeNull();
          expect(p.monolith).toBeTruthy();
        }
        expect(p.skill_dst).toBeTruthy();
        expect(typeof p.hooks_variant).toBe("string");
      }
    });
  });

  describe("render", () => {
    it("renders claude without error", () => {
      const artifacts = render(platforms["claude"]!);
      expect(artifacts.length).toBeGreaterThan(0);
    });

    it("renders amp without error", () => {
      const artifacts = render(platforms["amp"]!);
      expect(artifacts.length).toBeGreaterThan(0);
    });

    it("renders all split platforms", () => {
      const errors: string[] = [];
      for (const [key, p] of Object.entries(platforms)) {
        if (p.bucket === "split") {
          try {
            const artifacts = render(p);
            if (artifacts.length === 0) {
              errors.push(`${key}: no artifacts`);
            }
          } catch (e: any) {
            errors.push(`${key}: ${e.message}`);
          }
        }
      }
      expect(errors).toEqual([]);
    });

    it("rendered skill has no unfilled @@ slots", () => {
      for (const [key, p] of Object.entries(platforms)) {
        if (p.bucket === "split") {
          const artifacts = render(p);
          for (const artifact of artifacts) {
            expect(
              artifact.content,
              `unfilled slot in ${artifact.path} for ${key}`
            ).not.toMatch(/@@\w+@@/);
          }
        }
      }
    });
  });

  describe("renderAll", () => {
    it("produces artifacts for all platforms plus always-on", () => {
      const all = renderAll(platforms);
      const platformCount = Object.keys(platforms).length;
      expect(all.length).toBeGreaterThan(platformCount);
      const hasSkill = all.some((a: RenderedArtifact) =>
        a.path.includes("skill")
      );
      const hasAlwaysOn = all.some((a: RenderedArtifact) =>
        a.path.includes("always_on")
      );
      expect(hasSkill).toBe(true);
      expect(hasAlwaysOn).toBe(true);
    });
  });

  describe("renderAlwaysOn", () => {
    it("renders always-on blocks without unfilled slots", () => {
      const alwaysOn = renderAlwaysOn();
      expect(alwaysOn.length).toBeGreaterThan(0);
      for (const artifact of alwaysOn) {
        expect(artifact.content).not.toMatch(/@@\w+@@/);
      }
    });
  });

  describe("check mode (byte-identical to expected/)", () => {
    it("all rendered artifacts match expected files", () => {
      if (!fs.existsSync(EXPECTED_DIR)) {
        return; // expected/ not present yet; skip
      }
      const all = renderAll(platforms);
      const mismatches: string[] = [];
      for (const artifact of all) {
        const rel = artifact.path;
        const expectedPath = path.join(EXPECTED_DIR, rel);
        if (!fs.existsSync(expectedPath)) {
          mismatches.push(`${rel}: missing in expected/`);
          continue;
        }
        const expected = fs.readFileSync(expectedPath, "utf-8");
        if (artifact.content !== expected) {
          mismatches.push(`${rel}: content differs`);
        }
      }
      expect(mismatches).toEqual([]);
    });
  });
});
