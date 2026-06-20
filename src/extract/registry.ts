import * as path from "path";
import type { ExtractionResult } from "../types/extraction.js";

// ---------------------------------------------------------------------------
// Extractor function type
// ---------------------------------------------------------------------------

/** Signature for a per-file extractor function. */
export type ExtractorFn = (filePath: string) => ExtractionResult;

// ---------------------------------------------------------------------------
// Dispatch registry
// ---------------------------------------------------------------------------

/** Extension → extractor function mapping (mirrors Python _DISPATCH). */
export const DISPATCH: Map<string, ExtractorFn> = new Map();

// Placeholder extractor — concrete implementations in per-language files.
const PLACEHOLDER_EXTRACTOR: ExtractorFn = (_filePath: string): ExtractionResult => ({
  nodes: [],
  edges: [],
  languages: {},
});

// All extensions from Python _DISPATCH — concrete extractors registered later.
const REGISTERED_EXTENSIONS: string[] = [
  ".py", ".js", ".jsx", ".mjs", ".ts", ".tsx",
  ".go", ".rs", ".java", ".groovy", ".gradle",
  ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp",
  ".rb", ".cs", ".kt", ".kts", ".scala", ".php",
  ".swift", ".lua", ".luau", ".toc", ".zig",
  ".ps1", ".psm1", ".psd1",
  ".ex", ".exs",
  ".m", ".mm",
  ".jl",
  ".f", ".F", ".f90", ".F90", ".f95", ".F95", ".f03", ".F03", ".f08", ".F08",
  ".vue", ".svelte", ".astro", ".dart",
  ".v", ".sv", ".svh",
  ".sql",
  ".md", ".mdx", ".qmd",
  ".pas", ".pp", ".dpr", ".dpk", ".lpr", ".inc",
  ".dfm", ".lfm", ".lpk",
  ".sh", ".bash",
  ".json",
  ".tf", ".tfvars", ".hcl",
  ".dm", ".dme", ".dmi", ".dmm", ".dmf",
  ".sln", ".slnx", ".csproj", ".fsproj", ".vbproj",
  ".razor", ".cshtml",
  ".cls", ".trigger",
];

// Register all extensions with placeholder extractors
for (const ext of REGISTERED_EXTENSIONS) {
  DISPATCH.set(ext, PLACEHOLDER_EXTRACTOR);
}

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

/** Register (or override) an extractor for a file extension. */
export function registerExtractor(extension: string, extractor: ExtractorFn): void {
  DISPATCH.set(extension, extractor);
}

/** Return the extractor function for a file path, or null if unsupported.
 * Handles special cases like .blade.php and MCP config paths. */
export function getExtractor(filePath: string): ExtractorFn | null {
  const basename = path.basename(filePath);

  // Blade PHP templates get a dedicated extractor
  if (basename.endsWith(".blade.php")) {
    // TODO: register extract_blade when implemented
    return DISPATCH.get(".php") ?? null;
  }

  // TODO: MCP config routing (is_mcp_config_path) when MCP module is migrated

  const ext = path.extname(filePath);
  return DISPATCH.get(ext) ?? null;
}

/** Return the set of all registered file extensions. */
export function getRegisteredExtensions(): Set<string> {
  return new Set(DISPATCH.keys());
}
