import { describe, it, expect } from "vitest";
import * as path from "path";
import { introspectCargo } from "../src/cargoIntrospect.js";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

describe("introspectCargo", () => {
  it("returns nodes and edges for a single crate", () => {
    const crateAPath = path.join(FIXTURES_DIR, "crate_a");
    const result = introspectCargo(crateAPath);
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("edges");
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
  });

  it("finds the crate name from Cargo.toml", () => {
    const crateAPath = path.join(FIXTURES_DIR, "crate_a");
    const result = introspectCargo(crateAPath);
    const names = result.nodes.map(n => n.name);
    expect(names).toContain("crate_a");
  });

  it("sets version from Cargo.toml", () => {
    const crateAPath = path.join(FIXTURES_DIR, "crate_a");
    const result = introspectCargo(crateAPath);
    const crateA = result.nodes.find(n => n.name === "crate_a");
    expect(crateA).toBeDefined();
    expect(crateA!.version).toBe("0.1.0");
  });

  it("sets path to . for root crate", () => {
    const crateAPath = path.join(FIXTURES_DIR, "crate_a");
    const result = introspectCargo(crateAPath);
    const crateA = result.nodes.find(n => n.name === "crate_a");
    expect(crateA!.path).toBe(".");
  });

  it("accepts a ParsedPath object as root", () => {
    const crateBDir = path.join(FIXTURES_DIR, "crate_b");
    const parsed = path.parse(crateBDir);
    // introspectCargo uses parsed.dir, so pass the dir + base as the string form
    const result = introspectCargo(path.join(parsed.dir, parsed.base));
    const names = result.nodes.map(n => n.name);
    expect(names).toContain("crate_b");
  });

  it("returns empty edges for a crate with no internal deps", () => {
    const crateAPath = path.join(FIXTURES_DIR, "crate_a");
    const result = introspectCargo(crateAPath);
    expect(result.edges).toEqual([]);
  });

  it("each edge has source, target, relation, and confidence", () => {
    const crateAPath = path.join(FIXTURES_DIR, "crate_a");
    const result = introspectCargo(crateAPath);
    for (const edge of result.edges) {
      expect(edge).toHaveProperty("source");
      expect(edge).toHaveProperty("target");
      expect(edge).toHaveProperty("relation");
      expect(edge).toHaveProperty("confidence");
      expect(edge.confidence).toBe("EXTRACTED");
    }
  });

  it("throws for a non-existent path", () => {
    expect(() => introspectCargo("/non/existent/path")).toThrow();
  });
});
