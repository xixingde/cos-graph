/**
 * Tests for Swift cross-file call resolution.
 */
import { describe, it, expect, test } from "vitest";
import * as path from "path";

// Swift cross-file call resolution not yet migrated
// import { resolveSwiftCrossFileCalls } from "../src/symbolResolution.js";

const FIXTURES = path.join(__dirname, "fixtures");

describe.skip("Swift cross-file calls — not yet migrated", () => {
  it("resolves calls across files within same module", () => {});
  it("resolves calls to public declarations in other modules", () => {});
  it("resolves protocol conformance calls", () => {});
  it("resolves extension method calls", () => {});
  it("resolves generic function calls", () => {});
  it("handles unresolved calls gracefully", () => {});
});
