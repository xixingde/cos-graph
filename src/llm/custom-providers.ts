import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BackendDef } from "../types/llm.js";
import { BACKENDS, customProvidersPath, providerBaseUrlOk } from "./backends.js";

/** Load custom providers from providers.json files.
 *  Re-exports the logic from backends.ts for consumers that want the
 *  loader as a standalone import. */
export function loadCustomProviders(): Record<string, BackendDef> {
  const localPath = customProvidersPath(false);
  const globalPath = customProvidersPath(true);
  const allowLocalVal = (process.env.GRAPHIFY_ALLOW_LOCAL_PROVIDERS || "")
    .trim()
    .toLowerCase();
  const allowLocal =
    allowLocalVal === "1" || allowLocalVal === "true" || allowLocalVal === "yes";

  if (existsSync(localPath) && !allowLocal) {
    console.error(
      `[graphify] WARNING: ignoring project-local ${localPath} (custom providers control ` +
        `where your corpus and API key are sent). Set GRAPHIFY_ALLOW_LOCAL_PROVIDERS=1 to load it.`
    );
  }

  const providers: Record<string, BackendDef> = {};
  const paths = allowLocal ? [localPath, globalPath] : [globalPath];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        for (const [name, cfg] of Object.entries(data as Record<string, unknown>)) {
          if (typeof name !== "string" || typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) continue;
          if (name in BACKENDS || name in providers) continue;
          if (!providerBaseUrlOk(String((cfg as Record<string, unknown>).base_url || ""), name)) continue;
          const def = { ...(cfg as BackendDef) };
          if (!("pricing" in def)) {
            (def as Record<string, unknown>).pricing = { input: 0.0, output: 0.0 };
          }
          providers[name] = def;
        }
      }
    } catch {
      // ignore parse errors
    }
  }
  return providers;
}

export { customProvidersPath, providerBaseUrlOk };
