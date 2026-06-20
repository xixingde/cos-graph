/**
 * Tests for import extension resolution (resolving .js/.ts/.jsx/.tsx extensions).
 */
import { describe, it, expect, test } from "vitest";

// Import extension resolution functions not yet migrated
// import { resolveImportExtension } from "../src/symbolResolution.js";

describe.skip("Import extension resolution — not yet migrated", () => {
  it("resolves .js extension from .ts source", () => {});
  it("resolves .ts extension from .tsx source", () => {});
  it("resolves .jsx extension from .js source", () => {});
  it("handles extensionless imports", () => {});
  it("handles index file resolution", () => {});
  it("handles path aliases", () => {});
});
