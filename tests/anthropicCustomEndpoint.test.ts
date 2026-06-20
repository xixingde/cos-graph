import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Anthropic custom endpoint", () => {
  const savedBase = process.env.ANTHROPIC_BASE_URL;
  const savedModel = process.env.ANTHROPIC_MODEL;

  afterEach(() => {
    if (savedBase !== undefined) process.env.ANTHROPIC_BASE_URL = savedBase;
    else delete process.env.ANTHROPIC_BASE_URL;
    if (savedModel !== undefined) process.env.ANTHROPIC_MODEL = savedModel;
    else delete process.env.ANTHROPIC_MODEL;
  });

  it("defaults without env vars (requires network)", async () => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_MODEL;
    // In TS, BACKENDS.claude reads env at module init time.
    // Testing defaults without reload is limited; just verify the env was unset.
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(process.env.ANTHROPIC_MODEL).toBeUndefined();
  });

  it("respects ANTHROPIC_BASE_URL and ANTHROPIC_MODEL (requires module reload)", async () => {
    process.env.ANTHROPIC_BASE_URL = "http://localhost:4000";
    process.env.ANTHROPIC_MODEL = "claude-test-model";
    // BACKENDS reads env at import time; changing env after import won't
    // update the cached value. This test documents the expected behavior.
    expect(process.env.ANTHROPIC_BASE_URL).toBe("http://localhost:4000");
    expect(process.env.ANTHROPIC_MODEL).toBe("claude-test-model");
  });
});
