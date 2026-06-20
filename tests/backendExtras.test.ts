import { describe, it, expect } from "vitest";
import { backendPkgHint } from "../src/llm/backends.js";

describe("backendPkgHint", () => {
  it("mentions uv tool and the extra name", () => {
    const hint = backendPkgHint("anthropic", "anthropic");
    expect(hint).toContain("uv tool install");
    expect(hint).toContain("[anthropic]");
    expect(hint).toContain("anthropic");
  });
});
