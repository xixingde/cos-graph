import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmSync, rmdirSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { platformSkillDestination, PLATFORM_CONFIG } from "../platform-config.js";
import { removeSkillFile } from "../skill-files.js";
import { loadJsonLike } from "../utils.js";

const KILO_PLUGIN_JS = [
  "// graphify Kilo plugin",
  "// Injects a knowledge graph reminder before bash tool calls when the graph exists.",
  'import { existsSync } from "fs";',
  'import { join } from "path";',
  "",
  "export const GraphifyPlugin = async ({ directory }) => {",
  "  let reminded = false;",
  "",
  "  return {",
  '    "tool.execute.before": async (input, output) => {',
  "      if (reminded) return;",
  '      if (!existsSync(join(directory, "graphify-out", "graph.json"))) return;',
  "",
  '      if (input.tool === "bash") {',
  "        output.args.command =",
  '          \'echo "[graphify] Knowledge graph available. Read graphify-out/GRAPH_REPORT.md for god nodes and architecture context before searching files." && \' +',
  "          output.args.command;",
  "        reminded = true;",
  "      }",
  "    },",
  "  };",
  "};",
].join("\n");

const KILO_PLUGIN_PATH = join(".kilo", "plugins", "graphify.js");
const KILO_CONFIG_JSON_PATH = join(".kilo", "kilo.json");
const KILO_CONFIG_JSONC_PATH = join(".kilo", "kilo.jsonc");

function kiloConfigPath(projectDir: string): string {
  const kiloDir = join(projectDir, ".kilo");
  const jsonPath = join(kiloDir, "kilo.json");
  if (existsSync(jsonPath)) return jsonPath;
  const jsoncPath = join(kiloDir, "kilo.jsonc");
  if (existsSync(jsoncPath)) return jsoncPath;
  return jsonPath;
}

function kiloConfigWritePath(projectDir: string): string {
  return join(projectDir, ".kilo", "kilo.json");
}

export function installKiloPlugin(projectDir: string): void {
  const pluginFile = join(projectDir, KILO_PLUGIN_PATH);
  mkdirSync(dirname(pluginFile), { recursive: true });
  writeFileSync(pluginFile, KILO_PLUGIN_JS, "utf-8");
  console.log(`  ${KILO_PLUGIN_PATH}  ->  tool.execute.before hook written`);

  const configFile = kiloConfigPath(projectDir);
  const writeConfigFile = kiloConfigWritePath(projectDir);
  mkdirSync(dirname(writeConfigFile), { recursive: true });
  const config = loadJsonLike(configFile);
  let plugins: unknown[] = (config as Record<string, unknown>)["plugin"] as unknown[];
  if (!Array.isArray(plugins)) {
    plugins = [];
    (config as Record<string, unknown>)["plugin"] = plugins;
  }
  const entry = `file://${resolve(pluginFile)}`;
  if (!plugins.includes(entry)) {
    plugins.push(entry);
    writeFileSync(writeConfigFile, JSON.stringify(config, null, 2), "utf-8");
    console.log(`  ${relative(projectDir, writeConfigFile)}  ->  plugin registered`);
  } else {
    console.log(
      `  ${relative(projectDir, configFile)}  ->  plugin already registered (no change)`
    );
  }
}

export function uninstallKiloPlugin(projectDir: string): void {
  const pluginFile = join(projectDir, KILO_PLUGIN_PATH);
  if (existsSync(pluginFile)) {
    unlinkSync(pluginFile);
    console.log(`  ${KILO_PLUGIN_PATH}  ->  removed`);
  }

  const configFile = kiloConfigPath(projectDir);
  if (!existsSync(configFile)) return;
  const writeConfigFile = kiloConfigWritePath(projectDir);
  const config = loadJsonLike(configFile);
  let plugins: unknown[] = (config as Record<string, unknown>)["plugin"] as unknown[];
  if (!Array.isArray(plugins)) plugins = [];
  const entry = `file://${resolve(pluginFile).replace(/\\/g, "/")}`;
  if (plugins.includes(entry)) {
    (config as Record<string, unknown>)["plugin"] = plugins.filter((p) => p !== entry);
    if (!((config as Record<string, unknown>)["plugin"] as unknown[]).length) {
      delete (config as Record<string, unknown>)["plugin"];
    }
    mkdirSync(dirname(writeConfigFile), { recursive: true });
    writeFileSync(writeConfigFile, JSON.stringify(config, null, 2), "utf-8");
    console.log(`  ${relative(projectDir, writeConfigFile)}  ->  plugin deregistered`);
  }
}

export function kiloUninstallGlobal(): string[] {
  const removed: string[] = [];
  const commandDst = join(homedir(), ".config", "kilo", "command", "graphify.md");
  if (existsSync(commandDst)) {
    unlinkSync(commandDst);
    removed.push(`command removed: ${commandDst}`);
  }
  try { rmdirSync(dirname(commandDst)); } catch {}

  const skillDst = join(homedir(), PLATFORM_CONFIG["kilo"].skillDst);
  if (existsSync(skillDst)) {
    unlinkSync(skillDst);
    removed.push(`skill removed: ${skillDst}`);
  }
  const versionFile = join(dirname(skillDst), ".graphify_version");
  if (existsSync(versionFile)) {
    unlinkSync(versionFile);
  }
  let dir: string | null = dirname(skillDst);
  for (let i = 0; i < 3 && dir; i++) {
    try { rmdirSync(dir); } catch { break; }
    dir = dirname(dir);
  }

  return removed;
}

export function kiloInstall(projectDir: string, installFn: (platform: string) => void): void {
  installFn("kilo");
}

export function kiloUninstall(projectDir: string, agentsUninstallFn?: (pd: string, platform: string) => void): void {
  if (agentsUninstallFn) agentsUninstallFn(projectDir, "kilo");
  const removed = kiloUninstallGlobal();
  console.log(removed.length > 0 ? removed.join("; ") : "nothing to remove");
}
