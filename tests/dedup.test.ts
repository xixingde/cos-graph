/** Tests for src/dedup.ts entity deduplication pipeline.
 *  Ported from tests/test_dedup.py.
 */
import { describe, it, expect } from "vitest";
import {
  deduplicateEntities,
  entropy,
  shingles,
  norm,
  isVariantPair,
  shortLabelBlocked,
  numericTokensDiffer,
} from "../src/dedup.js";
import type { NodeAttributes, EdgeAttributes } from "../src/types/graph.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeNodes(...labels: string[]): NodeAttributes[] {
  return labels.map((label) => ({
    id: label.toLowerCase().replace(/ /g, "_"),
    label,
    sourceFile: "test.md",
  }));
}

function makeEdges(src: string, tgt: string, relation = "relates_to"): EdgeAttributes[] {
  return [{ source: src, target: tgt, relation }];
}

// ── entropy gate ─────────────────────────────────────────────────────────────

describe("entropy", () => {
  it("short label is low entropy", () => {
    expect(entropy("AI")).toBeLessThan(2.5);
  });

  it("normal label is high entropy", () => {
    expect(entropy("AuthenticationManager")).toBeGreaterThanOrEqual(2.5);
  });

  it("empty string is zero entropy", () => {
    expect(entropy("")).toBe(0);
  });
});

// ── shingles ─────────────────────────────────────────────────────────────────

describe("shingles", () => {
  it("produces trigrams", () => {
    const s = shingles("hello");
    expect(s.has("hel")).toBe(true);
    expect(s.has("ell")).toBe(true);
    expect(s.has("llo")).toBe(true);
  });

  it("short string returns single shingle", () => {
    expect(shingles("ab")).toEqual(new Set(["ab"]));
  });
});

// ── full pipeline ────────────────────────────────────────────────────────────

describe("deduplicateEntities", () => {
  it("exact duplicates merged", () => {
    const nodes = makeNodes("UserService", "userservice", "User Service");
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(1);
  });

  it("typo merged", () => {
    const nodes = makeNodes("GraphExtractor", "Graph Extractor");
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(1);
  });

  it("unrelated not merged", () => {
    const nodes = makeNodes("UserService", "OrderService");
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(2);
  });

  it("short low-entropy not merged", () => {
    const nodes = makeNodes("AI", "ML");
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(2);
  });

  it("edges rewired after merge", () => {
    const nodes = makeNodes("GraphExtractor", "Graph Extractor", "Parser");
    const edges: EdgeAttributes[] = [
      { source: "graph_extractor", target: "parser", relation: "uses" },
    ];
    const result = deduplicateEntities(nodes, edges);
    expect(result.nodes.length).toBe(2);
    expect(result.edges.length).toBe(1);
  });

  it("self-loops dropped after merge", () => {
    const nodes = makeNodes("GraphExtractor", "Graph Extractor");
    const edges: EdgeAttributes[] = [
      { source: "graphextractor", target: "graph_extractor", relation: "same" },
    ];
    const result = deduplicateEntities(nodes, edges);
    expect(result.edges.length).toBe(0);
  });

  it("community boost aids merge", () => {
    const nodes = makeNodes("AuthManager", "Auth Manager");
    const communitiesSame = { authmanager: 1, auth_manager: 1 };
    const communitiesDiff = { authmanager: 1, auth_manager: 2 };
    const withSame = deduplicateEntities(nodes, [], { communities: communitiesSame });
    const withDiff = deduplicateEntities(nodes, [], { communities: communitiesDiff });
    expect(withSame.nodes.length).toBeLessThanOrEqual(withDiff.nodes.length);
  });

  it("empty inputs", () => {
    const result = deduplicateEntities([], []);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("single node no crash", () => {
    const nodes = makeNodes("UserService");
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(1);
  });

  it("dedup llm flag accepted without crashing", () => {
    const nodes = makeNodes("UserService", "OrderService");
    const result = deduplicateEntities(nodes, [], { dedupLlmBackend: undefined });
    expect(result.nodes.length).toBe(2);
  });
});

// ── #878: fuzzy dedup false merges on short/variant labels ───────────────────

describe("variant guards (#878)", () => {
  it("does not merge numeric variants (ASR1603 vs ASR1605)", () => {
    const nodes = makeNodes("ASR1603", "ASR1605");
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(2);
  });

  it("does not merge short insertion variants (cranel vs cranelr)", () => {
    const nodes = makeNodes("cranel", "cranelr");
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(2);
  });

  it("does not merge model with suffix (M1 vs M1 Pro)", () => {
    const nodes = makeNodes("M1", "M1 Pro");
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(2);
  });
});

// ── isVariantPair helper ─────────────────────────────────────────────────────

describe("isVariantPair", () => {
  it("identifies chip-model variant pairs", () => {
    expect(isVariantPair("asr1603", "asr1605")).toBe(true);
    expect(isVariantPair("cortex a55", "cortex a55x")).toBe(true);
    expect(isVariantPair("graphextractor", "graphextracter")).toBe(false);
    expect(isVariantPair("foo", "foo")).toBe(false);
  });
});

// ── shortLabelBlocked ────────────────────────────────────────────────────────

describe("shortLabelBlocked", () => {
  it("still merges real same-length typos", () => {
    const a = "graphextractor";
    const b = "graphextractar";
    // These are same-length so neither is a prefix of the other
    const score = 98.0; // approximate JW score
    expect(isVariantPair(a, b)).toBe(false);
    expect(shortLabelBlocked(a, b, score)).toBe(false);
  });
});

// ── #1201: prefix-extension guard ────────────────────────────────────────────

describe("prefix-extension guard (#1201)", () => {
  it("prefix-extension symbols not merged", () => {
    const pairs = [
      ["getActiveSession", "getActiveSessions"],
      ["parseConfig", "parseConfigFile"],
      ["load", "loadAll"],
      ["handleRequest", "handleRequestTimeout"],
    ];
    for (const [a, b] of pairs) {
      const nodes: NodeAttributes[] = [
        { id: `${a}_id`, label: a, sourceFile: "api.py" },
        { id: `${b}_id`, label: b, sourceFile: "api.py" },
      ];
      const edges: EdgeAttributes[] = [
        { source: `${a}_id`, target: `${b}_id`, relation: "calls" },
      ];
      const result = deduplicateEntities(nodes, edges, {
        communities: { [`${a}_id`]: 0, [`${b}_id`]: 0 },
      });
      const labels = new Set(result.nodes.map((n) => n.label));
      expect(labels.has(a)).toBe(true);
      expect(labels.has(b)).toBe(true);
    }
  });
});

// ── #1247: pass-2 winner must not pull in uncompared same-label nodes ──────

describe("pass-2 winner union (#1247)", () => {
  it("uncompared cross-file node not absorbed", () => {
    const nodes: NodeAttributes[] = [
      { id: "session_manager_auth", label: "Session Manager", sourceFile: "auth.md" },
      { id: "sm", label: "Session Manager", sourceFile: "billing.md" },
      { id: "session_managr_notes", label: "Session Managr", sourceFile: "notes.md" },
    ];
    const result = deduplicateEntities(nodes, []);
    const ids = new Set(result.nodes.map((n) => n.id));
    // B must survive as a distinct node
    expect(ids.has("sm")).toBe(true);
    // The verified fuzzy pair merges — only one of A or C survives
    expect(result.nodes.length).toBe(2);
  });
});

// ── prefix guard specifics ───────────────────────────────────────────────────

describe("prefix guard", () => {
  it("does not block same-length typos", () => {
    const a = norm("GraphExtractor");
    const b = norm("GraphExtractar");
    const sorted = a.length <= b.length ? [a, b] as const : [b, a] as const;
    const lo = sorted[0];
    const hi = sorted[1];
    expect(hi.startsWith(lo) && hi !== lo).toBe(false);
  });

  it("fires for extension pairs", () => {
    const pairs = [
      ["getActiveSession", "getActiveSessions"],
      ["parseConfig", "parseConfigFile"],
      ["load", "loadAll"],
    ];
    for (const [aRaw, bRaw] of pairs) {
      const a = norm(aRaw);
      const b = norm(bRaw);
      const sorted = a.length <= b.length ? [a, b] as const : [b, a] as const;
      const lo = sorted[0];
      const hi = sorted[1];
      expect(hi.startsWith(lo) && hi !== lo).toBe(true);
    }
  });
});

// ── #1284: numbered siblings + cross-file file-anchored boilerplate ──────────

describe("numeric tokens differ (#1284)", () => {
  it("compares digit runs as zero-padding-insensitive multisets", () => {
    expect(numericTokensDiffer("adr 0011 d5 pipeline placement", "adr 0013 d4 pipeline placement")).toBe(true);
    expect(numericTokensDiffer("3 1 product goals", "1 1 product goals")).toBe(true);
    expect(numericTokensDiffer("code block3", "code block13")).toBe(true);
    expect(numericTokensDiffer("phase 09 overview", "phase 9 overview")).toBe(false);
    expect(numericTokensDiffer("module layout wave 3", "module layouts wave 3")).toBe(false);
    expect(numericTokensDiffer("graph extractor", "graph extractar")).toBe(false);
  });
});

describe("numbered siblings not merged (#1284)", () => {
  it("does not merge numbered siblings", () => {
    const nodes: NodeAttributes[] = [
      { id: "n1", label: "Pipeline placement — 4 call sites (ADR 0013 D4)", fileType: "document", sourceFile: "docs/index-activity.md" },
      { id: "n2", label: "Pipeline placement — 4 call sites (ADR 0011 §D5)", fileType: "document", sourceFile: "docs/schema-matcher.md" },
    ];
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(2);
  });

  it("does not merge cross-file rationale boilerplate", () => {
    const boiler = "Django app config for {}. No business logic here. Domain services live in services.py and adapters in providers.";
    const nodes: NodeAttributes[] = [
      { id: "r1", label: boiler.replace("{}", "apps.platform.cards"), fileType: "rationale", sourceFile: "apps/platform/cards/apps.py" },
      { id: "r2", label: boiler.replace("{}", "apps.platform.cores"), fileType: "rationale", sourceFile: "apps/platform/cores/apps.py" },
    ];
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(2);
  });

  it("does not merge cross-file document headings", () => {
    const nodes: NodeAttributes[] = [
      { id: "d1", label: "Getting Started Installation Guide", fileType: "document", sourceFile: "docs/a.md" },
      { id: "d2", label: "Getting Started Installation Setup", fileType: "document", sourceFile: "docs/b.md" },
    ];
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(2);
  });

  it("still merges same-file rationale duplicates", () => {
    const nodes: NodeAttributes[] = [
      { id: "r1", label: "Counts-only metrics export, a read-only aggregation service.", fileType: "rationale", sourceFile: "apps/schemas/metrics.py" },
      { id: "r2", label: "Counts-only metrics export, the read-only aggregation service.", fileType: "rationale", sourceFile: "apps/schemas/metrics.py" },
    ];
    const result = deduplicateEntities(nodes, []);
    // These differ by one word ("a" vs "the") in same file — high JW score, should merge
    expect(result.nodes.length).toBe(1);
  });
});

// ── #1243: JaroWinkler prefix-bonus over-merge (cross-file) ──────────────────

describe("cross-file shared-prefix divergence (#1243)", () => {
  it("does not merge cross-file shared-prefix divergence", () => {
    const nodes: NodeAttributes[] = [
      { id: "p1", label: "testing library jest native", fileType: "concept", sourceFile: "pkg-a/package.json" },
      { id: "p2", label: "testing library react native", fileType: "concept", sourceFile: "pkg-b/package.json" },
    ];
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(2);
  });

  it("still merges cross-file true duplicates", () => {
    const nodes: NodeAttributes[] = [
      { id: "g1", label: "GraphExtractor", fileType: "concept", sourceFile: "a.md" },
      { id: "g2", label: "Graph Extractor", fileType: "concept", sourceFile: "b.md" },
    ];
    const result = deduplicateEntities(nodes, []);
    expect(result.nodes.length).toBe(1);
  });
});
