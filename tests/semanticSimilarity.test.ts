import { describe, it, expect } from "vitest";
import { ollamaHostIsLinkLocalOrMetadata, estimateCost, BACKENDS } from "../src/llm/index.js";

describe("ollamaHostIsLinkLocalOrMetadata", () => {
  it("blocks 169.254.x.x (link-local)", () => {
    expect(ollamaHostIsLinkLocalOrMetadata("169.254.169.254")).toBe(true);
    expect(ollamaHostIsLinkLocalOrMetadata("169.254.0.1")).toBe(true);
  });

  it("blocks 100.64.x.x–100.127.x.x (CGN)", () => {
    expect(ollamaHostIsLinkLocalOrMetadata("100.64.0.1")).toBe(true);
    expect(ollamaHostIsLinkLocalOrMetadata("100.127.255.254")).toBe(true);
  });

  it("blocks 198.18.x.x (benchmark)", () => {
    expect(ollamaHostIsLinkLocalOrMetadata("198.18.0.1")).toBe(true);
  });

  it("blocks 127.0.0.53 (systemd-resolved stub)", () => {
    expect(ollamaHostIsLinkLocalOrMetadata("127.0.0.53")).toBe(true);
  });

  it("allows loopback 127.0.0.1", () => {
    expect(ollamaHostIsLinkLocalOrMetadata("127.0.0.1")).toBe(false);
  });

  it("allows regular LAN addresses", () => {
    expect(ollamaHostIsLinkLocalOrMetadata("192.168.1.1")).toBe(false);
    expect(ollamaHostIsLinkLocalOrMetadata("10.0.0.1")).toBe(false);
  });

  it("allows localhost hostname", () => {
    expect(ollamaHostIsLinkLocalOrMetadata("localhost")).toBe(false);
  });
});

describe("cost estimation similarity across backends", () => {
  it("cost scales linearly with token count", () => {
    const c1 = estimateCost("claude", 1000, 500);
    const c2 = estimateCost("claude", 2000, 1000);
    expect(c2).toBeCloseTo(c1 * 2, 4);
  });

  it("ollama always costs 0 regardless of tokens", () => {
    expect(estimateCost("ollama", 1e6, 1e6)).toBe(0);
  });
});
