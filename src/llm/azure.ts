import { AzureOpenAI } from "openai";
import type { RawExtractionResult } from "../types/llm.js";
import { resolveApiTimeout } from "./backends.js";
import { parseLlmJson, responseIsHollow } from "./parser.js";

/** Construct an AzureOpenAI client with env-driven api_version and timeout. */
export function azureClient(apiKey: string, endpoint: string): AzureOpenAI {
  const apiVersion =
    (process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview").trim();
  return new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion,
    timeout: resolveApiTimeout() * 1000,
  });
}

/** Call Azure OpenAI Service via the AzureOpenAI SDK client. */
export async function callAzure(
  apiKey: string,
  endpoint: string,
  model: string,
  userMessage: string,
  temperature: number | null = 0,
  maxTokens = 8192,
  opts: { deepMode?: boolean; extractionSystem?: string } = {}
): Promise<RawExtractionResult> {
  const { deepMode = false, extractionSystem } = opts;
  const client = azureClient(apiKey, endpoint);

  const kwargs: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: extractionSystem || "" },
      { role: "user", content: userMessage },
    ],
    max_completion_tokens: maxTokens,
  };
  if (temperature !== null) kwargs.temperature = temperature;

  const resp = await client.chat.completions.create(
    kwargs as unknown as Parameters<typeof client.chat.completions.create>[0]
  );

  // Narrow to non-streaming response
  const chatResp = resp as unknown as { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };

  if (!chatResp.choices || chatResp.choices[0]?.message === undefined) {
    throw new Error("Azure OpenAI returned empty or filtered response");
  }

  const rawContent = chatResp.choices[0].message.content;
  const result = parseLlmJson(rawContent || "{}") as Record<string, unknown>;
  const resultObj = result as unknown as RawExtractionResult;
  resultObj.input_tokens = chatResp.usage?.prompt_tokens ?? 0;
  resultObj.output_tokens = chatResp.usage?.completion_tokens ?? 0;
  resultObj.model = model;
  resultObj.finish_reason = chatResp.choices[0].finish_reason ?? "stop";

  if (responseIsHollow(rawContent, result) && resultObj.finish_reason !== "length") {
    console.error(
      "[graphify] azure returned a hollow response; treating as " +
        "truncation so adaptive retry can bisect the chunk."
    );
    resultObj.finish_reason = "length";
  }
  return resultObj;
}
