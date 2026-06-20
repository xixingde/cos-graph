/** Maximum bytes we will attempt to JSON.parse from an LLM response.
 *  Caps input so a hostile or runaway model response cannot exhaust memory. */
export const LLM_JSON_MAX_BYTES = 2_000_000;

/** Empty fragment returned on parse failure. */
const EMPTY_FRAGMENT = { nodes: [], edges: [], hyperedges: [] } as const;

/** Strip optional markdown fences and parse JSON. Returns empty fragment on failure.
 *
 *  Two-strategy approach:
 *  1. Strip whitespace, then handle markdown fences anywhere in the text.
 *  2. Extract the first balanced JSON object found anywhere in the text.
 */
export function parseLlmJson(raw: string): Record<string, unknown> {
  if (raw.length > LLM_JSON_MAX_BYTES) {
    console.error(
      `[graphify] LLM response exceeds ${LLM_JSON_MAX_BYTES} bytes ` +
        `(${raw.length} bytes); refusing to parse and dropping chunk.`
    );
    return { ...EMPTY_FRAGMENT };
  }

  // Strategy 1: strip whitespace, then handle markdown fences
  let stripped = raw.trim();
  const fenceStart = stripped.indexOf("```");
  if (fenceStart !== -1) {
    let afterFence = stripped.substring(fenceStart + 3);
    const nl = afterFence.indexOf("\n");
    const tag = nl !== -1 ? afterFence.substring(0, nl).trim().toLowerCase() : "";
    if (nl !== -1 && (tag === "json" || tag === "javascript" || tag === "js" || tag === "")) {
      afterFence = afterFence.substring(nl + 1);
    }
    const fenceEnd = afterFence.lastIndexOf("```");
    if (fenceEnd !== -1) {
      stripped = afterFence.substring(0, fenceEnd).trim();
    } else {
      stripped = afterFence.trim();
    }
  }

  try {
    const parsed = JSON.parse(stripped);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to strategy 2
  }

  // Strategy 2: extract the first balanced JSON object
  const start = stripped.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < stripped.length; i++) {
      const ch = stripped[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(stripped.substring(start, i + 1));
            if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
            break;
          } catch {
            break;
          }
        }
      }
    }
  }

  console.error(
    `[graphify] LLM returned invalid JSON, skipping chunk ` +
      `(first 200 chars: ${JSON.stringify(raw.substring(0, 200))})`
  );
  return { ...EMPTY_FRAGMENT };
}

/** Detect a successful HTTP response that yielded no usable extraction.
 *  A local model under load (most often Ollama) can return HTTP 200 with an
 *  empty / null message content, whitespace, or a half-generated JSON prefix.
 *  All collapse to zero nodes and zero edges. */
export function responseIsHollow(
  rawContent: string | null | undefined,
  parsed: Record<string, unknown>
): boolean {
  if (!rawContent || !rawContent.trim()) return true;
  const n = Array.isArray(parsed.nodes) ? parsed.nodes : (parsed.nodes ? [parsed.nodes] : []);
  const e = Array.isArray(parsed.edges) ? parsed.edges : (parsed.edges ? [parsed.edges] : []);
  const h = Array.isArray(parsed.hyperedges) ? parsed.hyperedges : (parsed.hyperedges ? [parsed.hyperedges] : []);
  return n.length === 0 && e.length === 0 && h.length === 0;
}
