import Anthropic from "@anthropic-ai/sdk";
import type { ImageRef, RawExtractionResult } from "../types/llm.js";
import { BACKENDS, resolveApiTimeout } from "./backends.js";
import { parseLlmJson, responseIsHollow } from "./parser.js";

/** Build the Anthropic `messages[].content` value (str, or block list with images). */
export function anthropicContent(
  userMessage: string,
  refs: ImageRef[]
): string | Anthropic.ContentBlockParam[] {
  if (!refs.length) return userMessage;
  const blocks: Anthropic.ContentBlockParam[] = [
    { type: "text", text: userMessage },
  ];
  for (const r of refs) {
    if (!r.raw) continue;
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: r.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data: r.raw.toString("base64"),
      },
    });
  }
  return blocks;
}

/** Call Anthropic Claude directly (not via OpenAI compat layer). */
export async function callClaude(
  apiKey: string,
  model: string,
  userMessage: string,
  maxTokens = 8192,
  opts: { deepMode?: boolean; images?: ImageRef[]; extractionSystem?: string } = {}
): Promise<RawExtractionResult> {
  const { deepMode = false, images, extractionSystem } = opts;

  const client = new Anthropic({
    apiKey,
    baseURL: BACKENDS["claude"].base_url,
    timeout: resolveApiTimeout() * 1000,
  });

  const resp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: extractionSystem || "",
    messages: [
      {
        role: "user",
        content: anthropicContent(userMessage, images || []),
      },
    ],
  });

  const rawContent = resp.content[0]?.type === "text" ? resp.content[0].text : null;
  const result = parseLlmJson(rawContent || "{}") as Record<string, unknown>;
  const resultObj = result as unknown as RawExtractionResult;
  resultObj.input_tokens = resp.usage?.input_tokens ?? 0;
  resultObj.output_tokens = resp.usage?.output_tokens ?? 0;
  resultObj.model = model;
  resultObj.finish_reason = resp.stop_reason === "max_tokens" ? "length" : "stop";

  if (responseIsHollow(rawContent, result) && resultObj.finish_reason !== "length") {
    console.error(
      "[graphify] claude returned a hollow response; treating as " +
        "truncation so adaptive retry can bisect the chunk."
    );
    resultObj.finish_reason = "length";
  }
  return resultObj;
}
