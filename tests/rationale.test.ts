import { describe, it, expect } from "vitest";
import { estimateCost, BACKENDS } from "../src/llm/index.js";

describe("cost rationale: pricing is proportional to model tier", () => {
  it("claude is more expensive than deepseek per token", () => {
    const claudeCost = estimateCost("claude", 1000, 1000);
    const deepseekCost = estimateCost("deepseek", 1000, 1000);
    expect(claudeCost).toBeGreaterThan(deepseekCost);
  });

  it("openai input price is between claude and deepseek", () => {
    const claudeIn = (BACKENDS.claude.pricing as { input: number }).input;
    const openaiIn = (BACKENDS.openai.pricing as { input: number }).input;
    const deepseekIn = (BACKENDS.deepseek.pricing as { input: number }).input;
    expect(openaiIn).toBeLessThan(claudeIn);
    expect(openaiIn).toBeGreaterThan(deepseekIn);
  });

  it("ollama pricing is always zero", () => {
    const p = BACKENDS.ollama.pricing as { input: number; output: number };
    expect(p.input).toBe(0);
    expect(p.output).toBe(0);
  });
});
