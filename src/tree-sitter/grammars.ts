import { Language } from "web-tree-sitter";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the directory of this module in a way that works under both ESM
// (import.meta.url is a valid file:// URL) and CommonJS (import.meta.url is
// unavailable, but tsup injects the native __dirname). Falling back avoids a
// top-level "Invalid URL" crash when the CJS bundle is require()'d.
const _moduleDir: string = (() => {
  try {
    return fileURLToPath(new URL(".", import.meta.url));
  } catch {
    // CommonJS bundle: import.meta.url is empty/undefined, fall back to the
    // native __dirname that tsup injects, or process.cwd() as last resort.
    const native = (globalThis as any).__dirname;
    return typeof native === "string" ? native : process.cwd();
  }
})();

const GRAMMAR_WASM_MAP: Readonly<Record<string, string>> = {
  python: "tree-sitter-python.wasm",
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  java: "tree-sitter-java.wasm",
  groovy: "tree-sitter-groovy.wasm",
  c: "tree-sitter-c.wasm",
  cpp: "tree-sitter-cpp.wasm",
  ruby: "tree-sitter-ruby.wasm",
  c_sharp: "tree-sitter-c-sharp.wasm",
  kotlin: "tree-sitter-kotlin.wasm",
  scala: "tree-sitter-scala.wasm",
  swift: "tree-sitter-swift.wasm",
  elixir: "tree-sitter-elixir.wasm",
  php: "tree-sitter-php.wasm",
  lua: "tree-sitter-lua.wasm",
  dart: "tree-sitter-dart.wasm",
  bash: "tree-sitter-bash.wasm",
  julia: "tree-sitter-julia.wasm",
  zig: "tree-sitter-zig.wasm",
};

const cachedLanguages = new Map<string, Language>();

function resolveWasmPath(wasmFile: string): string {
  const grammarsDir = resolvePath(_moduleDir, "..", "grammars");
  return resolvePath(grammarsDir, wasmFile);
}

export async function loadGrammar(name: string): Promise<Language> {
  const cached = cachedLanguages.get(name);
  if (cached) {
    return cached;
  }

  const wasmFile = GRAMMAR_WASM_MAP[name];
  if (!wasmFile) {
    throw new Error(`Unknown grammar: "${name}"`);
  }

  const wasmPath = resolveWasmPath(wasmFile);
  const language = await Language.load(wasmPath);
  cachedLanguages.set(name, language);
  return language;
}

export function getSupportedLanguages(): readonly string[] {
  return Object.keys(GRAMMAR_WASM_MAP);
}

export { GRAMMAR_WASM_MAP };
