/**
 * Tests for Java type resolution (extracting type hierarchies and generics).
 */
import { describe, it, expect, test } from "vitest";
import * as path from "path";

// Java type resolution not yet migrated
// import { resolveJavaTypes } from "../src/symbolResolution.js";

const FIXTURES = path.join(__dirname, "fixtures");

describe.skip("Java type resolution — not yet migrated", () => {
  it("resolves generic types", () => {});
  it("resolves inheritance chain", () => {});
  it("resolves interface implementations", () => {});
  it("resolves type parameters", () => {});
  it("resolves nested class types", () => {});
  it("resolves wildcard types", () => {});
});
