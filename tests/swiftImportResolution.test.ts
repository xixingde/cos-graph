/**
 * Tests for Swift import resolution.
 */
import { describe, it, expect, test } from "vitest";
import * as path from "path";

// Swift import resolution not yet migrated
// import { resolveSwiftImports } from "../src/symbolResolution.js";

const FIXTURES = path.join(__dirname, "fixtures");

describe.skip("Swift import resolution — not yet migrated", () => {
  it("resolves module imports", () => {});
  it("resolves target-specific imports", () => {});
  it("resolves test imports with @testable", () => {});
  it("handles missing modules gracefully", () => {});
  it("resolves SPM package dependencies", () => {});
});
