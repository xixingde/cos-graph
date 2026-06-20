import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BackendDef, Pricing } from "../types/llm.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Model-name fragments for OpenAI-compatible "reasoning" models that reject an
 * explicit temperature. Covers o1/o3/o4 reasoning series and gpt-5 family. */
const FIXED_TEMPERATURE_MODEL_MARKERS = ["o1", "o1-", "o3", "o3-", "o4", "o4-", "gpt-5"];

// ---------------------------------------------------------------------------
// BACKENDS configuration
// ---------------------------------------------------------------------------

export const BACKENDS: Record<string, BackendDef> = {
  claude: {
    base_url: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    default_model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    env_key: "ANTHROPIC_API_KEY",
    pricing: { input: 3.0, output: 15.0 } as Pricing,
    temperature: 0,
    max_tokens: 16384,
    vision: true,
  },
  kimi: {
    base_url: "https://api.moonshot.ai/v1",
    default_model: "kimi-k2.6",
    env_key: "MOONSHOT_API_KEY",
    vision: true,
    pricing: { input: 0.74, output: 4.66 } as Pricing,
    temperature: null,
    max_tokens: 16384,
  },
  ollama: {
    base_url: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
    default_model: process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
    env_key: "OLLAMA_API_KEY",
    pricing: { input: 0.0, output: 0.0 } as Pricing,
    temperature: 0,
    max_tokens: 16384,
  },
  gemini: {
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
    default_model: "gemini-3-flash-preview",
    env_keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    model_env_key: "GRAPHIFY_GEMINI_MODEL",
    pricing: { input: 0.50, output: 3.00 } as Pricing,
    temperature: 0,
    reasoning_effort: "low",
    max_completion_tokens: 16384,
    vision: true,
  },
  openai: {
    base_url: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    default_model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    env_key: "OPENAI_API_KEY",
    model_env_key: "GRAPHIFY_OPENAI_MODEL",
    max_tokens: 16384,
    pricing: { input: 0.40, output: 1.60 } as Pricing,
    temperature: 0,
    vision: true,
  },
  deepseek: {
    base_url: "https://api.deepseek.com",
    default_model: "deepseek-v4-flash",
    env_key: "DEEPSEEK_API_KEY",
    model_env_key: "GRAPHIFY_DEEPSEEK_MODEL",
    pricing: { input: 0.14, output: 0.28 } as Pricing,
    temperature: 0,
    max_tokens: 16384,
  },
  azure: {
    default_model:
      process.env.AZURE_OPENAI_DEPLOYMENT ||
      process.env.GRAPHIFY_AZURE_MODEL ||
      "gpt-4o",
    env_key: "AZURE_OPENAI_API_KEY",
    model_env_key: "GRAPHIFY_AZURE_MODEL",
    pricing: { input: 2.50, output: 10.00 } as Pricing,
    temperature: 0,
    max_tokens: 16384,
  },
  bedrock: {
    default_model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    model_env_key: "GRAPHIFY_BEDROCK_MODEL",
    pricing: { input: 3.0, output: 15.0 } as Pricing,
    temperature: 0,
    max_tokens: 16384,
    vision: true,
  },
  "claude-cli": {
    default_model: "claude-code-plan",
    pricing: { input: 0.0, output: 0.0 } as Pricing,
    temperature: 0,
    max_tokens: 16384,
    vision: true,
  },
};

// ---------------------------------------------------------------------------
// Custom providers
// ---------------------------------------------------------------------------

export function customProvidersPath(global_ = true): string {
  if (global_) {
    return join(homedir(), ".graphify", "providers.json");
  }
  return join(".graphify", "providers.json");
}

export function providerBaseUrlOk(
  base_url: string,
  name: string,
  opts: { warn?: boolean } = {}
): boolean {
  const { warn = true } = opts;
  let parsed: URL;
  try {
    parsed = new URL(base_url);
  } catch {
    if (warn) {
      console.error(
        `[graphify] WARNING: provider '${name}' has an unparseable base_url; ignoring.`
      );
    }
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    if (warn) {
      console.error(
        `[graphify] WARNING: provider '${name}' base_url scheme '${parsed.protocol.replace(":", "")}' is not http/https; ignoring.`
      );
    }
    return false;
  }
  const host = (parsed.hostname || "").toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("127.");
  if (warn && parsed.protocol === "http:" && !isLoopback) {
    console.error(
      `[graphify] WARNING: provider '${name}' sends your corpus to '${host}' over plaintext http. Use https unless this is a trusted local endpoint.`
    );
  }
  return true;
}

export function loadCustomProviders(): Record<string, BackendDef> {
  const localPath = customProvidersPath(false);
  const globalPath = customProvidersPath(true);
  const allowLocalVal = (process.env.GRAPHIFY_ALLOW_LOCAL_PROVIDERS || "")
    .trim()
    .toLowerCase();
  const allowLocal2 =
    allowLocalVal === "1" || allowLocalVal === "true" || allowLocalVal === "yes";

  if (existsSync(localPath) && !allowLocal2) {
    console.error(
      `[graphify] WARNING: ignoring project-local ${localPath} (custom providers control ` +
        `where your corpus and API key are sent). Set GRAPHIFY_ALLOW_LOCAL_PROVIDERS=1 to load it.`
    );
  }

  const providers: Record<string, BackendDef> = {};
  const paths = allowLocal2 ? [localPath, globalPath] : [globalPath];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        for (const [name, cfg] of Object.entries(data as Record<string, unknown>)) {
          if (typeof name !== "string" || typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) continue;
          if (name in BACKENDS || name in providers) continue;
          if (!providerBaseUrlOk(String((cfg as Record<string, unknown>).base_url || ""), name)) continue;
          const def = { ...(cfg as BackendDef) };
          if (!("pricing" in def)) {
            (def as Record<string, unknown>).pricing = { input: 0.0, output: 0.0 };
          }
          providers[name] = def;
        }
      }
    } catch {
      // ignore parse errors
    }
  }
  return providers;
}

// Merge custom providers at module init
const _custom = loadCustomProviders();
for (const [k, v] of Object.entries(_custom)) {
  BACKENDS[k] = v;
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

export function resolveMaxTokens(default_: number): number {
  const raw = (process.env.GRAPHIFY_MAX_OUTPUT_TOKENS || "").trim();
  if (raw) {
    const v = parseInt(raw, 10);
    if (v > 0) return v;
  }
  return default_;
}

export function modelRequiresDefaultTemperature(model: string): boolean {
  const m = (model || "").toLowerCase();
  const base = m.includes("/") ? m.split("/").pop()! : m;
  if (base.startsWith("gpt-5")) return true;
  for (const fam of ["o1", "o3", "o4"]) {
    if (base === fam || base.startsWith(fam + "-")) return true;
  }
  return false;
}

export function resolveTemperature(
  default_: number | null,
  model = ""
): number | null {
  const raw = (process.env.GRAPHIFY_LLM_TEMPERATURE || "").trim();
  if (raw) {
    if (["none", "omit", "default"].includes(raw.toLowerCase())) return null;
    const v = parseFloat(raw);
    if (!isNaN(v)) return v;
    console.error(
      `[graphify] GRAPHIFY_LLM_TEMPERATURE='${raw}' is not a number or 'none'; falling back to the backend default.`
    );
  }
  if (modelRequiresDefaultTemperature(model)) return null;
  return default_;
}

export function bedrockInferenceConfig(
  maxTokens: number,
  model = ""
): Record<string, unknown> {
  const cfg: Record<string, unknown> = { maxTokens };
  const temp = resolveTemperature(0, model);
  if (temp !== null) cfg.temperature = temp;
  return cfg;
}

export function noWindowKwargs(): Record<string, unknown> {
  if (process.platform === "win32") {
    return { windowsHide: true };
  }
  return {};
}

export function resolveApiTimeout(default_ = 600): number {
  const raw = (process.env.GRAPHIFY_API_TIMEOUT || "").trim();
  if (raw) {
    const v = parseFloat(raw);
    if (v > 0) return v;
  }
  return default_;
}

// ---------------------------------------------------------------------------
// Backend key helpers
// ---------------------------------------------------------------------------

export function backendEnvKeys(backend: string): string[] {
  const cfg = BACKENDS[backend];
  if (!cfg) return [];
  const keys = cfg.env_keys;
  if (keys) return [...keys];
  const envKey = cfg.env_key;
  if (envKey) return [envKey];
  return [];
}

export function getBackendApiKey(backend: string): string {
  for (const envKey of backendEnvKeys(backend)) {
    const value = process.env[envKey];
    if (value) return value;
  }
  return "";
}

export function formatBackendEnvKeys(backend: string): string {
  const keys = backendEnvKeys(backend);
  return keys.length > 0 ? keys.join(" or ") : "AWS_PROFILE or AWS_REGION";
}

export function defaultModelForBackend(backend: string): string {
  const cfg = BACKENDS[backend];
  if (!cfg) return "";
  const modelEnvKey = cfg.model_env_key;
  if (modelEnvKey) {
    const model = process.env[modelEnvKey];
    if (model) return model;
  }
  return cfg.default_model;
}

export function backendPkgHint(pkg: string, extra: string): string {
  return (
    `the '${pkg}' package is required for this backend but is not installed. ` +
    `Install it with:  uv tool install "graphifyy[${extra}]" --force  ` +
    `(uv tool), or  pip install ${pkg}  (pip/venv install).`
  );
}
