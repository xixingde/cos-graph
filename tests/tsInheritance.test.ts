/**
 * Tests for TypeScript inheritance extraction.
 */
import { describe, it, expect, test } from "vitest";
import * as path from "path";

// TS inheritance extraction not yet migrated
// import { extractTsInheritance } from "../src/symbolResolution.js";

const FIXTURES = path.join(__dirname, "fixtures");

describe.skip("TS inheritance — not yet migrated", () => {
  it("extracts class extends", () => {});
  it("extracts implements", () => {});
  it("extracts interface extends", () => {});
  it("extracts mixin patterns", () => {});
  it("extracts abstract class inheritance", () => {});
  it("handles circular inheritance gracefully", () => {});
  it("handles diamond inheritance", () => {});
  it("resolves inherited members", () => {});
});
