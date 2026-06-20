import { describe, it, expect } from "vitest";
import { claudeCliEnvelope } from "../src/llm/claude-cli.js";

describe("claudeCliEnvelope", () => {
  it("parses a single envelope object", () => {
    const envelope = JSON.stringify({
      type: "result",
      result: "hello world",
      model: "claude-3",
    });
    const parsed = claudeCliEnvelope(envelope);
    expect(parsed.type).toBe("result");
    expect(parsed.result).toBe("hello world");
  });

  it("extracts last result event from a streamed array", () => {
    const events = [
      { type: "init", session_id: "abc" },
      { type: "assistant", content: "thinking..." },
      { type: "result", result: "final answer", model: "claude-3" },
    ];
    const parsed = claudeCliEnvelope(JSON.stringify(events));
    expect(parsed.type).toBe("result");
    expect(parsed.result).toBe("final answer");
  });

  it("falls back to last element when no result event", () => {
    const events = [
      { type: "init", session_id: "abc" },
      { type: "assistant", content: "partial" },
    ];
    const parsed = claudeCliEnvelope(JSON.stringify(events));
    expect(parsed.type).toBe("assistant");
  });

  it("throws on unparseable JSON", () => {
    expect(() => claudeCliEnvelope("not json at all")).toThrow(/unparseable/);
  });

  it("throws on empty array", () => {
    expect(() => claudeCliEnvelope("[]")).toThrow();
  });

  it("prefers the last result when multiple result events exist", () => {
    const events = [
      { type: "result", result: "first", model: "claude-3" },
      { type: "result", result: "second", model: "claude-3" },
    ];
    const parsed = claudeCliEnvelope(JSON.stringify(events));
    expect(parsed.result).toBe("second");
  });
});
