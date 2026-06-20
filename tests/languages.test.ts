/**
 * Tests for language extractors: Java, C, C++, Ruby, C#, Kotlin, Scala, PHP,
 * Swift, Go, Julia, Fortran, JS/TS, .NET project files, Groovy, DM, PowerShell, Apex, Verilog.
 */
import { describe, it, expect, test } from "vitest";
import * as path from "path";

// Most extractors not yet migrated to TS — import when available
// import { extractJava, extractC, extractCpp, extractRuby, ... } from "../src/extract/index.js";

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

// ── Java ──────────────────────────────────────────────────────────────────────
describe.skip("Java extraction — extractJava not yet migrated", () => {
  it("no error", () => {});
  it("finds class", () => {});
  it("finds interface", () => {});
  it("finds methods", () => {});
  it("finds imports", () => {});
  it("finds inherits", () => {});
  it("finds calls", () => {});
  it("call edges have call context", () => {});
  it("import edges have import context", () => {});
  it("no dangling edges", () => {});
});

// ── C ────────────────────────────────────────────────────────────────────────
describe.skip("C extraction — extractC not yet migrated", () => {
  it("no error", () => {});
  it("finds functions", () => {});
  it("finds struct", () => {});
  it("finds calls", () => {});
  it("finds includes", () => {});
});

// ── C++ ──────────────────────────────────────────────────────────────────────
describe.skip("C++ extraction — extractCpp not yet migrated", () => {
  it("no error", () => {});
  it("finds class", () => {});
  it("finds methods", () => {});
  it("finds includes", () => {});
});

// ── Ruby ─────────────────────────────────────────────────────────────────────
describe.skip("Ruby extraction — extractRuby not yet migrated", () => {
  it("no error", () => {});
  it("finds class", () => {});
  it("finds methods", () => {});
  it("finds requires", () => {});
});

// ── C# ──────────────────────────────────────────────────────────────────────
describe.skip("C# extraction — extractCsharp not yet migrated", () => {
  it("no error", () => {});
  it("finds class", () => {});
  it("finds methods", () => {});
  it("finds using", () => {});
});

// ── Kotlin ───────────────────────────────────────────────────────────────────
describe.skip("Kotlin extraction — extractKotlin not yet migrated", () => {
  it("no error", () => {});
  it("finds class", () => {});
  it("finds functions", () => {});
  it("finds imports", () => {});
});

// ── Scala ────────────────────────────────────────────────────────────────────
describe.skip("Scala extraction — extractScala not yet migrated", () => {
  it("no error", () => {});
  it("finds class", () => {});
  it("finds object", () => {});
  it("finds imports", () => {});
});

// ── PHP ──────────────────────────────────────────────────────────────────────
describe.skip("PHP extraction — extractPhp not yet migrated", () => {
  it("no error", () => {});
  it("finds class", () => {});
  it("finds functions", () => {});
  it("finds use", () => {});
});

// ── Swift ───────────────────────────────────────────────────────────────────
describe.skip("Swift extraction — extractSwift not yet migrated", () => {
  it("no error", () => {});
  it("finds class", () => {});
  it("finds struct", () => {});
  it("finds functions", () => {});
});

// ── Go ──────────────────────────────────────────────────────────────────────
describe.skip("Go extraction — extractGo not yet migrated", () => {
  it("no error", () => {});
  it("finds struct", () => {});
  it("finds functions", () => {});
  it("finds imports", () => {});
});

// ── Julia ───────────────────────────────────────────────────────────────────
describe.skip("Julia extraction — extractJulia not yet migrated", () => {
  it("no error", () => {});
  it("finds struct", () => {});
  it("finds functions", () => {});
});

// ── Fortran ──────────────────────────────────────────────────────────────────
describe.skip("Fortran extraction — extractFortran not yet migrated", () => {
  it("no error", () => {});
  it("finds program", () => {});
  it("finds functions", () => {});
});

// ── Groovy ──────────────────────────────────────────────────────────────────
describe.skip("Groovy extraction — extractGroovy not yet migrated", () => {
  it("no error", () => {});
  it("finds class", () => {});
  it("finds methods", () => {});
});

// ── DM/DreamMaker ────────────────────────────────────────────────────────────
describe.skip("DM extraction — extractDm not yet migrated", () => {
  it("no error", () => {});
});

// ── PowerShell ──────────────────────────────────────────────────────────────
describe.skip("PowerShell extraction — extractPowershell not yet migrated", () => {
  it("no error", () => {});
});

// ── Apex ─────────────────────────────────────────────────────────────────────
describe.skip("Apex extraction — extractApex not yet migrated", () => {
  it("no error", () => {});
});

// ── Verilog ──────────────────────────────────────────────────────────────────
describe.skip("Verilog extraction — extractVerilog not yet migrated", () => {
  it("no error", () => {});
});
