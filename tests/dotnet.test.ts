/**
 * Tests for .NET project file extraction (.sln, .csproj, .razor).
 */
import { describe, it, expect, test } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { CODE_EXTENSIONS } from "../src/detect.js";
import { getExtractor, getRegisteredExtensions } from "../src/extract/registry.js";

// Specific .NET extractors not yet migrated to TS
// import { extractSln, extractSlnx, extractCsproj, extractRazor } from "../src/extract/index.js";

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

// ── .sln ─────────────────────────────────────────────────────────────────

test.skip("sln extracts projects — extractSln not yet migrated", () => {
  // const r = extractSln(path.join(FIXTURES, "sample.sln"));
  // expect(r.error).toBeUndefined();
  // const labels = new Set(_labels(r));
  // expect(labels.has("WebApi")).toBe(true);
  // expect(labels.has("Domain")).toBe(true);
  // expect(labels.has("Tests")).toBe(true);
});

test.skip("sln contains edges — extractSln not yet migrated", () => {
  // const r = extractSln(path.join(FIXTURES, "sample.sln"));
  // const contains = ((r.edges ?? []) as any[]).filter((e) => e.relation === "contains");
  // expect(contains.length).toBe(3);
});

test.skip("sln project dependency — extractSln not yet migrated", () => {
  // const r = extractSln(path.join(FIXTURES, "sample.sln"));
  // expect(_relations(r).has("imports")).toBe(true);
});

// ── .slnx ────────────────────────────────────────────────────────────────

test.skip("slnx extracts projects — extractSlnx not yet migrated", () => {});
test.skip("slnx contains edges — extractSlnx not yet migrated", () => {});
test.skip("slnx project dependency — extractSlnx not yet migrated", () => {});
test.skip("slnx invalid xml — extractSlnx not yet migrated", () => {});
test.skip("slnx missing file — extractSlnx not yet migrated", () => {});

// ── .csproj ──────────────────────────────────────────────────────────────

test.skip("csproj packages — extractCsproj not yet migrated", () => {});
test.skip("csproj project references — extractCsproj not yet migrated", () => {});
test.skip("csproj target framework — extractCsproj not yet migrated", () => {});
test.skip("csproj sdk — extractCsproj not yet migrated", () => {});
test.skip("csproj invalid xml — extractCsproj not yet migrated", () => {});

// ── .razor ───────────────────────────────────────────────────────────────

test.skip("razor using and inject — extractRazor not yet migrated", () => {});
test.skip("razor components — extractRazor not yet migrated", () => {});
test.skip("razor page route — extractRazor not yet migrated", () => {});
test.skip("razor inherits — extractRazor not yet migrated", () => {});
test.skip("razor code methods — extractRazor not yet migrated", () => {});
test.skip("razor missing file — extractRazor not yet migrated", () => {});

// ── dispatch & detect integration ────────────────────────────────────────

test("dispatch table", () => {
  for (const ext of [".sln", ".slnx", ".csproj", ".fsproj", ".vbproj", ".razor", ".cshtml"]) {
    expect(getExtractor(`foo${ext}`)).not.toBeNull();
  }
});

test("code extensions", () => {
  for (const ext of [".sln", ".slnx", ".csproj", ".fsproj", ".vbproj", ".razor", ".cshtml"]) {
    expect(CODE_EXTENSIONS.has(ext)).toBe(true);
  }
});
