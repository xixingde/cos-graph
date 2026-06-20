/** Adaptive retry logic for extraction.
 *
 * The Python version has sophisticated retry with backoff for LLM extraction
 * paths. AST extraction is deterministic and doesn't need retries — this
 * module simplifies to a direct call for now. The retry scaffolding is kept
 * so the interface matches the Python version for future LLM paths. */

import type { ExtractionResult } from "../types/extraction.js";
import type { ExtractorFn } from "./registry.js";

export interface AdaptiveRetryOptions {
  maxRetries?: number;
}

/** Extract a single file with adaptive retry.
 *
 * Currently a thin wrapper — retries are only relevant for LLM extraction
 * which is not yet migrated. AST extraction is deterministic and won't
 * benefit from retries. */
export function extractWithAdaptiveRetry(
  extractor: ExtractorFn,
  filePath: string,
  _options?: AdaptiveRetryOptions,
): ExtractionResult {
  // TODO: implement retry with exponential backoff for LLM paths
  return extractor(filePath);
}
