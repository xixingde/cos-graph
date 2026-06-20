/**
 * Tests for JS/TS import resolution.
 */
import { describe, it, expect, test } from "vitest";
import * as path from "path";

// JS import resolution not yet migrated
// import { resolveJsImports } from "../src/symbolResolution.js";

const FIXTURES = path.join(__dirname, "fixtures");

describe.skip("JS import resolution — not yet migrated", () => {
  it("resolves default imports", () => {});
  it("resolves named imports", () => {});
  it("resolves namespace imports", () => {});
  it("resolves dynamic imports", () => {});
  it("resolves re-exports", () => {});
  it("resolves barrel file exports", () => {});
  it("resolves relative path imports", () => {});
  it("resolves node_modules imports", () => {});
  it("resolves tsconfig paths", () => {});
  it("handles circular imports", () => {});
  it("handles missing modules gracefully", () => {});
});
