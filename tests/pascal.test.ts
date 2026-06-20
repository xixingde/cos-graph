/**
 * Tests for the Pascal/Delphi extractor.
 */
import { describe, it, expect, test } from "vitest";
import * as path from "path";

// extractPascal not yet migrated to TS
// import { extractPascal } from "../src/extract/index.js";

const FIXTURES = path.join(__dirname, "fixtures");

function _labels(r: Record<string, unknown>): string[] {
  return ((r.nodes ?? []) as Array<Record<string, unknown>>).map(
    (n) => String(n.label ?? ""),
  );
}

function _relations(r: Record<string, unknown>): Set<string> {
  return new Set(
    ((r.edges ?? []) as Array<Record<string, unknown>>).map(
      (e) => String(e.relation ?? ""),
    ),
  );
}

describe.skip("Pascal extraction — extractPascal not yet migrated", () => {
  it("no error", () => {});
  it("finds unit", () => {});
  it("finds classes", () => {});
  it("finds interface", () => {});
  it("finds methods", () => {});
  it("finds imports", () => {});
  it("import edges have import context", () => {});
  it("finds inherits", () => {});
  it("inherits from base", () => {});
  it("finds calls", () => {});
  it("call edges have call context", () => {});
});
