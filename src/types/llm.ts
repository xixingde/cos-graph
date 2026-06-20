export interface Pricing {
  input: number;
  output: number;
}

/** Shape of a single BACKENDS dict entry (mirrors Python's llm.BACKENDS values). */
export interface BackendDef {
  base_url?: string;
  default_model: string;
  env_key?: string;
  env_keys?: string[];
  model_env_key?: string;
  pricing: Pricing;
  temperature?: number | null;
  max_tokens?: number;
  max_completion_tokens?: number;
  vision?: boolean;
  reasoning_effort?: string;
  extra_body?: Record<string, unknown>;
}

/** Resolved backend config used at call time. */
export interface BackendConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  envKey?: string;
  envKeys?: string[];
  modelEnvKey?: string;
  pricing?: Pricing;
  temperature?: number | null;
  maxTokens?: number;
  maxCompletionTokens?: number;
  vision?: boolean;
  reasoningEffort?: string;
}

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model?: string;
  finishReason?: string;
}

export interface CustomProvider {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/** Raw extraction result dict returned by LLM backend calls. */
export interface RawExtractionResult {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  hyperedges: Record<string, unknown>[];
  input_tokens: number;
  output_tokens: number;
  model?: string;
  finish_reason?: string;
  elapsed_seconds?: number;
  failed_chunks?: number;
}

/** A raster image reference for vision-enabled backends. */
export interface ImageRef {
  path: string;       // absolute path (claude-cli reads it via the Read tool)
  rel: string;        // path relative to the corpus root
  mediaType: string;  // e.g. "image/png"
  raw: Buffer | null;
}
