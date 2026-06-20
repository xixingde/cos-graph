import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  FileSlice,
  Unit,
  unitPath,
  isSplittableText,
  bestCut,
  sliceBoundaries,
  expandOversizedFiles,
  readSliceText,
  bisectSlice,
} from "../src/fileSlice.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkdtemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "file-slice-test-"));
}

function writeFile(p: string, text: string): string {
  fs.writeFileSync(p, text, "utf-8");
  return p;
}

// ---------------------------------------------------------------------------
// sliceBoundaries: coverage + bounds invariants
// ---------------------------------------------------------------------------

describe("sliceBoundaries", () => {
  it("small text is one range", () => {
    const text = "short doc";
    expect(sliceBoundaries(text, 100)).toEqual([[0, text.length]]);
  });

  const maxCharsValues = [50, 100, 500, 1000];
  for (const maxChars of maxCharsValues) {
    it(`full coverage and bounds with maxChars=${maxChars}`, () => {
      const text = (("# Heading\n\n" + "lorem ipsum ".repeat(40) + "\n\n").repeat(20));
      const bounds = sliceBoundaries(text, maxChars);
      // contiguous, gap-free, non-overlapping, covering the whole text
      expect(bounds[0]![0]).toBe(0);
      expect(bounds[bounds.length - 1]![1]).toBe(text.length);
      for (let i = 0; i < bounds.length - 1; i++) {
        expect(bounds[i]![1]).toBe(bounds[i + 1]![0]);
      }
      // concatenation reproduces the text exactly (no dropped content)
      const joined = bounds.map(([s, e]) => text.slice(s, e)).join("");
      expect(joined).toBe(text);
      // every slice respects the budget
      for (const [s, e] of bounds) {
        expect(e - s).toBeLessThanOrEqual(maxChars);
      }
    });
  }

  it("single huge line still progresses", () => {
    // No newline at all → must hard-cut and still cover everything.
    const text = "x".repeat(5000);
    const bounds = sliceBoundaries(text, 1000);
    const joined = bounds.map(([s, e]) => text.slice(s, e)).join("");
    expect(joined).toBe(text);
    for (const [s, e] of bounds) {
      expect(e - s).toBeLessThanOrEqual(1000);
    }
  });

  it("prefers heading boundary", () => {
    const a = "# A\n" + "a".repeat(30) + "\n";
    const b = "# B\n" + "b".repeat(30) + "\n";
    const text = a + b;
    const bounds = sliceBoundaries(text, a.length + 5);
    // the second slice should start at the "# B" heading
    const secondStart = bounds[1]![0];
    expect(text.slice(secondStart, secondStart + 3)).toBe("# B");
  });
});

// ---------------------------------------------------------------------------
// expandOversizedFiles
// ---------------------------------------------------------------------------

describe("expandOversizedFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("small file stays whole", () => {
    const f = writeFile(path.join(tmpDir, "small.md"), "# Tiny\n\nhi\n");
    const units = expandOversizedFiles([f], 1000);
    expect(units).toEqual([f]);
  });

  it("oversized markdown is sliced with full coverage", () => {
    const text = (("# Section\n\n" + "word ".repeat(200) + "\n\n").repeat(30));
    const f = writeFile(path.join(tmpDir, "big.md"), text);
    const units = expandOversizedFiles([f], 2000);
    const slices = units.filter((u): u is FileSlice => typeof u !== "string");
    expect(slices.length).toBeGreaterThanOrEqual(2);
    // all units are FileSlice instances
    for (const u of units) {
      expect(typeof u).not.toBe("string");
    }
    // slices reconstruct the whole file
    const joined = slices.map((s) => readSliceText(s)).join("");
    expect(joined).toBe(text);
    for (const s of slices) {
      expect(s.end - s.start).toBeLessThanOrEqual(2000);
    }
    // every slice points back at the parent file (anti-fragmentation)
    for (const s of slices) {
      expect(s.path).toBe(f);
    }
    expect(slices[0]!.total).toBe(slices.length);
  });

  it("does not slice code even when oversized", () => {
    const f = writeFile(path.join(tmpDir, "mod.py"), "x = 1\n".repeat(6000));
    expect(isSplittableText(f)).toBe(false);
    const units = expandOversizedFiles([f], 2000);
    expect(units).toEqual([f]);
  });

  it("unreadable file passes through", () => {
    const missing = path.join(tmpDir, "nope.md");
    const units = expandOversizedFiles([missing], 10);
    expect(units).toEqual([missing]);
  });
});

// ---------------------------------------------------------------------------
// unit helpers
// ---------------------------------------------------------------------------

describe("unitPath", () => {
  it("resolves slice and path", () => {
    const tmpDir = mkdtemp();
    try {
      const f = path.join(tmpDir, "a.md");
      const fs: FileSlice = { path: f, start: 0, end: 5, index: 0, total: 1 };
      expect(unitPath(fs)).toBe(f);
      expect(unitPath(f)).toBe(f);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// bisectSlice (adaptive-retry path)
// ---------------------------------------------------------------------------

describe("bisectSlice", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("splits at newline", () => {
    const f = writeFile(path.join(tmpDir, "a.md"), "alpha\n".repeat(100));
    const fslice: FileSlice = { path: f, start: 0, end: 600, index: 0, total: 1 };
    const halves = bisectSlice(fslice);
    expect(halves).not.toBeNull();
    const [left, right] = halves!;
    expect(left.start).toBe(fslice.start);
    expect(right.end).toBe(fslice.end);
    expect(left.end).toBe(right.start); // contiguous, no gap
    expect(fslice.start).toBeLessThan(left.end);
    expect(left.end).toBeLessThan(fslice.end);
  });

  it("returns null for tiny", () => {
    const f = writeFile(path.join(tmpDir, "a.md"), "ab");
    expect(bisectSlice({ path: f, start: 0, end: 1, index: 0, total: 1 })).toBeNull();
  });
});
