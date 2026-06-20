import { describe, it, expect } from "vitest";
import * as path from "path";

import {
  makeId,
  fileStem,
  fileNodeId,
  sourceLocation,
  semanticReferenceEdge,
  safeExtract,
  LANGUAGE_BUILTIN_GLOBALS,
  SEMANTIC_RELATIONS,
  REFERENCE_CONTEXTS,
} from "../src/extract/framework.js";
import {
  DISPATCH,
  getExtractor,
  getRegisteredExtensions,
  registerExtractor,
} from "../src/extract/registry.js";
import type { ExtractorFn } from "../src/extract/registry.js";
import { extract, collectFiles } from "../src/extract/index.js";
import {
  createAstContext,
  addNode,
  addEdge,
} from "../src/extract/ast-extract.js";
import { extractWithAdaptiveRetry } from "../src/extract/adaptive-retry.js";
import type { ExtractionResult } from "../src/types/extraction.js";

// ---------------------------------------------------------------------------
// makeId
// ---------------------------------------------------------------------------

describe("makeId", () => {
  it("combines parts with underscore", () => {
    expect(makeId("foo", "bar")).toBe("foo_bar");
  });

  it("filters empty parts", () => {
    expect(makeId("foo", "", "bar")).toBe("foo_bar");
  });

  it("strips leading/trailing dots and underscores from parts", () => {
    expect(makeId(".foo_", "_bar.")).toBe("foo_bar");
  });

  it("normalizes non-word sequences to underscore", () => {
    expect(makeId("foo@bar")).toBe("foo_bar");
  });

  it("collapses multiple underscores", () => {
    expect(makeId("foo__bar")).toBe("foo_bar");
  });

  it("lowercases the result", () => {
    expect(makeId("FooBar")).toBe("foobar");
  });

  it("handles unicode identifiers — JS \\w does not include CJK, non-ASCII stripped", () => {
    // In Python, re.UNICODE makes \\w match CJK; in JS, \\w is ASCII-only
    // even with the /u flag. CJK characters are replaced with underscores,
    // then leading/trailing underscores are stripped, leaving empty string.
    const result = makeId("类", "方法");
    expect(result).toBe("");
  });

  it("NFKC normalizes composed characters", () => {
    // é (U+00E9) vs e + combining acute (U+0065 U+0301) should produce same ID
    const a = makeId("é");
    const b = makeId("e\u0301");
    expect(a).toBe(b);
  });

  it("returns empty string for all-empty input", () => {
    expect(makeId("", "")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// fileStem
// ---------------------------------------------------------------------------

describe("fileStem", () => {
  it("returns stem for top-level file", () => {
    expect(fileStem("foo.py")).toBe("foo");
  });

  it("qualifies with parent directory", () => {
    expect(fileStem("src/foo.py")).toBe("src.foo");
  });

  it("handles nested paths", () => {
    expect(fileStem("a/b/c/foo.py")).toBe("c.foo");
  });

  it("handles dot directory", () => {
    expect(fileStem("./foo.py")).toBe("foo");
  });
});

// ---------------------------------------------------------------------------
// fileNodeId
// ---------------------------------------------------------------------------

describe("fileNodeId", () => {
  it("maps simple relative path", () => {
    expect(fileNodeId("src/foo.py")).toBe("src_foo");
  });

  it("maps top-level file", () => {
    expect(fileNodeId("setup.py")).toBe("setup");
  });
});

// ---------------------------------------------------------------------------
// sourceLocation
// ---------------------------------------------------------------------------

describe("sourceLocation", () => {
  it("returns string for number", () => {
    expect(sourceLocation(42)).toBe("42");
  });

  it("returns string for string input", () => {
    expect(sourceLocation("10")).toBe("10");
  });

  it("returns null for null", () => {
    expect(sourceLocation(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(sourceLocation(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// semanticReferenceEdge
// ---------------------------------------------------------------------------

describe("semanticReferenceEdge", () => {
  it("creates a valid reference edge", () => {
    const edge = semanticReferenceEdge("a", "b", "field", "file.ts", 10);
    expect(edge).toMatchObject({
      source: "a",
      target: "b",
      relation: "references",
      context: "field",
      confidence: "EXTRACTED",
      source_file: "file.ts",
      source_location: "10",
      weight: 1.0,
    });
  });

  it("throws on unknown context", () => {
    expect(() => semanticReferenceEdge("a", "b", "unknown", "f.ts", 1)).toThrow(
      /unknown reference context/,
    );
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("LANGUAGE_BUILTIN_GLOBALS contains common builtins", () => {
    expect(LANGUAGE_BUILTIN_GLOBALS.has("String")).toBe(true);
    expect(LANGUAGE_BUILTIN_GLOBALS.has("str")).toBe(true);
    expect(LANGUAGE_BUILTIN_GLOBALS.has("console")).toBe(true);
  });

  it("SEMANTIC_RELATIONS contains expected relations", () => {
    expect(SEMANTIC_RELATIONS.has("inherits")).toBe(true);
    expect(SEMANTIC_RELATIONS.has("calls")).toBe(true);
    expect(SEMANTIC_RELATIONS.has("imports")).toBe(true);
  });

  it("REFERENCE_CONTEXTS contains expected contexts", () => {
    expect(REFERENCE_CONTEXTS.has("field")).toBe(true);
    expect(REFERENCE_CONTEXTS.has("return_type")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("registry", () => {
  it("DISPATCH has all Python _DISPATCH extensions", () => {
    const exts = getRegisteredExtensions();
    for (const ext of [".py", ".js", ".ts", ".go", ".rs", ".java", ".rb", ".cs"]) {
      expect(exts.has(ext)).toBe(true);
    }
  });

  it("getExtractor returns extractor for known extension", () => {
    const ext = getExtractor("test.py");
    expect(ext).not.toBeNull();
  });

  it("getExtractor returns null for unknown extension", () => {
    const ext = getExtractor("test.xyz");
    expect(ext).toBeNull();
  });

  it("placeholder extractor returns empty result", () => {
    const ext = getExtractor("test.py");
    const result = ext!("test.py");
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("registerExtractor can override existing", () => {
    const custom: ExtractorFn = () => ({
      nodes: [{ id: "custom", label: "custom", type: "function", fileType: "py", sourceFile: "test.py" }],
      edges: [],
      languages: {},
    });
    registerExtractor(".custom_ext", custom);
    const ext = getExtractor("test.custom_ext");
    expect(ext).not.toBeNull();
    expect(ext!("test.custom_ext").nodes).toHaveLength(1);
    // Clean up
    DISPATCH.delete(".custom_ext");
  });
});

// ---------------------------------------------------------------------------
// safeExtract
// ---------------------------------------------------------------------------

describe("safeExtract", () => {
  it("returns result on success", () => {
    const extractor: ExtractorFn = () => ({ nodes: [], edges: [], languages: {} });
    const result = safeExtract(extractor, "test.py");
    expect(result.nodes).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("returns error result on exception", () => {
    const extractor: ExtractorFn = () => {
      throw new Error("oops");
    };
    const result = safeExtract(extractor, "test.py");
    expect(result.nodes).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AST extract framework
// ---------------------------------------------------------------------------

describe("AstExtractionContext", () => {
  it("createAstContext creates context", () => {
    const ctx = createAstContext("test.py", "source code", null);
    expect(ctx.filePath).toBe("test.py");
    expect(ctx.source).toBe("source code");
    expect(ctx.nodes).toEqual([]);
    expect(ctx.edges).toEqual([]);
  });

  it("addNode adds node and returns id", () => {
    const ctx = createAstContext("test.py", "", null);
    const id = addNode(ctx, "my_func", "my_func", 5);
    expect(id).toBe("my_func");
    expect(ctx.nodes).toHaveLength(1);
    expect(ctx.nodes[0]["id"]).toBe("my_func");
    expect(ctx.nodes[0]["source_file"]).toBe("test.py");
  });

  it("addNode merges extra attrs", () => {
    const ctx = createAstContext("test.py", "", null);
    addNode(ctx, "x", "x", 1, { type: "function", fileType: "py" });
    expect(ctx.nodes[0]["type"]).toBe("function");
  });

  it("addEdge adds edge", () => {
    const ctx = createAstContext("test.py", "", null);
    addEdge(ctx, "a", "b", "calls", 10);
    expect(ctx.edges).toHaveLength(1);
    expect(ctx.edges[0]["source"]).toBe("a");
    expect(ctx.edges[0]["relation"]).toBe("calls");
  });
});

// ---------------------------------------------------------------------------
// adaptive-retry
// ---------------------------------------------------------------------------

describe("extractWithAdaptiveRetry", () => {
  it("delegates to extractor", () => {
    const extractor: ExtractorFn = (_p) => ({ nodes: [], edges: [], languages: {} });
    const result = extractWithAdaptiveRetry(extractor, "test.py");
    expect(result.nodes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extract()
// ---------------------------------------------------------------------------

describe("extract", () => {
  it("returns empty result for empty file list", () => {
    const result = extract([]);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// collectFiles
// ---------------------------------------------------------------------------
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("collectFiles", () => {
  it("returns single file when target is a file", () => {
    const thisFile = path.resolve(__dirname, "extract.test.ts");
    const result = collectFiles(thisFile);
    expect(result).toHaveLength(1);
  });
});
