import { describe, it, expect } from "vitest";

import {
  MinHash,
  MinHashLSH,
  _optimalLshParams,
} from "../src/minhash.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minhashFor(text: string, numPerm: number = 128): MinHash {
  const m = new MinHash(numPerm);
  for (let i = 0; i < text.length - 2; i++) {
    const buf = Buffer.from(text.slice(i, i + 3), "utf-8");
    m.update(buf as unknown as Uint8Array);
  }
  return m;
}

// ---------------------------------------------------------------------------
// MinHash
// ---------------------------------------------------------------------------

describe("MinHash", () => {
  it("identical texts produce identical hashvalues", () => {
    const a = minhashFor("graphextractor");
    const b = minhashFor("graphextractor");
    expect(a.hashvalues).toEqual(b.hashvalues);
  });

  it("similar texts share most hashvalues", () => {
    const a = minhashFor("authentication manager");
    const b = minhashFor("authentication managers");
    let overlap = 0;
    for (let i = 0; i < a.hashvalues.length; i++) {
      if (a.hashvalues[i] === b.hashvalues[i]) overlap++;
    }
    expect(overlap / a.hashvalues.length).toBeGreaterThan(0.5);
  });

  it("unrelated texts share few hashvalues", () => {
    const a = minhashFor("authentication manager");
    const b = minhashFor("file system watcher");
    let overlap = 0;
    for (let i = 0; i < a.hashvalues.length; i++) {
      if (a.hashvalues[i] === b.hashvalues[i]) overlap++;
    }
    expect(overlap / a.hashvalues.length).toBeLessThan(0.3);
  });

  it("update mutates hashvalues", () => {
    const m = new MinHash(64);
    const before = [...m.hashvalues];
    m.update(Buffer.from("hello") as unknown as Uint8Array);
    expect(m.hashvalues).not.toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// MinHashLSH
// ---------------------------------------------------------------------------

describe("MinHashLSH", () => {
  it("near duplicates are candidates", () => {
    const lsh = new MinHashLSH(0.5, 128);
    const a = minhashFor("authentication manager");
    const b = minhashFor("authentication managers");
    lsh.insert("a", a);
    lsh.insert("b", b);
    expect(lsh.query(a)).toContain("b");
  });

  it("unrelated strings not candidates", () => {
    const lsh = new MinHashLSH(0.5, 128);
    const a = minhashFor("authentication manager");
    const b = minhashFor("file system watcher");
    lsh.insert("a", a);
    lsh.insert("b", b);
    expect(lsh.query(a)).not.toContain("b");
  });

  it("query always returns self", () => {
    const lsh = new MinHashLSH(0.5, 128);
    const m = minhashFor("graphextractor");
    lsh.insert("x", m);
    expect(lsh.query(m)).toContain("x");
  });

  it("duplicate insert raises", () => {
    const lsh = new MinHashLSH(0.5, 128);
    const m = minhashFor("foo");
    lsh.insert("key", m);
    expect(() => lsh.insert("key", m)).toThrow(/already exists/);
  });
});

// ---------------------------------------------------------------------------
// _optimalLshParams
// ---------------------------------------------------------------------------

describe("_optimalLshParams", () => {
  it("returns params within budget", () => {
    const [b, r] = _optimalLshParams(0.5, 128);
    expect(b).toBeGreaterThanOrEqual(1);
    expect(r).toBeGreaterThanOrEqual(1);
    expect(b * r).toBeLessThanOrEqual(128);
  });

  it("caches results", () => {
    const result1 = _optimalLshParams(0.7, 128);
    const result2 = _optimalLshParams(0.7, 128);
    expect(result1).toBe(result2);
  });
});
