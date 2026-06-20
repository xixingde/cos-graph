import OpenAI from "openai";
import type { ImageRef, RawExtractionResult } from "../types/llm.js";
import { BACKENDS, resolveApiTimeout, backendPkgHint } from "./backends.js";
import { CHARS_PER_TOKEN } from "./tokens.js";
import { parseLlmJson, responseIsHollow } from "./parser.js";

/** Call any OpenAI-compatible API (Kimi, OpenAI, etc.) and return parsed JSON. */
export async function callOpenAiCompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  userMessage: string,
  temperature: number | null = 0,
  reasoningEffort: string | null = null,
  maxCompletionTokens = 8192,
  opts: {
    backend?: string;
    deepMode?: boolean;
    images?: ImageRef[];
    extraBody?: Record<string, unknown>;
    extractionSystem?: string;
    openaiContent?: unknown;
  } = {}
): Promise<RawExtractionResult> {
  const { backend = "", deepMode = false, images, extraBody, extractionSystem, openaiContent } = opts;

  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    timeout: resolveApiTimeout() * 1000,
  });

  const kwargs: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: extractionSystem || "" },
      { role: "user", content: openaiContent || userMessage },
    ],
    max_completion_tokens: maxCompletionTokens,
  };
  if (temperature !== null) kwargs.temperature = temperature;
  if (reasoningEffort !== null) kwargs.reasoning_effort = reasoningEffort;

  // Custom provider extra_body wins over moonshot default
  if (extraBody !== undefined) {
    kwargs.extra_body = extraBody;
  } else if (baseUrl.includes("moonshot")) {
    kwargs.extra_body = { thinking: { type: "disabled" } };
  }

  // Ollama num_ctx auto-derivation
  if (backend === "ollama" && extraBody === undefined) {
    const numCtxRaw = (process.env.GRAPHIFY_OLLAMA_NUM_CTX || "").trim();
    const estimatedInput = Math.floor(userMessage.length / CHARS_PER_TOKEN) + 400;
    const autoNumCtx = Math.min(estimatedInput + maxCompletionTokens + 2000, 131072);
    const autoNumCtx2 = Math.max(autoNumCtx, 8192);

    let numCtx: number;
    if (numCtxRaw) {
      const v = parseInt(numCtxRaw, 10);
      if (isNaN(v)) {
        console.error(
          `[graphify] GRAPHIFY_OLLAMA_NUM_CTX='${numCtxRaw}' is not a valid integer; ` +
            `using auto-derived value (${autoNumCtx2}).`
        );
        numCtx = autoNumCtx2;
      } else {
        numCtx = v;
        if (numCtx < estimatedInput) {
          console.error(
            `[graphify] warning: GRAPHIFY_OLLAMA_NUM_CTX=${numCtx} is smaller than ` +
              `the estimated chunk input (~${estimatedInput} tokens). Ollama will ` +
              `silently truncate the prompt and return empty responses. ` +
              `Try --token-budget ${Math.max(1024, Math.floor(numCtx / 3))} or increase NUM_CTX.`
          );
        }
      }
    } else {
      numCtx = autoNumCtx2;
    }
    const keepAlive = process.env.GRAPHIFY_OLLAMA_KEEP_ALIVE || "30m";
    kwargs.extra_body = { options: { num_ctx: numCtx }, keep_alive: keepAlive };
  }

  const resp = await client.chat.completions.create(kwargs as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming);

  if (!resp.choices || resp.choices[0]?.message === undefined) {
    throw new Error("LLM returned empty or filtered response");
  }

  const rawContent = resp.choices[0].message.content;
  const result = parseLlmJson(rawContent || "{}") as Record<string, unknown>;
  const resultObj = result as unknown as RawExtractionResult;
  resultObj.input_tokens = resp.usage?.prompt_tokens ?? 0;
  resultObj.output_tokens = resp.usage?.completion_tokens ?? 0;
  resultObj.model = model;
  resultObj.finish_reason = resp.choices[0].finish_reason ?? "stop";

  if (responseIsHollow(rawContent, result) && resultObj.finish_reason !== "length") {
    console.error(
      `[graphify] ${backend || "backend"} returned a hollow response ` +
        `(content=${(!rawContent || !rawContent.trim()) ? "empty" : "no nodes/edges"}, ` +
        `output_tokens=${resultObj.output_tokens}); ` +
        `treating as truncation so adaptive retry can bisect the chunk.`
    );
    resultObj.finish_reason = "length";
  }

  if (resultObj.output_tokens < 50 && backend === "ollama") {
    console.error(
      "[graphify] warning: ollama returned very few tokens — likely causes: " +
        "(1) VRAM pressure: check `nvidia-smi` and reduce chunk size with " +
        "--token-budget (e.g. --token-budget 4096) or set " +
        "GRAPHIFY_OLLAMA_NUM_CTX to a smaller value; " +
        "(2) model too small for JSON instruction following — " +
        "try a larger model with --model (e.g. --model qwen2.5-coder:14b)."
    );
  }

  return resultObj;
}
