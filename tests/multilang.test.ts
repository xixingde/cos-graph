/**
 * Tests for multi-language AST extraction: JS/TS, Go, Rust, SQL.
 */
import { describe, it, expect, test } from "vitest";
import * as path from "path";

// extractJs, extractGo, extractRust, extractSql not yet migrated
// import { extractJs, extractGo, extractRust, extractSql } from "../src/extract/index.js";

const FIXTURES = path.join(__dirname, "fixtures");

function _labels(r: Record<string, unknown>): string[] {
  return ((r.nodes ?? []) as Array<Record<string, unknown>>).map(
    (n) => String(n.label ?? ""),
  );
}

function _callPairs(r: Record<string, unknown>): Set<[string, string]> {
  const nodeById = new Map(
    ((r.nodes ?? []) as Array<Record<string, unknown>>).map(
      (n) => [String(n.id), String(n.label ?? "")],
    ),
  );
  const pairs = new Set<[string, string]>();
  for (const e of (r.edges ?? []) as Array<Record<string, unknown>>) {
    if (e.relation === "calls") {
      pairs.add([
        nodeById.get(String(e.source)) ?? String(e.source),
        nodeById.get(String(e.target)) ?? String(e.target),
      ]);
    }
  }
  return pairs;
}

// ── TypeScript ────────────────────────────────────────────────────────────────
describe.skip("TypeScript extraction — extractJs not yet migrated", () => {
  it("finds class", () => {});
  it("finds methods", () => {});
  it("finds function", () => {});
  it("emits calls", () => {});
  it("calls are extracted", () => {});
  it("import edges have import context", () => {});
  it("call edges have call context", () => {});
  it("no dangling edges", () => {});
});

// ── Go ────────────────────────────────────────────────────────────────────────
describe.skip("Go extraction — extractGo not yet migrated", () => {
  it("finds struct", () => {});
  it("finds functions", () => {});
  it("finds calls", () => {});
  it("finds imports", () => {});
});

// ── Rust ──────────────────────────────────────────────────────────────────────
describe.skip("Rust extraction — extractRust not yet migrated", () => {
  it("finds struct", () => {});
  it("finds functions", () => {});
  it("finds impl", () => {});
});

// ── SQL ───────────────────────────────────────────────────────────────────────
describe.skip("SQL extraction — extractSql not yet migrated", () => {
  it("finds table", () => {});
  it("finds view", () => {});
  it("finds references", () => {});
});
