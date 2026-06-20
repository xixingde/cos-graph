/** Tests for src/callflowHtml.ts -- pure function unit tests.
 *
 *  Covers: escapeHtml, firstPresent, firstList, toFloat, endpointId,
 *  normalizeNode, normalizeEdge, safeMermaidText, stableAsciiId,
 *  safeFilePath, safeFilename, truncateText, humanizeLabel, nodeKind,
 *  relationLabel, shouldIncludeEdge, edgeScore, nodeDegreeScores,
 *  nodeImportance, buildCommunityIndex, htmlAnchorId, normalizeCommunities,
 *  groupNodesByFile, generateNav, nodeDisplayName, sectionKeywords,
 *  mermaidInit, mermaidClassDefs, pickText, isZh, detectLang,
 *  nodeLabel, normalizeSections.
 */

import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  firstPresent,
  firstList,
  toFloat,
  endpointId,
  normalizeNode,
  normalizeEdge,
  safeMermaidText,
  stableAsciiId,
  safeFilePath,
  safeFilename,
  truncateText,
  humanizeLabel,
  nodeKind,
  relationLabel,
  shouldIncludeEdge,
  edgeScore,
  nodeDegreeScores,
  nodeImportance,
  buildCommunityIndex,
  htmlAnchorId,
  normalizeCommunities,
  groupNodesByFile,
  generateNav,
  nodeDisplayName,
  sectionKeywords,
  mermaidInit,
  mermaidClassDefs,
  pickText,
  isZh,
  detectLang,
  nodeLabel,
  normalizeSections,
  type NormalizedNode,
  type NormalizedEdge,
  type Section,
} from "../src/callflowHtml.js";

// ── Helpers ─────────────────────────────────────────────

function makeNode(overrides: Partial<NormalizedNode> = {}): NormalizedNode {
  return {
    id: "n1",
    label: "doStuff",
    community: "1",
    source_file: "src/app.ts",
    node_type: "function",
    file_type: "code",
    ...overrides,
  } as NormalizedNode;
}

function makeEdge(overrides: Partial<NormalizedEdge> = {}): NormalizedEdge {
  return {
    id: "e1",
    source: "n1",
    target: "n2",
    relation: "calls",
    confidence: "EXTRACTED",
    confidence_score: 1.0,
    ...overrides,
  } as NormalizedEdge;
}

// ────────────────────────────────────────────────────────
// 1. escapeHtml
// ────────────────────────────────────────────────────────
describe("escapeHtml", () => {
  it("escapes ampersand", () => {
    const amp = String.fromCharCode(38); // &
    const expected = "a " + amp + "amp; b";
    expect(escapeHtml("a & b")).toBe(expected);
  });

  it("escapes angle brackets and quotes", () => {
    const amp = String.fromCharCode(38); // &
    expect(escapeHtml('<em class="x">')).toBe(
      amp + "lt;em class=" + amp + "quot;x" + amp + "quot;" + amp + "gt;"
    );
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

// ────────────────────────────────────────────────────────
// 2. firstPresent
// ────────────────────────────────────────────────────────
describe("firstPresent", () => {
  it("returns first non-null key", () => {
    expect(firstPresent({ a: null, b: "val", c: "other" }, ["a", "b", "c"])).toBe("val");
  });

  it("skips empty string", () => {
    expect(firstPresent({ a: "", b: "found" }, ["a", "b"], "default")).toBe("found");
  });

  it("returns default when all keys missing", () => {
    expect(firstPresent({ x: 1 }, ["a", "b"], "fallback")).toBe("fallback");
  });
});

// ────────────────────────────────────────────────────────
// 3. firstList
// ────────────────────────────────────────────────────────
describe("firstList", () => {
  it("returns first array argument", () => {
    expect(firstList(null, [1, 2], [3])).toEqual([1, 2]);
  });

  it("returns empty array when none is array", () => {
    expect(firstList("a", 42, null)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────
// 4. toFloat
// ────────────────────────────────────────────────────────
describe("toFloat", () => {
  it("parses number from string", () => {
    expect(toFloat("3.14")).toBeCloseTo(3.14, 2);
  });

  it("returns NaN for non-numeric string", () => {
    expect(toFloat("abc", 5.0)).toBeNaN();
  });

  it("returns NaN for undefined", () => {
    expect(toFloat(undefined, 0.0)).toBeNaN();
  });
});

// ────────────────────────────────────────────────────────
// 5. endpointId
// ────────────────────────────────────────────────────────
describe("endpointId", () => {
  it("extracts id from object", () => {
    expect(endpointId({ id: "x", name: "y" })).toBe("x");
  });

  it("stringifies a plain value", () => {
    expect(endpointId(42)).toBe("42");
  });

  it("returns empty string for null", () => {
    expect(endpointId(null)).toBe("");
  });
});

// ────────────────────────────────────────────────────────
// 6. normalizeNode
// ────────────────────────────────────────────────────────
describe("normalizeNode", () => {
  it("fills required fields from raw node", () => {
    const raw = { id: "myId", label: "My Label", source_file: "src/foo.ts" };
    const node = normalizeNode(raw, 0);
    expect(node.id).toBe("myId");
    expect(node.label).toBe("My Label");
    expect(node.source_file).toBe("src/foo.ts");
    expect(node.community).toBe("unknown");
  });

  it("falls back to alternate key names", () => {
    const raw = { node_id: "altId", display_name: "Alt Label", file: "bar.go" };
    const node = normalizeNode(raw, 2);
    expect(node.id).toBe("altId");
    expect(node.label).toBe("Alt Label");
    expect(node.source_file).toBe("bar.go");
  });

  it("defaults id from index when no keys match", () => {
    const raw = { x: 1 };
    const node = normalizeNode(raw, 5);
    expect(node.id).toBe("node_6");
  });

  it("infers file_type from extension for .md files", () => {
    const raw = { id: "n", source_file: "docs/readme.md" };
    const node = normalizeNode(raw, 0);
    expect(node.file_type).toBe("document");
  });

  it("infers file_type as code for .ts files", () => {
    const raw = { id: "n", source_file: "src/app.ts" };
    const node = normalizeNode(raw, 0);
    expect(node.file_type).toBe("code");
  });
});

// ────────────────────────────────────────────────────────
// 7. normalizeEdge
// ────────────────────────────────────────────────────────
describe("normalizeEdge", () => {
  it("normalizes source/target/relation", () => {
    const raw = { src: "a", dst: "b", type: "CALLS", confidence: "extracted" };
    const edge = normalizeEdge(raw, 0);
    expect(edge).not.toBeNull();
    expect(edge!.source).toBe("a");
    expect(edge!.target).toBe("b");
    expect(edge!.relation).toBe("calls");
    expect(edge!.confidence).toBe("EXTRACTED");
  });

  it("returns null when source or target missing", () => {
    expect(normalizeEdge({ source: "a" }, 0)).toBeNull();
    expect(normalizeEdge({ target: "b" }, 0)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────
// 8. safeMermaidText
// ────────────────────────────────────────────────────────
describe("safeMermaidText", () => {
  it("strips special mermaid characters", () => {
    const result = safeMermaidText('foo "bar" {baz} ->> qux');
    expect(result).not.toContain('"');
    expect(result).not.toContain("{");
    expect(result).not.toContain("->>");
  });

  it("escapes HTML entities in result", () => {
    const amp = String.fromCharCode(38);
    expect(safeMermaidText("a & b < c")).toContain(amp + "amp;");
  });
});

// ────────────────────────────────────────────────────────
// 9. stableAsciiId
// ────────────────────────────────────────────────────────
describe("stableAsciiId", () => {
  it("produces deterministic id for same input", () => {
    const a = stableAsciiId("myFunction", "node");
    const b = stableAsciiId("myFunction", "node");
    expect(a).toBe(b);
  });

  it("prefixes with prefix_ when slug starts with digit", () => {
    const id = stableAsciiId("123abc", "node");
    expect(id).toMatch(/^node_123abc_/);
  });

  it("uses prefix when slug is empty", () => {
    const id = stableAsciiId("!!!", "sec");
    expect(id).toMatch(/^sec_/);
  });
});

// ────────────────────────────────────────────────────────
// 10. safeFilePath
// ────────────────────────────────────────────────────────
describe("safeFilePath", () => {
  it("returns last 3 segments for deep paths", () => {
    expect(safeFilePath("a/b/c/d/e.ts")).toBe("c/d/e.ts");
  });

  it("returns full path when <= 3 segments", () => {
    expect(safeFilePath("src/app.ts")).toBe("src/app.ts");
  });
});

// ────────────────────────────────────────────────────────
// 11. safeFilename
// ────────────────────────────────────────────────────────
describe("safeFilename", () => {
  it("replaces non-alphanumeric chars with dash", () => {
    expect(safeFilename("my project (v2)")).toBe("my-project-v2");
  });

  it("returns fallback for empty input", () => {
    expect(safeFilename("!!!")).toBe("project");
  });
});

// ────────────────────────────────────────────────────────
// 12. truncateText
// ────────────────────────────────────────────────────────
describe("truncateText", () => {
  it("truncates long text with ellipsis", () => {
    const result = truncateText("a very long text that exceeds the limit", 15);
    expect(result.length).toBeLessThanOrEqual(15);
    expect(result).toContain("...");
  });

  it("returns short text unchanged", () => {
    expect(truncateText("short", 20)).toBe("short");
  });
});

// ────────────────────────────────────────────────────────
// 13. humanizeLabel
// ────────────────────────────────────────────────────────
describe("humanizeLabel", () => {
  it("strips leading dot from method label", () => {
    expect(humanizeLabel(".myMethod()")).toBe("myMethod()");
  });

  it("returns basename for file-like labels", () => {
    expect(humanizeLabel("src/utils.ts")).toBe("utils.ts");
  });

  it("splits long snake_case labels", () => {
    const result = humanizeLabel("very_long_module_name_for_testing_stuff");
    expect(result.split(" ").length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(42);
  });

  it("returns Unknown for empty label without source", () => {
    expect(humanizeLabel("")).toBe("Unknown");
  });

  it("returns basename of source_file for empty label with source", () => {
    expect(humanizeLabel("", "src/app.ts")).toBe("app.ts");
  });
});

// ────────────────────────────────────────────────────────
// 14. nodeKind
// ────────────────────────────────────────────────────────
describe("nodeKind", () => {
  it("returns klass for class node_type", () => {
    expect(nodeKind(makeNode({ node_type: "class", label: "MyClass" }))).toBe("klass");
  });

  it("returns test for test node_type", () => {
    expect(nodeKind(makeNode({ node_type: "test", label: "myTest" }))).toBe("test");
  });

  it("returns api for endpoint node_type", () => {
    expect(nodeKind(makeNode({ node_type: "endpoint", label: "handler" }))).toBe("api");
  });

  it("returns concept for document file_type", () => {
    expect(nodeKind(makeNode({ file_type: "document", source_file: "doc.md" }))).toBe("concept");
  });

  it("returns function as default", () => {
    expect(nodeKind(makeNode({ node_type: "", label: "doWork" }))).toBe("function");
  });
});

// ────────────────────────────────────────────────────────
// 15. relationLabel
// ────────────────────────────────────────────────────────
describe("relationLabel", () => {
  it("translates calls to English", () => {
    expect(relationLabel("calls", "en")).toBe("calls");
  });

  it("translates calls to Chinese", () => {
    expect(relationLabel("calls", "zh-CN")).toBe("\u8c03\u7528"); // 调用
  });

  it("passes through unknown relation with underscores replaced", () => {
    expect(relationLabel("some_relation", "en")).toContain("some relation");
  });
});

// ────────────────────────────────────────────────────────
// 16. shouldIncludeEdge
// ────────────────────────────────────────────────────────
describe("shouldIncludeEdge", () => {
  it("includes EXTRACTED edges", () => {
    expect(shouldIncludeEdge(makeEdge({ confidence: "EXTRACTED" }))).toBe(true);
  });

  it("includes INFERRED edges with high score", () => {
    expect(shouldIncludeEdge(makeEdge({ confidence: "INFERRED", confidence_score: 0.9 }))).toBe(true);
  });

  it("excludes INFERRED edges with low score", () => {
    expect(shouldIncludeEdge(makeEdge({ confidence: "INFERRED", confidence_score: 0.5 }))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────
// 17. edgeScore
// ────────────────────────────────────────────────────────
describe("edgeScore", () => {
  it("gives higher score to EXTRACTED edges", () => {
    const extracted = edgeScore(makeEdge({ confidence: "EXTRACTED", relation: "calls", confidence_score: 1.0 }));
    const inferred = edgeScore(makeEdge({ confidence: "INFERRED", relation: "calls", confidence_score: 1.0 }));
    expect(extracted).toBeGreaterThan(inferred);
  });

  it("gives bonus for calls/uses/method relations", () => {
    const calls = edgeScore(makeEdge({ relation: "calls", confidence: "INFERRED", confidence_score: 0.5 }));
    const contains = edgeScore(makeEdge({ relation: "contains", confidence: "INFERRED", confidence_score: 0.5 }));
    expect(calls).toBeGreaterThan(contains);
  });
});

// ────────────────────────────────────────────────────────
// 18. nodeDegreeScores
// ────────────────────────────────────────────────────────
describe("nodeDegreeScores", () => {
  it("accumulates edge scores per node", () => {
    const edges: NormalizedEdge[] = [
      makeEdge({ source: "a", target: "b", relation: "calls", confidence: "EXTRACTED", confidence_score: 1.0 }),
      makeEdge({ source: "a", target: "c", relation: "uses", confidence: "EXTRACTED", confidence_score: 1.0 }),
    ];
    const scores = nodeDegreeScores(edges);
    expect(scores.get("a")!).toBeGreaterThan(scores.get("b")!);
  });
});

// ────────────────────────────────────────────────────────
// 19. nodeImportance
// ────────────────────────────────────────────────────────
describe("nodeImportance", () => {
  it("reads pagerank score", () => {
    expect(nodeImportance({ pagerank: 0.75 })).toBeCloseTo(0.75, 2);
  });

  it("returns 0 when no rank key exists", () => {
    expect(nodeImportance({ id: "x" })).toBe(0.0);
  });
});

// ────────────────────────────────────────────────────────
// 20. buildCommunityIndex
// ────────────────────────────────────────────────────────
describe("buildCommunityIndex", () => {
  it("groups nodes by community", () => {
    const nodes: NormalizedNode[] = [
      makeNode({ id: "a", community: "1" }),
      makeNode({ id: "b", community: "2" }),
      makeNode({ id: "c", community: "1" }),
    ];
    const idx = buildCommunityIndex(nodes);
    expect(idx["1"].length).toBe(2);
    expect(idx["2"].length).toBe(1);
  });
});

// ────────────────────────────────────────────────────────
// 21. htmlAnchorId
// ────────────────────────────────────────────────────────
describe("htmlAnchorId", () => {
  it("lowercases and hyphenates", () => {
    const used = new Set<string>();
    expect(htmlAnchorId("My Section Title", "", used)).toBe("my-section-title");
  });

  it("deduplicates via suffix when id already used", () => {
    const used = new Set<string>();
    used.add("test-id");
    const result = htmlAnchorId("test-id", "", used);
    expect(result).not.toBe("test-id");
  });
});

// ────────────────────────────────────────────────────────
// 22. normalizeCommunities
// ────────────────────────────────────────────────────────
describe("normalizeCommunities", () => {
  it("returns array as-is", () => {
    expect(normalizeCommunities([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("splits comma-separated string", () => {
    expect(normalizeCommunities("1, 2, 3")).toEqual(["1", "2", "3"]);
  });

  it("returns empty for null/undefined", () => {
    expect(normalizeCommunities(null)).toEqual([]);
    expect(normalizeCommunities(undefined)).toEqual([]);
  });

  it("wraps single value in array", () => {
    expect(normalizeCommunities(42)).toEqual([42]);
  });
});

// ────────────────────────────────────────────────────────
// 23. groupNodesByFile
// ────────────────────────────────────────────────────────
describe("groupNodesByFile", () => {
  it("groups nodes by source file", () => {
    const nodes: NormalizedNode[] = [
      makeNode({ id: "a", source_file: "src/app.ts" }),
      makeNode({ id: "b", source_file: "src/app.ts" }),
      makeNode({ id: "c", source_file: "lib/util.go" }),
    ];
    const groups = groupNodesByFile(nodes);
    expect(Object.keys(groups)).toContain("src/app.ts");
    expect(groups["src/app.ts"].length).toBe(2);
  });

  it("uses External / generated for empty source_file", () => {
    const nodes: NormalizedNode[] = [
      makeNode({ id: "x", source_file: "" }),
    ];
    const groups = groupNodesByFile(nodes);
    expect(Object.keys(groups)).toContain("External / generated");
  });

  it("sorts groups by count descending", () => {
    const nodes: NormalizedNode[] = [
      makeNode({ id: "1", source_file: "big.ts" }),
      makeNode({ id: "2", source_file: "big.ts" }),
      makeNode({ id: "3", source_file: "big.ts" }),
      makeNode({ id: "4", source_file: "small.ts" }),
    ];
    const groups = groupNodesByFile(nodes);
    const keys = Object.keys(groups);
    expect(keys[0]).toBe("big.ts");
  });
});

// ────────────────────────────────────────────────────────
// 24. generateNav
// ────────────────────────────────────────────────────────
describe("generateNav", () => {
  it("generates nav with escaped links", () => {
    const sections: Section[] = [
      { id: "overview", name: "Overview", communities: [] },
      { id: "api-section", name: "API & Services", communities: [] },
    ];
    const nav = generateNav(sections);
    const amp = String.fromCharCode(38);
    expect(nav).toContain("nav");
    expect(nav).toContain("#overview");
    expect(nav).toContain(amp + "amp;"); // & in "API & Services" is escaped
  });
});

// ────────────────────────────────────────────────────────
// 25. nodeDisplayName
// ────────────────────────────────────────────────────────
describe("nodeDisplayName", () => {
  it("returns humanized label from node", () => {
    expect(nodeDisplayName(makeNode({ label: ".run()" }), "")).toBe("run()");
  });

  it("returns fallback for null node", () => {
    expect(nodeDisplayName(null, "unknown")).toBe("unknown");
  });

  it("returns empty string for null node with no fallback", () => {
    expect(nodeDisplayName(null)).toBe("");
  });
});

// ────────────────────────────────────────────────────────
// 26. sectionKeywords
// ────────────────────────────────────────────────────────
describe("sectionKeywords", () => {
  it("extracts keywords from node labels and source files", () => {
    const nodes: NormalizedNode[] = [
      makeNode({ label: "exportData", source_file: "src/export.ts" }),
      makeNode({ label: "importModule", source_file: "src/import.ts" }),
    ];
    const kw = sectionKeywords(nodes, 5);
    expect(kw.length).toBeGreaterThan(0);
  });

  it("excludes stopwords", () => {
    const nodes: NormalizedNode[] = [
      makeNode({ label: "the class function", source_file: "src/file.ts" }),
    ];
    const kw = sectionKeywords(nodes, 10);
    expect(kw).not.toContain("the");
    expect(kw).not.toContain("class");
  });
});

// ────────────────────────────────────────────────────────
// 27. mermaidInit
// ────────────────────────────────────────────────────────
describe("mermaidInit", () => {
  it("starts with init directive and flowchart direction", () => {
    const result = mermaidInit(1.0, "TD");
    expect(result).toContain("%%{init:");
    expect(result).toContain("flowchart TD");
  });

  it("clamps scale between 0.65 and 1.8", () => {
    const low = mermaidInit(0.1);
    expect(low).toContain("9.8px"); // 15 * 0.65 = 9.75 -> "9.8px" (toFixed 1)
  });
});

// ────────────────────────────────────────────────────────
// 28. mermaidClassDefs
// ────────────────────────────────────────────────────────
describe("mermaidClassDefs", () => {
  it("returns array of 9 class definitions", () => {
    const defs = mermaidClassDefs();
    expect(defs.length).toBe(9);
    for (const def of defs) {
      expect(def).toContain("classDef");
    }
  });
});

// ────────────────────────────────────────────────────────
// 29. isZh / pickText
// ────────────────────────────────────────────────────────
describe("isZh", () => {
  it("returns true for zh-CN", () => {
    expect(isZh("zh-CN")).toBe(true);
  });

  it("returns false for en", () => {
    expect(isZh("en")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isZh("ZH-TW")).toBe(true);
  });
});

describe("pickText", () => {
  it("picks zh text for zh lang", () => {
    expect(pickText("zh-CN", "中文", "English")).toBe("中文");
  });

  it("picks en text for en lang", () => {
    expect(pickText("en", "中文", "English")).toBe("English");
  });
});

// ────────────────────────────────────────────────────────
// 30. detectLang
// ────────────────────────────────────────────────────────
describe("detectLang", () => {
  it("returns explicit lang when not auto", () => {
    expect(detectLang("en", [], {})).toBe("en");
  });

  it("detects zh-CN from Chinese labels", () => {
    expect(detectLang("auto", [], { "1": "服务端" })).toBe("zh-CN");
  });

  it("detects en when no Chinese characters", () => {
    expect(detectLang("auto", [], { "1": "server" })).toBe("en");
  });
});

// ────────────────────────────────────────────────────────
// 31. nodeLabel
// ────────────────────────────────────────────────────────
describe("nodeLabel", () => {
  it("returns mermaid-safe label with source file path", () => {
    const node = makeNode({ label: "doWork", source_file: "src/utils.ts" });
    const result = nodeLabel(node);
    expect(result).toContain("doWork");
    expect(result).toContain("<br/");
  });

  it("returns label without source when basename matches", () => {
    const node = makeNode({ label: "utils.ts", source_file: "src/utils.ts" });
    const result = nodeLabel(node);
    expect(result).not.toContain("<br/");
  });
});

// ────────────────────────────────────────────────────────
// 32. normalizeSections
// ────────────────────────────────────────────────────────
describe("normalizeSections", () => {
  it("prepends overview section", () => {
    const sections: Section[] = [
      { id: "api", name: "API Layer", communities: ["1"] },
    ];
    const result = normalizeSections(sections, "en");
    expect(result[0].id).toBe("overview");
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("merges duplicate overview section", () => {
    const sections: Section[] = [
      { id: "overview", name: "My Overview", communities: [] },
    ];
    const result = normalizeSections(sections, "en");
    expect(result[0].name).toBe("My Overview");
    expect(result.length).toBe(1);
  });

  it("handles empty input", () => {
    const result = normalizeSections([], "en");
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("overview");
  });
});
