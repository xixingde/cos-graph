/**
 * Tests for Python import resolution.
 */
import { describe, it, expect, test } from "vitest";
import * as path from "path";

// Python import resolution not yet migrated
// import { resolvePythonImports } from "../src/symbolResolution.js";

const FIXTURES = path.join(__dirname, "fixtures");

describe.skip("Python import resolution — not yet migrated", () => {
  it("resolves absolute imports", () => {});
  it("resolves relative imports", () => {});
  it("resolves from-import", () => {});
  it("resolves wildcard imports", () => {});
  it("handles __init__.py", () => {});
  it("handles missing modules gracefully", () => {});
  it("resolves sys.path entries", () => {});
  it("resolves namespace packages", () => {});
});
