import { describe, it, expect } from "vitest";
import { estimateCost, BACKENDS } from "../src/llm/index.js";

describe("estimateCost", () => {
  it("calculates cost for known backend with pricing", () => {
    const cost = estimateCost("claude", 1000, 500);
    // claude: input $3/MTok, output $15/MTok
    expect(cost).toBeCloseTo(3.0 * 1000 / 1e6 + 15.0 * 500 / 1e6, 6);
  });

  it("returns 0 for ollama (free)", () => {
    const cost = estimateCost("ollama", 1000, 500);
    expect(cost).toBe(0);
  });

  it("returns 0 for unknown backend", () => {
    const cost = estimateCost("nonexistent_backend", 1000, 500);
    expect(cost).toBe(0);
  });

  it("returns 0 for zero tokens", () => {
    const cost = estimateCost("claude", 0, 0);
    expect(cost).toBe(0);
  });
});
