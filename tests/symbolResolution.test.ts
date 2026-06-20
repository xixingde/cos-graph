import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  normaliseCallableLabel,
  nodeIsResolvableSymbol,
  buildLabelIndex,
  existingEdgePairs,
  iterRawCalls,
  moduleStem,
  parsePythonImportAliases,
  nodeSourceStem,
  buildPythonSymbolIndex,
  findUniquePythonSymbol,
  resolvePythonImportGuidedCalls,
  resolveCrossFileRawCalls,
  bashMakeId,
  bashFileStem,
  resolveBashSourceEdges,
  sanitizeMetadata,
} from "../src/symbolResolution.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkdtemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "symbol-res-test-"));
}

function rmdir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeTmpFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// normaliseCallableLabel
// ---------------------------------------------------------------------------

describe("normaliseCallableLabel", () => {
  it("strips function punctuation", () => {
    expect(normaliseCallableLabel("run()")).toBe("run");
    expect(normaliseCallableLabel(".process()")).toBe("process");
    expect(normaliseCallableLabel("  Execute  ")).toBe("execute");
  });
});

// ---------------------------------------------------------------------------
// nodeIsResolvableSymbol
// ---------------------------------------------------------------------------

describe("nodeIsResolvableSymbol", () => {
  it("skips non-code file types", () => {
    expect(nodeIsResolvableSymbol({ id: "a", label: "run()", file_type: "code" })).toBe(true);
    expect(nodeIsResolvableSymbol({ id: "r", label: "why", file_type: "rationale" })).toBe(false);
    expect(nodeIsResolvableSymbol({ id: "d", label: "param x", file_type: "doc_tag" })).toBe(false);
  });

  it("requires code file type", () => {
    const code = { id: "n1", label: "helper", file_type: "code" };
    const doc = { id: "n2", label: "helper", file_type: "document" };
    const paper = { id: "n3", label: "helper", file_type: "paper" };
    const image = { id: "n4", label: "helper", file_type: "image" };
    const no_ft = { id: "n5", label: "helper" };

    expect(nodeIsResolvableSymbol(code)).toBe(true);
    expect(nodeIsResolvableSymbol(doc)).toBe(false);
    expect(nodeIsResolvableSymbol(paper)).toBe(false);
    expect(nodeIsResolvableSymbol(image)).toBe(false);
    expect(nodeIsResolvableSymbol(no_ft)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildLabelIndex
// ---------------------------------------------------------------------------

describe("buildLabelIndex", () => {
  it("collects unique symbols", () => {
    const nodes = [
      { id: "a_run", label: "run()", file_type: "code" },
      { id: "b_run", label: "run()", file_type: "code" },
      { id: "doc", label: "run docs", file_type: "doc_tag" },
    ];
    const index = buildLabelIndex(nodes);
    expect(index.get("run")).toEqual(["a_run", "b_run"]);
  });

  it("excludes non-code nodes", () => {
    const nodes = [
      { id: "code_one", label: "helper", file_type: "code" },
      { id: "doc_one", label: "helper", file_type: "document" },
      { id: "paper_one", label: "helper", file_type: "paper" },
    ];
    const index = buildLabelIndex(nodes);
    expect(index.get("helper")).toEqual(["code_one"]);
  });
});

// ---------------------------------------------------------------------------
// existingEdgePairs
// ---------------------------------------------------------------------------

describe("existingEdgePairs", () => {
  it("encodes source/target/relation triples", () => {
    const edges = [
      { source: "a", target: "b", relation: "calls" },
      { source: "b", target: "c", relation: "contains" },
    ];
    const pairs = existingEdgePairs(edges);
    expect(pairs.has("a|b|calls")).toBe(true);
    expect(pairs.has("b|c|contains")).toBe(true);
    expect(pairs.has("a|b|contains")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// iterRawCalls
// ---------------------------------------------------------------------------

describe("iterRawCalls", () => {
  it("skips non-dict per_file entries", () => {
    expect(iterRawCalls(["not a dict", null, 42])).toEqual([]);
  });

  it("skips non-list raw_calls", () => {
    expect(iterRawCalls([{ raw_calls: "abc" }])).toEqual([]);
    expect(iterRawCalls([{ raw_calls: null }])).toEqual([]);
    expect(iterRawCalls([{ raw_calls: 42 }])).toEqual([]);
  });

  it("drops non-dict items in list", () => {
    const out = iterRawCalls([{ raw_calls: ["str", 42, null, { callee: "real", caller_nid: "c" }] }]);
    expect(out).toEqual([{ callee: "real", caller_nid: "c" }]);
  });
});

// ---------------------------------------------------------------------------
// moduleStem
// ---------------------------------------------------------------------------

describe("moduleStem", () => {
  it("returns the final module component", () => {
    expect(moduleStem("package.helper")).toBe("helper");
    expect(moduleStem(".helper")).toBe("helper");
    expect(moduleStem(null)).toBe("");
    expect(moduleStem("single")).toBe("single");
  });
});

// ---------------------------------------------------------------------------
// parsePythonImportAliases
// ---------------------------------------------------------------------------

describe("parsePythonImportAliases", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
  });

  afterEach(() => {
    rmdir(tmpDir);
  });

  it("supports from import with alias", () => {
    const filePath = writeTmpFile(tmpDir, "caller.py", "from helper import transform as tx\n");

    const aliases = parsePythonImportAliases(filePath);

    expect(aliases.has("tx")).toBe(true);
    const imported = aliases.get("tx")!;
    expect(imported.localName).toBe("tx");
    expect(imported.importedName).toBe("transform");
    expect(imported.moduleStem).toBe("helper");
    expect(imported.sourceLocation).toBe("L1");
  });

  it("skips function-local imports", () => {
    const py = writeTmpFile(tmpDir, "scoped.py", [
      "def one():",
      "    from helper import transform",
      "    return transform()",
      "",
      "def two():",
      "    return transform()",
    ].join("\n"));

    const aliases = parsePythonImportAliases(py);
    expect(aliases.has("transform")).toBe(false);
  });

  it("accepts top-level import", () => {
    const py = writeTmpFile(tmpDir, "toplevel.py", [
      "from helper import transform",
      "",
      "def one():",
      "    return transform()",
    ].join("\n"));

    const aliases = parsePythonImportAliases(py);
    expect(aliases.has("transform")).toBe(true);
    expect(aliases.get("transform")!.moduleStem).toBe("helper");
  });

  it("skips star imports", () => {
    const py = writeTmpFile(tmpDir, "star.py", "from helper import *\n");
    const aliases = parsePythonImportAliases(py);
    expect(aliases.size).toBe(0);
  });

  it("returns empty map for missing file", () => {
    const aliases = parsePythonImportAliases(path.join(tmpDir, "nonexistent.py"));
    expect(aliases.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildPythonSymbolIndex / findUniquePythonSymbol
// ---------------------------------------------------------------------------

describe("buildPythonSymbolIndex", () => {
  it("uses module stem and label", () => {
    const nodes = [
      { id: "helper_transform", label: "transform()", file_type: "code", source_file: "/repo/helper.py" },
      { id: "other_transform", label: "transform()", file_type: "code", source_file: "/repo/other.py" },
    ];
    const index = buildPythonSymbolIndex(nodes);
    expect(index.get("helper\0transform")).toEqual(["helper_transform"]);
    expect(index.get("other\0transform")).toEqual(["other_transform"]);
  });
});

describe("findUniquePythonSymbol", () => {
  it("returns null when ambiguous", () => {
    const index = new Map<string, string[]>();
    index.set("helper\0transform", ["a", "b"]);
    const imported = { localName: "transform", importedName: "transform", moduleStem: "helper", sourceFile: "", sourceLocation: "" };
    expect(findUniquePythonSymbol(index, imported)).toBeNull();
  });

  it("returns node id when unique", () => {
    const index = new Map<string, string[]>();
    index.set("helper\0transform", ["helper_transform"]);
    const imported = { localName: "transform", importedName: "transform", moduleStem: "helper", sourceFile: "", sourceLocation: "" };
    expect(findUniquePythonSymbol(index, imported)).toBe("helper_transform");
  });
});

// ---------------------------------------------------------------------------
// resolveCrossFileRawCalls
// ---------------------------------------------------------------------------

describe("resolveCrossFileRawCalls", () => {
  it("emits unique unqualified call", () => {
    const perFile: unknown[] = [
      {
        raw_calls: [
          { caller_nid: "caller_run", callee: "helper", is_member_call: false, source_file: "caller.py", source_location: "L2" },
        ],
      },
    ];
    const nodes = [
      { id: "caller_run", label: "run()", file_type: "code" },
      { id: "helper_helper", label: "helper()", file_type: "code" },
    ];

    const resolved = resolveCrossFileRawCalls(perFile, nodes, []);

    expect(resolved).toEqual([
      {
        source: "caller_run",
        target: "helper_helper",
        relation: "calls",
        context: "call",
        confidence: "INFERRED",
        confidence_score: 0.8,
        source_file: "caller.py",
        source_location: "L2",
        weight: 1.0,
      },
    ]);
  });

  it("skips member calls", () => {
    const perFile: unknown[] = [
      { raw_calls: [{ caller_nid: "caller_run", callee: "helper", is_member_call: true, source_file: "caller.py", source_location: "L2" }] },
    ];
    const nodes = [
      { id: "caller_run", label: "run()", file_type: "code" },
      { id: "helper_helper", label: "helper()", file_type: "code" },
    ];
    expect(resolveCrossFileRawCalls(perFile, nodes, [])).toEqual([]);
  });

  it("skips ambiguous duplicate labels", () => {
    const perFile: unknown[] = [
      { raw_calls: [{ caller_nid: "caller_run", callee: "log", is_member_call: false, source_file: "caller.py", source_location: "L2" }] },
    ];
    const nodes = [
      { id: "caller_run", label: "run()", file_type: "code" },
      { id: "a_log", label: "log()", file_type: "code" },
      { id: "b_log", label: "log()", file_type: "code" },
    ];
    expect(resolveCrossFileRawCalls(perFile, nodes, [])).toEqual([]);
  });

  it("skips existing pair", () => {
    const perFile: unknown[] = [
      { raw_calls: [{ caller_nid: "caller_run", callee: "helper", is_member_call: false, source_file: "caller.py", source_location: "L2" }] },
    ];
    const nodes = [
      { id: "caller_run", label: "run()", file_type: "code" },
      { id: "helper_helper", label: "helper()", file_type: "code" },
    ];
    const edges = [{ source: "caller_run", target: "helper_helper", relation: "calls" }];
    expect(resolveCrossFileRawCalls(perFile, nodes, edges)).toEqual([]);
  });

  it("survives malformed raw_calls", () => {
    expect(resolveCrossFileRawCalls([{ raw_calls: "abc" }], [], [])).toEqual([]);
    expect(resolveCrossFileRawCalls([{ raw_calls: ["not dict", 42] }], [], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolvePythonImportGuidedCalls
// ---------------------------------------------------------------------------

describe("resolvePythonImportGuidedCalls", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
  });

  afterEach(() => {
    rmdir(tmpDir);
  });

  it("emits extracted edge for import-guided call", () => {
    const callerPath = writeTmpFile(tmpDir, "caller.py", "from helper import transform as tx\n\ndef run(value):\n    return tx(value)\n");
    const helperPath = writeTmpFile(tmpDir, "helper.py", "def transform(value):\n    return value\n");

    const perFile: unknown[] = [
      { raw_calls: [{ caller_nid: "caller_run", callee: "tx", is_member_call: false, source_file: callerPath, source_location: "L4" }] },
      { raw_calls: [] },
    ];
    const nodes = [
      { id: "caller_run", label: "run()", file_type: "code", source_file: callerPath },
      { id: "helper_transform", label: "transform()", file_type: "code", source_file: helperPath },
    ];

    const edges = resolvePythonImportGuidedCalls(perFile, [callerPath, helperPath], nodes, []);

    expect(edges).toHaveLength(1);
    const edge = edges[0];
    expect(edge.source).toBe("caller_run");
    expect(edge.target).toBe("helper_transform");
    expect(edge.relation).toBe("calls");
    expect(edge.context).toBe("import_guided_call");
    expect(edge.confidence).toBe("EXTRACTED");
    expect(edge.confidence_score).toBe(1.0);
    expect(edge.source_file).toBe(callerPath);
    expect(edge.source_location).toBe("L4");
    expect(edge.weight).toBe(1.0);
    const metadata = edge.metadata as Record<string, unknown>;
    expect(metadata.resolver).toBe("python_import_guided");
    expect(metadata.local_name).toBe("tx");
    expect(metadata.imported_name).toBe("transform");
    expect(metadata.module_stem).toBe("helper");
  });

  it("survives malformed raw_calls", () => {
    const py = writeTmpFile(tmpDir, "caller.py", "from helper import transform\n");
    expect(resolvePythonImportGuidedCalls([{ raw_calls: "not a list" }], [py], [], [])).toEqual([]);
  });

  it("handles non-dict per_file slot", () => {
    const py = writeTmpFile(tmpDir, "caller.py", "from helper import transform\n");
    expect(resolvePythonImportGuidedCalls(["not a dict"], [py], [], [])).toEqual([]);
  });

  it("handles per_file shorter than paths", () => {
    const a = writeTmpFile(tmpDir, "a.py", "from helper import transform\n");
    const b = writeTmpFile(tmpDir, "b.py", "from helper import transform\n");
    expect(resolvePythonImportGuidedCalls([{}], [a, b], [], [])).toEqual([]);
  });

  it("handles None per_file slot", () => {
    const py = writeTmpFile(tmpDir, "caller.py", "from helper import transform\n");
    expect(resolvePythonImportGuidedCalls([null], [py], [], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sanitizeMetadata
// ---------------------------------------------------------------------------

describe("sanitizeMetadata", () => {
  it("escapes HTML in string values", () => {
    const result = sanitizeMetadata({ key: "<script>alert(1)</script>" });
    expect(result.key).not.toContain("<script>");
  });

  it("strips control characters", () => {
    const result = sanitizeMetadata({ key: "hello\x00world" });
    expect(result.key).toBe("helloworld");
  });

  it("returns empty for null", () => {
    expect(sanitizeMetadata(null)).toEqual({});
    expect(sanitizeMetadata(undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// bashMakeId / bashFileStem
// ---------------------------------------------------------------------------

describe("bashMakeId", () => {
  it("normalizes identifiers", () => {
    expect(bashMakeId("foo", "bar")).toBe(bashMakeId("foo", "bar"));
    expect(bashMakeId("auth")).toBe(bashMakeId("auth"));
    expect(bashMakeId("_module", "_helper")).toBe(bashMakeId("_module", "_helper"));
    expect(bashMakeId("my-script", "main")).toBe(bashMakeId("my-script", "main"));
  });

  it("handles unicode with NFKC normalization", () => {
    // é is preserved as a word character
    expect(typeof bashMakeId("caf\u00e9", "run")).toBe("string");
  });
});

describe("bashFileStem", () => {
  it("includes parent directory", () => {
    expect(bashFileStem("scripts/main.sh")).toBe("scripts.main");
  });

  it("returns stem for top-level files", () => {
    expect(bashFileStem("main.sh")).toBe("main");
  });
});

// ---------------------------------------------------------------------------
// resolveBashSourceEdges
// ---------------------------------------------------------------------------

describe("resolveBashSourceEdges", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
  });

  afterEach(() => {
    rmdir(tmpDir);
  });

  it("emits source edges", () => {
    const aSh = writeTmpFile(tmpDir, "a.sh", "#!/usr/bin/env bash\nsource ./b.sh\n");
    const bSh = writeTmpFile(tmpDir, "b.sh", "#!/usr/bin/env bash\nb_func() { echo ok; }\n");

    const perFile: (Record<string, unknown> | null)[] = [
      {
        nodes: [
          { id: "a_sh", label: "a.sh", file_type: "code", source_file: aSh },
          { id: "a_entry", label: "a.sh script", file_type: "code", source_file: aSh },
        ],
        edges: [],
        raw_calls: [],
        bash_sources: [{ source_file: aSh, target_path: bSh, source_location: "L2" }],
      },
      {
        nodes: [
          { id: "b_sh", label: "b.sh", file_type: "code", source_file: bSh },
          { id: "b_func", label: "b_func()", file_type: "code", source_file: bSh, metadata: { kind: "bash_function" } },
        ],
        edges: [],
        raw_calls: [],
        bash_sources: [],
      },
    ];

    const edges = resolveBashSourceEdges(perFile, [aSh, bSh], tmpDir);
    const imports = edges.filter((e) => e.relation === "imports_from");
    expect(imports).toHaveLength(1);
    expect(imports[0].confidence).toBe("EXTRACTED");
  });

  it("emits call edges from sourced files", () => {
    const aSh = writeTmpFile(tmpDir, "a.sh", "#!/usr/bin/env bash\nsource ./b.sh\nmain() { b_func; }\n");
    const bSh = writeTmpFile(tmpDir, "b.sh", "#!/usr/bin/env bash\nb_func() { echo ok; }\n");

    const perFile: (Record<string, unknown> | null)[] = [
      {
        nodes: [
          { id: "a_sh", label: "a.sh", file_type: "code", source_file: aSh },
          { id: "main", label: "main()", file_type: "code", source_file: aSh, metadata: { kind: "bash_function" } },
        ],
        edges: [],
        raw_calls: [{ language: "bash", caller_nid: "main", callee: "b_func", is_member_call: false, source_file: aSh, source_location: "L3" }],
        bash_sources: [{ source_file: aSh, target_path: bSh, source_location: "L2" }],
      },
      {
        nodes: [
          { id: "b_sh", label: "b.sh", file_type: "code", source_file: bSh },
          { id: "b_func", label: "b_func()", file_type: "code", source_file: bSh, metadata: { kind: "bash_function" } },
        ],
        edges: [],
        raw_calls: [],
        bash_sources: [],
      },
    ];

    const edges = resolveBashSourceEdges(perFile, [aSh, bSh], tmpDir);
    const calls = edges.filter((e) => e.relation === "calls");
    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe("main");
    expect(calls[0].target).toBe("b_func");
    expect(calls[0].confidence).toBe("EXTRACTED");
  });

  it("skips existing pair", () => {
    const aSh = writeTmpFile(tmpDir, "a.sh", "#!/usr/bin/env bash\nsource ./b.sh\nmain() { b_func; }\n");
    const bSh = writeTmpFile(tmpDir, "b.sh", "#!/usr/bin/env bash\nb_func() { echo ok; }\n");

    const perFile: (Record<string, unknown> | null)[] = [
      {
        nodes: [
          { id: "a_sh", label: "a.sh", file_type: "code", source_file: aSh },
          { id: "main", label: "main()", file_type: "code", source_file: aSh, metadata: { kind: "bash_function" } },
        ],
        edges: [],
        raw_calls: [{ language: "bash", caller_nid: "main", callee: "b_func", is_member_call: false, source_file: aSh, source_location: "L3" }],
        bash_sources: [{ source_file: aSh, target_path: bSh, source_location: "L2" }],
      },
      {
        nodes: [
          { id: "b_sh", label: "b.sh", file_type: "code", source_file: bSh },
          { id: "b_func", label: "b_func()", file_type: "code", source_file: bSh, metadata: { kind: "bash_function" } },
        ],
        edges: [],
        raw_calls: [],
        bash_sources: [],
      },
    ];
    const existing = [{ source: "main", target: "b_func", relation: "calls" }];

    const edges = resolveBashSourceEdges(perFile, [aSh, bSh], tmpDir, existing);
    const calls = edges.filter((e) => e.relation === "calls");
    expect(calls).toHaveLength(0);
  });

  it("skips ambiguous multiple candidates", () => {
    const aSh = writeTmpFile(tmpDir, "a.sh", "#!/usr/bin/env bash\nsource ./b.sh\nsource ./c.sh\nmain() { helper; }\n");
    const bSh = writeTmpFile(tmpDir, "b.sh", "#!/usr/bin/env bash\nhelper() { echo b; }\n");
    const cSh = writeTmpFile(tmpDir, "c.sh", "#!/usr/bin/env bash\nhelper() { echo c; }\n");

    const perFile: (Record<string, unknown> | null)[] = [
      {
        nodes: [
          { id: "a_sh", label: "a.sh", file_type: "code", source_file: aSh },
          { id: "main", label: "main()", file_type: "code", source_file: aSh, metadata: { kind: "bash_function" } },
        ],
        edges: [],
        raw_calls: [{ language: "bash", caller_nid: "main", callee: "helper", is_member_call: false, source_file: aSh, source_location: "L4" }],
        bash_sources: [
          { source_file: aSh, target_path: bSh, source_location: "L2" },
          { source_file: aSh, target_path: cSh, source_location: "L3" },
        ],
      },
      {
        nodes: [
          { id: "b_sh", label: "b.sh", file_type: "code", source_file: bSh },
          { id: "b_helper", label: "helper()", file_type: "code", source_file: bSh, metadata: { kind: "bash_function" } },
        ],
        edges: [],
        raw_calls: [],
        bash_sources: [],
      },
      {
        nodes: [
          { id: "c_sh", label: "c.sh", file_type: "code", source_file: cSh },
          { id: "c_helper", label: "helper()", file_type: "code", source_file: cSh, metadata: { kind: "bash_function" } },
        ],
        edges: [],
        raw_calls: [],
        bash_sources: [],
      },
    ];

    const edges = resolveBashSourceEdges(perFile, [aSh, bSh, cSh], tmpDir);
    const calls = edges.filter((e) => e.relation === "calls");
    expect(calls).toHaveLength(0);
  });

  it("skips non-bash raw calls", () => {
    const aSh = writeTmpFile(tmpDir, "a.sh", "#!/usr/bin/env bash\n");

    const perFile: (Record<string, unknown> | null)[] = [
      {
        nodes: [{ id: "a_sh", label: "a.sh", file_type: "code", source_file: aSh }],
        edges: [],
        raw_calls: [{ language: "python", caller_nid: "a_main", callee: "helper", is_member_call: false, source_file: aSh, source_location: "L1" }],
        bash_sources: [],
      },
    ];

    const edges = resolveBashSourceEdges(perFile, [aSh], tmpDir);
    expect(edges).toEqual([]);
  });

  it("skips malformed source entries", () => {
    const aSh = writeTmpFile(tmpDir, "a.sh", "# noop\n");
    const perFile: (Record<string, unknown> | null)[] = [
      {
        nodes: [],
        raw_calls: [],
        bash_sources: [
          {} as Record<string, unknown>,
          { target_path: "" } as Record<string, unknown>,
          { target_path: null } as unknown as Record<string, unknown>,
        ],
      },
    ];
    const edges = resolveBashSourceEdges(perFile, [aSh], tmpDir);
    expect(edges).toEqual([]);
  });

  it("accepts None per_file entries", () => {
    const aSh = writeTmpFile(tmpDir, "a.sh", "# noop\n");
    const edges = resolveBashSourceEdges([null], [aSh], tmpDir);
    expect(edges).toEqual([]);
  });

  it("skips non-dict lists", () => {
    const aSh = writeTmpFile(tmpDir, "a.sh", "# noop\n");
    const perFile: (Record<string, unknown> | null)[] = [
      {
        nodes: ["not a dict", 42, null] as unknown as Record<string, unknown>[],
        raw_calls: [null, "string entry", { language: "bash" }] as unknown as Record<string, unknown>[],
        bash_sources: [null, "str", 99] as unknown as Record<string, unknown>[],
      },
    ];
    const edges = resolveBashSourceEdges(perFile, [aSh], tmpDir);
    expect(edges).toEqual([]);
  });

  it("resolves relative path against source dir", () => {
    const subDir = path.join(tmpDir, "scripts");
    fs.mkdirSync(subDir);
    const mainPath = path.join(subDir, "main.sh");
    const helperPath = path.join(subDir, "helper.sh");
    fs.writeFileSync(mainPath, "# main\n", "utf-8");
    fs.writeFileSync(helperPath, "# helper\n", "utf-8");

    const perFile: (Record<string, unknown> | null)[] = [
      {
        nodes: [],
        raw_calls: [],
        bash_sources: [{ target_path: "./helper.sh" }],
      },
      {
        nodes: [],
        raw_calls: [],
        bash_sources: [],
      },
    ];

    const edges = resolveBashSourceEdges(perFile, [mainPath, helperPath], tmpDir);
    const importEdges = edges.filter((e) => e.relation === "imports_from");
    expect(importEdges).toHaveLength(1);
  });

  it("skips unhashable callee", () => {
    const aSh = writeTmpFile(tmpDir, "a.sh", "# noop\n");
    const bSh = writeTmpFile(tmpDir, "b.sh", "# noop\n");

    const perFile: (Record<string, unknown> | null)[] = [
      {
        nodes: [],
        raw_calls: [
          { language: "bash", caller_nid: "caller", callee: ["bad"] },
          { language: "bash", caller_nid: "caller", callee: { also: "bad" } },
          { language: "bash", caller_nid: "caller", callee: 42 },
        ] as unknown as Record<string, unknown>[],
        bash_sources: [{ target_path: bSh }],
      },
      {
        nodes: [
          { id: "b_helper", label: "helper()", metadata: { kind: "bash_function" } },
        ],
        raw_calls: [],
        bash_sources: [],
      },
    ];

    const edges = resolveBashSourceEdges(perFile, [aSh, bSh], tmpDir);
    expect(edges.every((e) => e.relation !== "calls")).toBe(true);
  });
});
