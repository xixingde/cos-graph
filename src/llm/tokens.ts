import { encodingForModel } from "js-tiktoken";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** `_readFiles` truncates each file at this many characters before joining
 *  into the user message. Token estimates use the same cap so packing matches
 *  reality. */
export const FILE_CHAR_CAP = 20_000;

/** Per-file overhead in characters that the `<untrusted_source>` wrapper
 *  adds (open tag + 64-char sha + close tag + newlines). */
export const PER_FILE_OVERHEAD_CHARS = 160;

/** Coarse fallback when tiktoken is unavailable. 1 token ≈ 4 chars. */
export const CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

let _tokenizer: ReturnType<typeof encodingForModel> | null = null;
let _tokenizerInit = false;

function getTokenizer(): ReturnType<typeof encodingForModel> | null {
  if (!_tokenizerInit) {
    _tokenizerInit = true;
    try {
      _tokenizer = encodingForModel("gpt-4");
    } catch {
      _tokenizer = null;
    }
  }
  return _tokenizer;
}

export { _tokenizer, getTokenizer };

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Count tokens in `text` using cl100k_base (GPT-4 proxy encoding).
 *  Falls back to `text.length / CHARS_PER_TOKEN` if the tokenizer is
 *  unavailable. */
export function countTokens(text: string): number {
  const tok = getTokenizer();
  if (tok) {
    return tok.encode(text).length;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimate the prompt-token cost of a file or slice under `_readFiles` rules.
 *  Files larger than `FILE_CHAR_CAP` are truncated; images are counted
 *  approximately (low-detail = 85 tokens). */
export function estimateFileTokens(
  unit:
    | { type: "file"; path: string; charCount?: number }
    | { type: "slice"; path: string; charCount: number }
): number {
  let chars: number;
  if ("charCount" in unit && unit.charCount !== undefined) {
    chars = Math.min(unit.charCount, FILE_CHAR_CAP);
  } else {
    // For unsized files, approximate from path extension
    const p = unit.path.toLowerCase();
    if (/\.(png|jpg|jpeg|gif|bmp|svg|webp|ico|avif)$/i.test(p)) {
      return 85; // low-detail image token estimate
    }
    chars = FILE_CHAR_CAP; // worst-case for unknown size
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}
