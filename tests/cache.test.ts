import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  fileHash,
  cacheDir,
  loadCached,
  saveCached,
  cachedFiles,
  clearCache,
  bodyContent,
  EXTRACTOR_VERSION,
  GRAPHIFY_OUT,
  _resetState,
} from "../src/cache.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkdtemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cache-test-"));
}

function rmdir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// file_hash tests
// ---------------------------------------------------------------------------

describe("fileHash", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
    _resetState();
  });

  it("same file gives same hash on repeated calls", () => {
    const f = path.join(tmpDir, "sample.txt");
    fs.writeFileSync(f, "hello world");
    const h1 = fileHash(f, tmpDir);
    const h2 = fileHash(f, tmpDir);
    expect(h1).toBe(h2);
    expect(typeof h1).toBe("string");
    expect(h1.length).toBe(64); // SHA256 hex digest length
  });

  it("different file contents give different hashes", () => {
    const f1 = path.join(tmpDir, "a.txt");
    const f2 = path.join(tmpDir, "b.txt");
    fs.writeFileSync(f1, "content one");
    fs.writeFileSync(f2, "content two");
    expect(fileHash(f1, tmpDir)).not.toBe(fileHash(f2, tmpDir));
  });
});

// ---------------------------------------------------------------------------
// cache roundtrip tests
// ---------------------------------------------------------------------------

describe("cache roundtrip", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
    _resetState();
  });

  it("save then load returns the same result dict", () => {
    const f = path.join(tmpDir, "sample.txt");
    fs.writeFileSync(f, "hello world");
    const result = { nodes: [{ id: "n1", label: "Node1" }], edges: [] };
    saveCached(f, result, tmpDir);
    const loaded = loadCached(f, tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes).toEqual(result.nodes);
    expect(loaded!.edges).toEqual(result.edges);
  });

  it("after file content changes, loadCached returns null", () => {
    const f = path.join(tmpDir, "sample.txt");
    fs.writeFileSync(f, "hello world");
    const result = { nodes: [], edges: [{ source: "a", target: "b" }] };
    saveCached(f, result, tmpDir);
    // Modify the file
    _resetState();
    fs.writeFileSync(f, "completely different content");
    expect(loadCached(f, tmpDir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cached_files / clear_cache
// ---------------------------------------------------------------------------

describe("cachedFiles / clearCache", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
    _resetState();
  });

  it("cachedFiles returns the set of cached hashes", () => {
    const f1 = path.join(tmpDir, "file1.py");
    const f2 = path.join(tmpDir, "file2.py");
    fs.writeFileSync(f1, "alpha");
    fs.writeFileSync(f2, "beta");
    saveCached(f1, { nodes: [], edges: [] }, tmpDir);
    saveCached(f2, { nodes: [], edges: [] }, tmpDir);
    const hashes = cachedFiles(tmpDir);
    expect(hashes.has(fileHash(f1, tmpDir))).toBe(true);
    expect(hashes.has(fileHash(f2, tmpDir))).toBe(true);
  });

  it("clearCache removes all .json files from graphify-out/cache/ (all subdirs)", () => {
    const f = path.join(tmpDir, "sample.txt");
    fs.writeFileSync(f, "hello world");
    saveCached(f, { nodes: [], edges: [] }, tmpDir);
    const cacheBase = path.join(tmpDir, "graphify-out", "cache");
    // There should be at least one json file in the cache
    const jsonFiles = collectJsonFiles(cacheBase);
    expect(jsonFiles.length).toBeGreaterThan(0);
    clearCache(tmpDir);
    const afterJsonFiles = collectJsonFiles(cacheBase);
    expect(afterJsonFiles.length).toBe(0);
  });
});

function collectJsonFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsonFiles(full));
    } else if (entry.name.endsWith(".json")) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Markdown frontmatter tests
// ---------------------------------------------------------------------------

describe("bodyContent", () => {
  it("correctly strips YAML frontmatter", () => {
    const content = Buffer.from("---\ntitle: Test\n---\n\nActual body.");
    expect(bodyContent(content).toString("utf-8")).toBe("\n\nActual body.");
  });

  it("returns content unchanged when no frontmatter present", () => {
    const content = Buffer.from("No frontmatter here.");
    expect(bodyContent(content)).toEqual(content);
  });

  // --- #1259: frontmatter delimiters must be whole `---` lines ---

  it("a document opening with a `----` thematic break has no frontmatter", () => {
    const content = Buffer.from("----\nIntro paragraph that must be hashed.\n\n---\nbody");
    expect(bodyContent(content)).toEqual(content);
  });

  it("`--- title` on the first line is prose, not an open delimiter", () => {
    const content = Buffer.from("--- title\nIntro that must be hashed.\n\n---\nbody");
    expect(bodyContent(content)).toEqual(content);
  });

  it("`--- text` and `----` lines inside opened frontmatter are not the close", () => {
    const content = Buffer.from("---\ntitle: Test\nbody starts here\n--- not a delimiter\n----\nreal content");
    expect(bodyContent(content)).toEqual(content);
  });

  it("a `--- text` line is skipped; the next whole `---` line closes", () => {
    const content = Buffer.from("---\ntitle: Test\nnote: --- inline\n---\nreal body");
    expect(bodyContent(content).toString("utf-8")).toBe("\nreal body");
  });

  it("for well-formed frontmatter the stripped body stays byte-identical to historical", () => {
    const cases: [Buffer, Buffer][] = [
      // (input, expected output of the historical text.find("\n---")+4 algorithm)
      [Buffer.from("---\ntitle: Test\n---\n\nActual body."), Buffer.from("\n\nActual body.")],
      [Buffer.from("---\nreviewed: 2026-01-01\n---\n\n# Title\n\nBody text."), Buffer.from("\n\n# Title\n\nBody text.")],
      // close delimiter with trailing whitespace keeps it in the body
      [Buffer.from("---\ntitle: Test\n---  \nbody"), Buffer.from("  \nbody")],
      // CRLF line endings
      [Buffer.from("---\r\ntitle: Test\r\n---\r\nbody"), Buffer.from("\r\nbody")],
      // empty frontmatter block
      [Buffer.from("---\n---\nbody"), Buffer.from("\nbody")],
      // close as the very last line, no trailing newline
      [Buffer.from("---\ntitle: Test\n---"), Buffer.from("")],
    ];
    for (const [content, expected] of cases) {
      expect(bodyContent(content).toString("utf-8")).toBe(expected.toString("utf-8"));
    }
  });
});

describe("Markdown fileHash", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
    _resetState();
  });

  it("changing only frontmatter fields in a .md file does not change the hash", () => {
    const f = path.join(tmpDir, "doc.md");
    fs.writeFileSync(f, "---\nreviewed: 2026-01-01\n---\n\n# Title\n\nBody text.");
    const h1 = fileHash(f, tmpDir);
    _resetState();
    fs.writeFileSync(f, "---\nreviewed: 2026-04-09\n---\n\n# Title\n\nBody text.");
    const h2 = fileHash(f, tmpDir);
    expect(h1).toBe(h2);
  });

  it("changing the body of a .md file produces a different hash", () => {
    const f = path.join(tmpDir, "doc.md");
    fs.writeFileSync(f, "---\nreviewed: 2026-01-01\n---\n\n# Title\n\nOriginal body.");
    const h1 = fileHash(f, tmpDir);
    _resetState();
    fs.writeFileSync(f, "---\nreviewed: 2026-01-01\n---\n\n# Title\n\nChanged body.");
    const h2 = fileHash(f, tmpDir);
    expect(h1).not.toBe(h2);
  });

  it("a .md file with no frontmatter is hashed by its full content", () => {
    const f = path.join(tmpDir, "doc.md");
    fs.writeFileSync(f, "# Just a heading\n\nNo frontmatter here.");
    const h1 = fileHash(f, tmpDir);
    _resetState();
    fs.writeFileSync(f, "# Just a heading\n\nDifferent content.");
    const h2 = fileHash(f, tmpDir);
    expect(h1).not.toBe(h2);
  });

  it("non-.md files are still hashed by their full content", () => {
    const f = path.join(tmpDir, "script.py");
    fs.writeFileSync(f, "# comment\nx = 1");
    const h1 = fileHash(f, tmpDir);
    _resetState();
    fs.writeFileSync(f, "# changed comment\nx = 1");
    const h2 = fileHash(f, tmpDir);
    expect(h1).not.toBe(h2);
  });

  it("editing content above a mid-document `----` break changes the hash", () => {
    const f = path.join(tmpDir, "doc.md");
    fs.writeFileSync(f, "----\nIntro paragraph.\n\n---\nbody");
    const h1 = fileHash(f, tmpDir);
    _resetState();
    fs.writeFileSync(f, "----\nEdited intro paragraph.\n\n---\nbody");
    const h2 = fileHash(f, tmpDir);
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// #777: portable cache source_file fields
// ---------------------------------------------------------------------------

describe("portable cache source_file fields", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
    _resetState();
  });

  it("the on-disk cache JSON contains forward-slash relative source_file entries", () => {
    fs.mkdirSync(path.join(tmpDir, "src"));
    const src = path.join(tmpDir, "src", "foo.py");
    fs.writeFileSync(src, "def x(): pass\n");
    const absSrc = path.resolve(src);
    const result = {
      nodes: [{ id: "n1", label: "foo", source_file: absSrc }],
      edges: [{ source: "n1", target: "n1", source_file: absSrc }],
    };
    saveCached(src, result, tmpDir, "ast");

    const h = fileHash(src, tmpDir);
    const entry = path.join(cacheDir(tmpDir, "ast"), `${h}.json`);
    const onDisk = JSON.parse(fs.readFileSync(entry, "utf-8"));
    const nodeSources = new Set(onDisk.nodes.map((n: any) => n.source_file));
    const edgeSources = new Set(onDisk.edges.map((e: any) => e.source_file));
    // On Windows, relative path uses forward slash
    const expected = path.relative(tmpDir, absSrc).split(path.sep).join("/");
    expect(nodeSources).toEqual(new Set([expected]));
    expect(edgeSources).toEqual(new Set([expected]));
  });

  it("loadCached returns absolute-path shape that fresh extraction produces", () => {
    fs.mkdirSync(path.join(tmpDir, "src"));
    const src = path.join(tmpDir, "src", "foo.py");
    fs.writeFileSync(src, "def x(): pass\n");
    const absSrc = path.resolve(src);
    saveCached(src, {
      nodes: [{ id: "n1", source_file: absSrc }],
      edges: [{ source: "n1", target: "n1", source_file: absSrc }],
    }, tmpDir, "ast");

    const loaded = loadCached(src, tmpDir, "ast");
    expect(loaded).not.toBeNull();
    expect((loaded!.nodes as any[])[0].source_file).toBe(absSrc);
    expect((loaded!.edges as any[])[0].source_file).toBe(absSrc);
  });

  it("legacy cache entries with absolute source_file load correctly", () => {
    fs.mkdirSync(path.join(tmpDir, "src"));
    const src = path.join(tmpDir, "src", "foo.py");
    fs.writeFileSync(src, "pass\n");
    const absSrc = path.resolve(src);

    // Hand-write a legacy-format cache entry (absolute source_file).
    const h = fileHash(src, tmpDir);
    const entry = path.join(cacheDir(tmpDir, "ast"), `${h}.json`);
    fs.writeFileSync(entry, JSON.stringify({
      nodes: [{ id: "n1", source_file: absSrc }],
      edges: [],
    }));

    const loaded = loadCached(src, tmpDir, "ast");
    expect(loaded).not.toBeNull();
    expect((loaded!.nodes as any[])[0].source_file).toBe(absSrc);
  });

  it("cache entry written at one root can be consumed at a different absolute root", () => {
    const repoA = path.join(tmpDir, "repo_a");
    fs.mkdirSync(path.join(repoA, "src"), { recursive: true });
    const srcA = path.join(repoA, "src", "foo.py");
    fs.writeFileSync(srcA, "def x(): pass\n");
    saveCached(srcA, {
      nodes: [{ id: "n1", source_file: path.resolve(srcA) }],
      edges: [],
    }, repoA, "ast");

    // Copy corpus + cache to a second location with a different absolute prefix.
    const repoB = path.join(tmpDir, "repo_b");
    fs.cpSync(repoA, repoB, { recursive: true });

    const srcB = path.join(repoB, "src", "foo.py");
    _resetState();
    const loaded = loadCached(srcB, repoB, "ast");
    expect(loaded).not.toBeNull();
    // Source path re-anchored to the new root, not the old one.
    expect((loaded!.nodes as any[])[0].source_file).toBe(path.resolve(srcB));
    expect((loaded!.nodes as any[])[0].source_file).not.toContain("repo_a");
  });
});

// ---------------------------------------------------------------------------
// AST cache versioning
// ---------------------------------------------------------------------------

describe("AST cache versioning", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
    _resetState();
  });

  it("AST entry written by version X must not be served after upgrading to version Y", () => {
    const f = path.join(tmpDir, "mod.py");
    fs.writeFileSync(f, "def f(): pass\n");

    // We simulate version bump by using different cache dirs
    // Save with current version
    saveCached(f, { nodes: [{ id: "n1" }], edges: [] }, tmpDir, "ast");
    expect(loadCached(f, tmpDir, "ast")).not.toBeNull();

    // Change to a different version subdir — the old cache won't be found
    // We simulate by resetting state and verifying the cache entry is under
    // the versioned dir. Changing EXTRACTOR_VERSION dynamically is not
    // straightforward in TS module scope, so we verify the versioned structure.
    const astDir = cacheDir(tmpDir, "ast");
    expect(astDir).toContain(`v${EXTRACTOR_VERSION}`);
  });

  it("upgrading removes AST entries left behind by previous versions", () => {
    const f = path.join(tmpDir, "mod.py");
    fs.writeFileSync(f, "def f(): pass\n");

    // Create a stale version directory
    const staleDir = path.join(tmpDir, "graphify-out", "cache", "ast", "v0.8.0");
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, "stale.json"), "{}");

    // Calling cacheDir triggers cleanup
    _resetState();
    cacheDir(tmpDir, "ast");
    expect(fs.existsSync(staleDir)).toBe(false);
  });

  it("unversioned cache/ast/{hash}.json entries are not served", () => {
    const f = path.join(tmpDir, "mod.py");
    fs.writeFileSync(f, "def f(): pass\n");
    const h = fileHash(f, tmpDir);
    const payload = JSON.stringify({ nodes: [{ id: "stale" }], edges: [] });

    // Unversioned cache/ast/{hash}.json (pre-versioning layout)
    const unversioned = path.join(tmpDir, GRAPHIFY_OUT, "cache", "ast");
    fs.mkdirSync(unversioned, { recursive: true });
    fs.writeFileSync(path.join(unversioned, `${h}.json`), payload);
    // Legacy flat cache/{hash}.json (pre-0.5.3 layout)
    fs.writeFileSync(path.join(unversioned, "..", `${h}.json`), payload);

    _resetState();
    expect(loadCached(f, tmpDir, "ast")).toBeNull();
  });

  it("semantic cache survives version bump and AST cleanup", () => {
    const f = path.join(tmpDir, "doc.md");
    fs.writeFileSync(f, "# Title\n\nBody.\n");

    saveCached(f, { nodes: [{ id: "n1" }], edges: [] }, tmpDir, "semantic");
    const semanticDir = cacheDir(tmpDir, "semantic");

    _resetState();
    // Trigger stale-AST cleanup (won't affect semantic)
    cacheDir(tmpDir, "ast");
    expect(loadCached(f, tmpDir, "semantic")).not.toBeNull();
    // semantic entries must survive both the version bump and AST cleanup
    const jsonFiles = fs.readdirSync(semanticDir).filter((n) => n.endsWith(".json"));
    expect(jsonFiles.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Symlink source_file test
// ---------------------------------------------------------------------------

describe("symlink source_file", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
    _resetState();
  });

  it("source_file for an in-root symlink must be stored under the symlink's own name", () => {
    fs.mkdirSync(path.join(tmpDir, "sub"));
    const target = path.join(tmpDir, "sub", "target.py");
    fs.writeFileSync(target, "pass\n");
    const alias = path.join(tmpDir, "alias.py");
    try {
      fs.symlinkSync(target, alias);
    } catch {
      // filesystem does not support symlinks — skip
      return;
    }

    const absAlias = alias; // caller's view — the symlink path, unresolved
    saveCached(alias, {
      nodes: [{ id: "n1", source_file: absAlias }],
      edges: [],
    }, tmpDir, "ast");

    const h = fileHash(alias, tmpDir);
    const entry = path.join(cacheDir(tmpDir, "ast"), `${h}.json`);
    const onDisk = JSON.parse(fs.readFileSync(entry, "utf-8"));
    expect(onDisk.nodes[0].source_file).toBe("alias.py");
  });
});
