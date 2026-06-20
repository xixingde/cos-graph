import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { ImageRef, RawExtractionResult } from "../types/llm.js";
import { bedrockInferenceConfig } from "./backends.js";
import { parseLlmJson, responseIsHollow } from "./parser.js";

/** Build Bedrock Converse user content list (raw bytes, not base64). */
export function bedrockContent(
  userMessage: string,
  refs: ImageRef[]
): Array<{ text: string } | { image: { format: string; source: { bytes: Buffer } } }> {
  const content: Array<{ text: string } | { image: { format: string; source: { bytes: Buffer } } }> = [
    { text: userMessage },
  ];
  for (const r of refs) {
    if (!r.raw) continue;
    content.push({
      image: {
        format: r.mediaType.split("/")[1] || "png",
        source: { bytes: r.raw },
      },
    });
  }
  return content;
}

/** Call AWS Bedrock via the Converse API using the standard AWS credential chain. */
export async function callBedrock(
  model: string,
  userMessage: string,
  maxTokens = 8192,
  opts: { deepMode?: boolean; images?: ImageRef[]; extractionSystem?: string } = {}
): Promise<RawExtractionResult> {
  const { deepMode = false, images, extractionSystem } = opts;

  const region =
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1";

  const client = new BedrockRuntimeClient({ region });

  const inferenceConfig = bedrockInferenceConfig(maxTokens, model);

  const command = new ConverseCommand({
    modelId: model,
    system: [{ text: extractionSystem || "" }],
    messages: [
      {
        role: "user" as const,
        content: bedrockContent(userMessage, images || []) as any,
      },
    ],
    inferenceConfig,
  });

  const resp = await client.send(command);

  const text =
    resp.output?.message?.content?.[0]?.text || "{}";
  const result = parseLlmJson(text) as Record<string, unknown>;
  const resultObj = result as unknown as RawExtractionResult;
  const usage = resp.usage || { inputTokens: 0, outputTokens: 0 };
  resultObj.input_tokens = usage.inputTokens ?? 0;
  resultObj.output_tokens = usage.outputTokens ?? 0;
  resultObj.model = model;
  resultObj.finish_reason = resp.stopReason === "max_tokens" ? "length" : "stop";

  if (responseIsHollow(text, result) && resultObj.finish_reason !== "length") {
    console.error(
      "[graphify] bedrock returned a hollow response; treating as " +
        "truncation so adaptive retry can bisect the chunk."
    );
    resultObj.finish_reason = "length";
  }
  return resultObj;
}
