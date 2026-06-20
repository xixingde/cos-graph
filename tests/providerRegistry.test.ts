import { describe, it, expect, afterEach } from "vitest";
import {
  BACKENDS,
  backendEnvKeys,
  defaultModelForBackend,
  formatBackendEnvKeys,
  modelRequiresDefaultTemperature,
  resolveMaxTokens,
  resolveApiTimeout,
} from "../src/llm/backends.js";

describe("provider registry", () => {
  it("all backends have a default_model or model_env_key or aws_profile", () => {
    for (const [name, cfg] of Object.entries(BACKENDS)) {
      const hasDefaultModel = "default_model" in cfg && cfg.default_model;
      const hasModelEnvKey = "model_env_key" in cfg && cfg.model_env_key;
      const hasAwsProfile = "aws_profile" in cfg;
      expect(Boolean(hasDefaultModel || hasModelEnvKey || hasAwsProfile)).toBe(true);
    }
  });

  it("all backends have pricing", () => {
    for (const [name, cfg] of Object.entries(BACKENDS)) {
      expect(cfg.pricing).toBeDefined();
      expect(typeof (cfg.pricing as { input: number }).input).toBe("number");
      expect(typeof (cfg.pricing as { output: number }).output).toBe("number");
    }
  });
  it("known backends with env_key or env_keys produce keys", () => {
    for (const [name, cfg] of Object.entries(BACKENDS)) {
      if (!("env_key" in cfg) && !("env_keys" in cfg)) continue;
      const keys = backendEnvKeys(name);
      expect(keys.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("formatBackendEnvKeys produces readable hint", () => {
    const hint = formatBackendEnvKeys("claude");
    expect(hint).toContain("ANTHROPIC_API_KEY");
  });

  it("gemini has multiple env_keys", () => {
    const keys = backendEnvKeys("gemini");
    expect(keys).toContain("GEMINI_API_KEY");
    expect(keys).toContain("GOOGLE_API_KEY");
  });
});

describe("defaultModelForBackend", () => {
  it("returns a non-empty string for known backend", () => {
    const model = defaultModelForBackend("claude");
    expect(model.length).toBeGreaterThan(0);
  });

  it("returns empty string for unknown backend", () => {
    expect(defaultModelForBackend("nonexistent")).toBe("");
  });
});

describe("modelRequiresDefaultTemperature", () => {
  it("returns true for o1 models", () => {
    expect(modelRequiresDefaultTemperature("o1-preview")).toBe(true);
    expect(modelRequiresDefaultTemperature("o1-mini")).toBe(true);
  });

  it("returns true for o3 models", () => {
    expect(modelRequiresDefaultTemperature("o3-mini")).toBe(true);
  });

  it("returns false for gpt-4 models", () => {
    expect(modelRequiresDefaultTemperature("gpt-4o")).toBe(false);
    expect(modelRequiresDefaultTemperature("gpt-4.1-mini")).toBe(false);
  });

  it("returns true for gpt-5 models", () => {
    expect(modelRequiresDefaultTemperature("gpt-5")).toBe(true);
    expect(modelRequiresDefaultTemperature("gpt-5-turbo")).toBe(true);
  });
});

describe("resolveMaxTokens", () => {
  const saved = process.env.GRAPHIFY_MAX_OUTPUT_TOKENS;

  afterEach(() => {
    if (saved !== undefined) process.env.GRAPHIFY_MAX_OUTPUT_TOKENS = saved;
    else delete process.env.GRAPHIFY_MAX_OUTPUT_TOKENS;
  });

  it("returns default when env var is unset", () => {
    delete process.env.GRAPHIFY_MAX_OUTPUT_TOKENS;
    expect(resolveMaxTokens(4096)).toBe(4096);
  });

  it("returns env value when set", () => {
    process.env.GRAPHIFY_MAX_OUTPUT_TOKENS = "8192";
    expect(resolveMaxTokens(4096)).toBe(8192);
  });
});

describe("resolveApiTimeout", () => {
  const saved = process.env.GRAPHIFY_API_TIMEOUT;

  afterEach(() => {
    if (saved !== undefined) process.env.GRAPHIFY_API_TIMEOUT = saved;
    else delete process.env.GRAPHIFY_API_TIMEOUT;
  });

  it("returns default when env var is unset", () => {
    delete process.env.GRAPHIFY_API_TIMEOUT;
    expect(resolveApiTimeout(300)).toBe(300);
  });

  it("returns env value when set", () => {
    process.env.GRAPHIFY_API_TIMEOUT = "120";
    expect(resolveApiTimeout(300)).toBe(120);
  });
});
