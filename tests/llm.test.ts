/** Tests for src/llm/ – ported from graphify/tests/test_backend_extras.py.
 *  Covers pure-logic functions that don't require network access.
 */
import { describe, it, expect } from "vitest";

import {
  parseLlmJson,
  responseIsHollow,
  LLM_JSON_MAX_BYTES,
} from "../src/llm/parser.js";

import {
  countTokens,
  FILE_CHAR_CAP,
  CHARS_PER_TOKEN,
  estimateFileTokens,
} from "../src/llm/tokens.js";

import {
  BACKENDS,
  providerBaseUrlOk,
  resolveMaxTokens,
  resolveTemperature,
  defaultModelForBackend,
  formatBackendEnvKeys,
  backendPkgHint,
} from "../src/llm/backends.js";

import {
  neutraliseInjectionSentinels,
  wrapUntrusted,
  isVisionImage,
  partitionSemanticFiles,
  backendSupportsVision,
  imageNotes,
  withImageNotes,
  estimateCost,
  ollamaHostIsLinkLocalOrMetadata,
  looksLikeContextExceeded,
  packChunksByTokens,
  placeholderCommunityLabels,
  parseLabelResponse,
  extractionSystem,
  openaiContent,
  detectBackend,
} from "../src/llm/index.js";

// ── parseLlmJson ────────────────────────────────────────────────────────────

describe("parseLlmJson", () => {
  it("parses plain JSON", () => {
    const raw = '{"nodes": [{"id": "a"}], "edges": [], "hyperedges": []}';
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([{ id: "a" }]);
    expect(result.edges).toEqual([]);
  });

  it("strips markdown fences with json tag", () => {
    const raw = '```json\n{"nodes": [], "edges": []}\n```';
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("strips markdown fences without tag", () => {
    const raw = '```\n{"nodes": [], "edges": []}\n```';
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([]);
  });

  it("strips markdown fences with js tag", () => {
    const raw = '```js\n{"nodes": [], "edges": []}\n```';
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([]);
  });

  it("extracts first balanced JSON object from text with preamble", () => {
    const raw = 'Here is the result:\n{"nodes": [{"id": "x"}], "edges": [], "hyperedges": []}\nDone.';
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([{ id: "x" }]);
  });

  it("returns empty fragment on invalid JSON", () => {
    const raw = "This is not JSON at all";
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.hyperedges).toEqual([]);
  });

  it("returns empty fragment on oversized input", () => {
    const raw = "x".repeat(LLM_JSON_MAX_BYTES + 1);
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([]);
  });

  it("handles nested braces in strings", () => {
    const raw = '{"nodes": [{"id": "a", "label": "foo {bar}"}], "edges": [], "hyperedges": []}';
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([{ id: "a", label: "foo {bar}" }]);
  });
});

// ── responseIsHollow ─────────────────────────────────────────────────────────

describe("responseIsHollow", () => {
  it("returns true for null content", () => {
    expect(responseIsHollow(null, { nodes: [], edges: [] })).toBe(true);
  });

  it("returns true for empty content", () => {
    expect(responseIsHollow("", { nodes: [], edges: [] })).toBe(true);
  });

  it("returns true for whitespace-only content", () => {
    expect(responseIsHollow("  \n  ", { nodes: [], edges: [] })).toBe(true);
  });

  it("returns true when parsed result has zero nodes and edges", () => {
    expect(responseIsHollow("some text", { nodes: [], edges: [], hyperedges: [] as unknown[] })).toBe(true);
  });

  it("returns false when parsed result has nodes", () => {
    expect(responseIsHollow("ok", { nodes: [{ id: "a" }], edges: [] })).toBe(false);
  });
});

// ── countTokens / estimateFileTokens ─────────────────────────────────────────

describe("countTokens", () => {
  // js-tiktoken lazy init can be slow on Windows; allow extra time
  it("returns positive number for non-empty text", { timeout: 60_000 }, () => {
    const n = countTokens("Hello, world! This is a test.");
    expect(n).toBeGreaterThan(0);
  });

  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("roughly proportional to text length", () => {
    const short = countTokens("Hi");
    const long = countTokens("This is a much longer sentence with many more words in it.");
    expect(long).toBeGreaterThan(short);
  });
});

describe("estimateFileTokens", () => {
  it("caps at FILE_CHAR_CAP", () => {
    const huge = estimateFileTokens({ type: "file", path: "big.ts", charCount: 100_000 });
    const cap = estimateFileTokens({ type: "file", path: "cap.ts", charCount: FILE_CHAR_CAP });
    // Both should be similar (the huge one is capped)
    expect(huge).toEqual(cap);
  });

  it("estimates 85 tokens for image files", () => {
    expect(estimateFileTokens({ type: "file", path: "photo.png" })).toBe(85);
    expect(estimateFileTokens({ type: "file", path: "pic.jpg" })).toBe(85);
    expect(estimateFileTokens({ type: "file", path: "icon.gif" })).toBe(85);
  });

  it("handles slice type", () => {
    const n = estimateFileTokens({ type: "slice", path: "a.ts", charCount: 500 });
    expect(n).toBeGreaterThan(0);
  });
});

// ── BACKENDS ─────────────────────────────────────────────────────────────────

describe("BACKENDS", () => {
  it("has expected backend entries", () => {
    expect("openai" in BACKENDS).toBe(true);
    expect("claude" in BACKENDS).toBe(true);
    expect("deepseek" in BACKENDS).toBe(true);
    expect("ollama" in BACKENDS).toBe(true);
    expect("bedrock" in BACKENDS).toBe(true);
    expect("azure" in BACKENDS).toBe(true);
    expect("gemini" in BACKENDS).toBe(true);
    expect("kimi" in BACKENDS).toBe(true);
  });

  it("each backend has required fields", () => {
    for (const [name, def] of Object.entries(BACKENDS)) {
      expect("pricing" in def, `${name} missing pricing`).toBe(true);
    }
  });
});

// ── providerBaseUrlOk ────────────────────────────────────────────────────────

describe("providerBaseUrlOk", () => {
  it("accepts localhost (loopback is allowed for providers)", () => {
    expect(providerBaseUrlOk("http://localhost:11434", "test")).toBe(true);
  });

  it("accepts 127.0.0.1 (loopback is allowed for providers)", () => {
    expect(providerBaseUrlOk("http://127.0.0.1:11434", "test")).toBe(true);
  });

  it("accepts https URL", () => {
    expect(providerBaseUrlOk("https://api.example.com/v1", "test")).toBe(true);
  });

  it("allows link-local 169.254.x.x (warns but does not reject)", () => {
    expect(providerBaseUrlOk("http://169.254.1.1:8080", "test", { warn: false })).toBe(true);
  });

  it("allows cloud metadata 169.254.169.254 (warns but does not reject)", () => {
    expect(providerBaseUrlOk("http://169.254.169.254:80", "test", { warn: false })).toBe(true);
  });

  it("allows 0.0.0.0 (warns but does not reject)", () => {
    expect(providerBaseUrlOk("http://0.0.0.0:8080", "test", { warn: false })).toBe(true);
  });
});

// ── resolveMaxTokens / resolveTemperature ────────────────────────────────────

describe("resolveMaxTokens", () => {
  it("returns default when env not set", () => {
    const orig = process.env.GRAPHIFY_MAX_OUTPUT_TOKENS;
    delete process.env.GRAPHIFY_MAX_OUTPUT_TOKENS;
    expect(resolveMaxTokens(8192)).toBe(8192);
    process.env.GRAPHIFY_MAX_OUTPUT_TOKENS = orig;
  });
});

describe("resolveTemperature", () => {
  it("returns default when env not set", () => {
    const orig = process.env.GRAPHIFY_LLM_TEMPERATURE;
    delete process.env.GRAPHIFY_LLM_TEMPERATURE;
    expect(resolveTemperature(0.2)).toBe(0.2);
    process.env.GRAPHIFY_LLM_TEMPERATURE = orig;
  });

  it("parses numeric string", () => {
    const orig = process.env.GRAPHIFY_TEMPERATURE;
    process.env.GRAPHIFY_LLM_TEMPERATURE = "0.5";
    expect(resolveTemperature(0.2)).toBe(0.5);
    process.env.GRAPHIFY_LLM_TEMPERATURE = orig;
  });

  it("returns null for 'none'", () => {
    const orig = process.env.GRAPHIFY_LLM_TEMPERATURE;
    process.env.GRAPHIFY_LLM_TEMPERATURE = "none";
    expect(resolveTemperature(0.2)).toBeNull();
    process.env.GRAPHIFY_LLM_TEMPERATURE = orig;
  });
});

// ── defaultModelForBackend ───────────────────────────────────────────────────

describe("defaultModelForBackend", () => {
  it("returns a model string for known backends", () => {
    expect(typeof defaultModelForBackend("openai")).toBe("string");
    expect(defaultModelForBackend("openai").length).toBeGreaterThan(0);
    expect(typeof defaultModelForBackend("claude")).toBe("string");
  });

  it("returns fallback for unknown backend", () => {
    expect(typeof defaultModelForBackend("unknown_backend")).toBe("string");
  });
});

// ── formatBackendEnvKeys / backendPkgHint ─────────────────────────────────────

describe("formatBackendEnvKeys", () => {
  it("returns a non-empty string for openai", () => {
    const result = formatBackendEnvKeys("openai");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("backendPkgHint", () => {
  it("returns a string mentioning the package name", () => {
    const hint = backendPkgHint("openai", "openai");
    expect(hint).toContain("openai");
  });
});

// ── neutraliseInjectionSentinels ─────────────────────────────────────────────

describe("neutraliseInjectionSentinels", () => {
  it("inserts ZWSP after opening angle bracket of sentinel tags", () => {
    const result = neutraliseInjectionSentinels("<untrusted_source>");
    // Should contain a zero-width space after <
    expect(result).toContain("<\u200Buntrusted_source>");
  });

  it("handles text without sentinels unchanged", () => {
    const text = "Hello world, this is normal text.";
    expect(neutraliseInjectionSentinels(text)).toBe(text);
  });
});

// ── wrapUntrusted ────────────────────────────────────────────────────────────

describe("wrapUntrusted", () => {
  it("wraps content with tags and SHA256", () => {
    const result = wrapUntrusted("src/main.ts", "Hello content");
    expect(result).toContain("<untrusted_source");
    expect(result).toContain("src/main.ts");
    expect(result).toContain('sha256="');
    expect(result).toContain("</untrusted_source>");
    expect(result).toContain("Hello content");
  });
});

// ── isVisionImage ────────────────────────────────────────────────────────────

describe("isVisionImage", () => {
  it("detects common image extensions", () => {
    expect(isVisionImage("photo.png")).toBe(true);
    expect(isVisionImage("pic.jpg")).toBe(true);
    expect(isVisionImage("icon.jpeg")).toBe(true);
    expect(isVisionImage("anim.gif")).toBe(true);
    expect(isVisionImage("img.webp")).toBe(true);
  });

  it("rejects non-image extensions", () => {
    expect(isVisionImage("main.ts")).toBe(false);
    expect(isVisionImage("style.css")).toBe(false);
    expect(isVisionImage("data.json")).toBe(false);
  });
});

// ── partitionSemanticFiles ───────────────────────────────────────────────────

describe("partitionSemanticFiles", () => {
  it("separates code from image files", () => {
    const [codeFiles, imageFiles] = partitionSemanticFiles([
      "src/main.ts",
      "docs/photo.png",
      "src/util.js",
      "assets/logo.svg",
    ]);
    expect(codeFiles).toEqual(["src/main.ts", "src/util.js"]);
    expect(imageFiles).toEqual(["docs/photo.png", "assets/logo.svg"]);
  });

  it("returns empty arrays for empty input", () => {
    const [codeFiles, imageFiles] = partitionSemanticFiles([]);
    expect(codeFiles).toEqual([]);
    expect(imageFiles).toEqual([]);
  });
});

// ── backendSupportsVision ────────────────────────────────────────────────────

describe("backendSupportsVision", () => {
  it("returns true for known vision backends", () => {
    expect(backendSupportsVision("openai")).toBe(true);
    expect(backendSupportsVision("claude")).toBe(true);
    expect(backendSupportsVision("gemini")).toBe(true);
  });

  it("returns false for ollama (base)", () => {
    expect(backendSupportsVision("ollama")).toBe(false);
  });
});

// ── imageNotes / withImageNotes ──────────────────────────────────────────────

describe("imageNotes", () => {
  it("returns empty string for empty refs", () => {
    expect(imageNotes([])).toBe("");
  });
});

describe("withImageNotes", () => {
  it("appends image notes to user message", () => {
    const msg = withImageNotes("Extract this", [], false);
    expect(msg).toContain("Extract this");
  });
});

// ── estimateCost ─────────────────────────────────────────────────────────────

describe("estimateCost", () => {
  it("returns 0 for unknown backends", () => {
    expect(estimateCost("unknown_backend", 1000, 500)).toBe(0);
  });

  it("returns positive cost for openai", () => {
    const cost = estimateCost("openai", 1_000_000, 500_000);
    expect(cost).toBeGreaterThan(0);
  });

  it("returns 0 cost for ollama", () => {
    expect(estimateCost("ollama", 1000, 500)).toBe(0);
  });
});

// ── ollamaHostIsLinkLocalOrMetadata ──────────────────────────────────────────

describe("ollamaHostIsLinkLocalOrMetadata", () => {
  it("detects link-local addresses", () => {
    expect(ollamaHostIsLinkLocalOrMetadata("169.254.1.1")).toBe(true);
    expect(ollamaHostIsLinkLocalOrMetadata("169.254.169.254")).toBe(true);
  });

  it("allows normal addresses", () => {
    expect(ollamaHostIsLinkLocalOrMetadata("192.168.1.1")).toBe(false);
    expect(ollamaHostIsLinkLocalOrMetadata("10.0.0.1")).toBe(false);
  });

  it("does not flag localhost (not link-local/metadata)", () => {
    expect(ollamaHostIsLinkLocalOrMetadata("localhost")).toBe(false);
    expect(ollamaHostIsLinkLocalOrMetadata("127.0.0.1")).toBe(false);
  });

  it("detects metadata host", () => {
    expect(ollamaHostIsLinkLocalOrMetadata("metadata.google.internal")).toBe(true);
  });
});

// ── looksLikeContextExceeded ─────────────────────────────────────────────────

describe("looksLikeContextExceeded", () => {
  it("detects context length errors", () => {
    expect(looksLikeContextExceeded(new Error("context_length_exceeded"))).toBe(true);
    expect(looksLikeContextExceeded(new Error("maximum context length exceeded"))).toBe(true);
  });

  it("detects finish_reason length", () => {
    expect(looksLikeContextExceeded(new Error('finish_reason": "length"'))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(looksLikeContextExceeded(new Error("network error"))).toBe(false);
    expect(looksLikeContextExceeded(new Error("API key invalid"))).toBe(false);
  });
});

// ── packChunksByTokens ───────────────────────────────────────────────────────

describe("packChunksByTokens", () => {
  it("packs files into chunks respecting token budget", () => {
    const files: string[] = ["a.ts", "b.ts", "c.ts"];
    const chunks = packChunksByTokens(files, 1);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("keeps all files across chunks", () => {
    const files = Array.from({ length: 10 }, (_, i) => `file${i}.ts`);
    const chunks = packChunksByTokens(files, 1);
    const allFiles = chunks.flat();
    expect(allFiles.length).toBe(10);
  });
});

// ── placeholderCommunityLabels ───────────────────────────────────────────────

describe("placeholderCommunityLabels", () => {
  it("returns Community N for each community", () => {
    const communities = { 0: ["a", "b"], 1: ["c"] };
    const labels = placeholderCommunityLabels(communities);
    expect(labels[0]).toBe("Community 0");
    expect(labels[1]).toBe("Community 1");
  });
});

// ── parseLabelResponse ───────────────────────────────────────────────────────

describe("parseLabelResponse", () => {
  it("parses string-keyed JSON to number-keyed labels", () => {
    const text = '{"0": "Auth Module", "1": "Data Pipeline"}';
    const result = parseLabelResponse(text, [0, 1]);
    expect(result[0]).toBe("Auth Module");
    expect(result[1]).toBe("Data Pipeline");
  });

  it("ignores unlabeled community IDs", () => {
    const text = '{"0": "Auth Module"}';
    const result = parseLabelResponse(text, [0, 1, 2]);
    expect(result[0]).toBe("Auth Module");
    expect(1 in result).toBe(false);
    expect(2 in result).toBe(false);
  });
});

// ── extractionSystem ─────────────────────────────────────────────────────────

describe("extractionSystem", () => {
  it("returns base prompt when deep=false", () => {
    const prompt = extractionSystem(false);
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).not.toContain("DEEP_EXTRACTION");
  });

  it("includes deep suffix when deep=true", () => {
    const base = extractionSystem(false);
    const deep = extractionSystem(true);
    expect(deep.length).toBeGreaterThan(base.length);
  });
});

// ── openaiContent ────────────────────────────────────────────────────────────

describe("openaiContent", () => {
  it("returns string when no image refs", () => {
    const content = openaiContent("Hello", []);
    expect(typeof content).toBe("string");
    expect(content).toBe("Hello");
  });
});

// ── detectBackend ────────────────────────────────────────────────────────────

describe("detectBackend", () => {
  it("returns null when no API keys are set", () => {
    // Save and clear all relevant env vars
    const keys = [
      "GEMINI_API_KEY", "MISTRAL_API_KEY", "KIMI_API_KEY",
      "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY",
      "AZURE_OPENAI_API_KEY", "AWS_ACCESS_KEY_ID",
      "OLLAMA_BASE_URL", "CLAUDE_API_KEY",
    ];
    const saved: Record<string, string | undefined> = {};
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    expect(detectBackend()).toBeNull();
    // Restore
    for (const k of keys) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
    }
  });
});
