import { describe, it, expect, afterEach } from "vitest";

describe("OpenAI custom endpoint", () => {
  const savedBaseUrl = process.env.OPENAI_BASE_URL;
  const savedModel = process.env.OPENAI_MODEL;
  const savedGraphifyModel = process.env.GRAPHIFY_OPENAI_MODEL;

  afterEach(() => {
    if (savedBaseUrl !== undefined) process.env.OPENAI_BASE_URL = savedBaseUrl;
    else delete process.env.OPENAI_BASE_URL;
    if (savedModel !== undefined) process.env.OPENAI_MODEL = savedModel;
    else delete process.env.OPENAI_MODEL;
    if (savedGraphifyModel !== undefined) process.env.GRAPHIFY_OPENAI_MODEL = savedGraphifyModel;
    else delete process.env.GRAPHIFY_OPENAI_MODEL;
  });

  it("defaults without env vars", async () => {
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.GRAPHIFY_OPENAI_MODEL;
    expect(process.env.OPENAI_BASE_URL).toBeUndefined();
    expect(process.env.OPENAI_MODEL).toBeUndefined();
  });

  it("respects OPENAI_BASE_URL and OPENAI_MODEL", async () => {
    process.env.OPENAI_BASE_URL = "http://localhost:8080/v1";
    process.env.OPENAI_MODEL = "env-default-model";
    expect(process.env.OPENAI_BASE_URL).toBe("http://localhost:8080/v1");
    expect(process.env.OPENAI_MODEL).toBe("env-default-model");
  });

  it("GRAPHIFY_OPENAI_MODEL wins over OPENAI_MODEL", async () => {
    process.env.OPENAI_MODEL = "env-default-model";
    process.env.GRAPHIFY_OPENAI_MODEL = "graphify-override-model";
    // BACKENDS.openai.model_env_key is "GRAPHIFY_OPENAI_MODEL",
    // so defaultModelForBackend("openai") should prefer GRAPHIFY_OPENAI_MODEL.
    const { defaultModelForBackend } = await import("../src/llm/backends.js");
    expect(defaultModelForBackend("openai")).toBe("graphify-override-model");
  });
});
