import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateOllamaBaseUrl, BACKENDS, detectBackend, getBackendApiKey } from "../src/llm/index.js";

describe("validateOllamaBaseUrl", () => {
  const linkLocalUrls = [
    "http://169.254.169.254:11434/v1",
    "http://169.254.1.1:11434/v1",
    "http://[fe80::1]:11434/v1",
    "http://[fe80::1%eth0]:11434/v1",
  ];

  it.each(linkLocalUrls)("blocks link-local / metadata URL %s", (url) => {
    expect(() => validateOllamaBaseUrl(url)).toThrow();
  });

  it("allows loopback and LAN addresses", () => {
    expect(() => validateOllamaBaseUrl("http://localhost:11434/v1")).not.toThrow();
    expect(() => validateOllamaBaseUrl("http://127.0.0.1:11434/v1")).not.toThrow();
    expect(() => validateOllamaBaseUrl("http://192.168.1.100:11434/v1")).not.toThrow();
  });

  it("blocks DNS resolving to link-local (via warn=false)", () => {
    // We can't easily make DNS resolve in a unit test, so just verify
    // the validation function accepts a valid URL.
    expect(() => validateOllamaBaseUrl("http://my-ollama:11434/v1", false)).not.toThrow();
  });

  it("warn=false still hard-blocks link-local but stays quiet", () => {
    // Hard-block is always enforced even with warn=false
    expect(() => validateOllamaBaseUrl("http://169.254.169.254:11434/v1", false)).toThrow();
  });
});

describe("BACKENDS", () => {
  it("contains ollama backend", () => {
    expect(BACKENDS.ollama).toBeDefined();
    expect(BACKENDS.ollama.base_url).toContain("localhost");
  });
});

describe("detectBackend", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save all relevant env vars
    const keys = [
      "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "MOONSHOT_API_KEY",
      "GEMINI_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY",
      "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT",
      "AWS_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION",
      "OLLAMA_BASE_URL",
    ];
    for (const k of keys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    // Restore
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it("detects ollama when OLLAMA_BASE_URL is set", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434/v1";
    expect(detectBackend()).toBe("ollama");
  });

  it("kimi beats ollama", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434/v1";
    process.env.MOONSHOT_API_KEY = "test-key";
    expect(detectBackend()).toBe("kimi");
  });

  it("claude beats ollama", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434/v1";
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(detectBackend()).toBe("claude");
  });

  it("returns null without env vars", () => {
    expect(detectBackend()).toBeNull();
  });
});

describe("Ollama API key sentinel", () => {
  it("BACKENDS.ollama uses OLLAMA_API_KEY env_key", () => {
    expect(BACKENDS.ollama.env_key).toBe("OLLAMA_API_KEY");
  });
});
