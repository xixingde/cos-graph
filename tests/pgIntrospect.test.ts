import { describe, it, expect } from "vitest";
import { quoteIdent } from "../src/pgIntrospect.js";

describe("quoteIdent", () => {
  it("wraps a simple name in double quotes", () => {
    expect(quoteIdent("users")).toBe('"users"');
  });

  it("escapes embedded double quotes by doubling them", () => {
    expect(quoteIdent('my"table')).toBe('"my""table"');
  });

  it("handles multiple embedded double quotes", () => {
    expect(quoteIdent('a"b"c')).toBe('"a""b""c"');
  });

  it("handles empty string", () => {
    expect(quoteIdent('')).toBe('""');
  });

  it("handles reserved words", () => {
    expect(quoteIdent("select")).toBe('"select"');
  });

  it("handles names with hyphens", () => {
    expect(quoteIdent("my-table")).toBe('"my-table"');
  });
});
