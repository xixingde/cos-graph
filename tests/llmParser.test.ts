import { describe, it, expect, test, vi, beforeEach, afterEach } from "vitest";
import { parseLlmJson } from "../src/llm/parser.js";

describe("parseLlmJson", () => {
  it("parses preamble then fence", () => {
    const raw =
      "Here are the extracted entities:\n\n" +
      '```json\n{"nodes": [{"id": "a"}], "edges": []}\n```';
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([{ id: "a" }]);
    expect(result.edges).toEqual([]);
  });

  it("parses prose-wrapped JSON without fence", () => {
    const raw =
      'The extracted graph is {"nodes": [{"id": "b"}], "edges": []}. Hope this helps!';
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([{ id: "b" }]);
  });

  it("parses raw JSON still works", () => {
    const raw = '{"nodes": [], "edges": [], "hyperedges": []}';
    const result = parseLlmJson(raw);
    expect(result).toEqual({ nodes: [], edges: [], hyperedges: [] });
  });

  it("returns empty fragment on total refusal", () => {
    const raw = "I cannot extract structured data from this content.";
    const result = parseLlmJson(raw);
    expect(result).toEqual({ nodes: [], edges: [], hyperedges: [] });
  });

  it("parses fence with uppercase language tag", () => {
    const raw = '```JSON\n{"nodes": [{"id": "x"}], "edges": []}\n```';
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([{ id: "x" }]);
  });

  it("parses fence without closing backticks", () => {
    const raw = '```json\n{"nodes": [{"id": "y"}], "edges": []}';
    const result = parseLlmJson(raw);
    expect(result.nodes).toEqual([{ id: "y" }]);
  });

  it("returns empty fragment for empty response", () => {
    expect(parseLlmJson("")).toEqual({ nodes: [], edges: [], hyperedges: [] });
  });
});

// ---------- callClaudeCli argv shape (requires Claude CLI) ----------

test.skip("uses system-prompt not append-system-prompt (requires Claude CLI)", () => {
  // In TS, callClaudeCli uses --system-prompt flag.
  // Testing the actual subprocess call requires the claude binary.
});

test.skip("GRAPHIFY_CLAUDE_CLI_MODEL adds --model flag (requires Claude CLI)", () => {
  // Requires Claude CLI binary to test subprocess argv.
});

test.skip("no --model flag when GRAPHIFY_CLAUDE_CLI_MODEL unset (requires Claude CLI)", () => {
  // Requires Claude CLI binary.
});
