import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";

const OPENCODE_PLUGIN_JS = [
  "// graphify OpenCode plugin",
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
  '          \'echo "[graphify] knowledge graph at graphify-out/. For focused questions, run \\`graphify query \\"<question>\\"\\` (scoped subgraph, usually much smaller than GRAPH_REPORT.md) instead of grepping raw files. Read GRAPH_REPORT.md only for broad architecture context." && \' +',
  "          output.args.command;",
  "        reminded = true;",
  "      }",
  "    },",
  "  };",
  "};",
].join("\n");

const OPENCODE_PLUGIN_PATH = join(".opencode", "plugins", "graphify.js");
const OPENCODE_CONFIG_PATH = join(".opencode", "opencode.json");

export function installOpencodePlugin(projectDir: string): void {
  const pluginFile = join(projectDir, OPENCODE_PLUGIN_PATH);
  mkdirSync(dirname(pluginFile), { recursive: true });
  writeFileSync(pluginFile, OPENCODE_PLUGIN_JS, "utf-8");
  console.log(`  ${OPENCODE_PLUGIN_PATH}  ->  tool.execute.before hook written`);

  const configFile = join(projectDir, OPENCODE_CONFIG_PATH);
  let config: Record<string, unknown> = {};
  if (existsSync(configFile)) {
    try {
      config = JSON.parse(readFileSync(configFile, "utf-8"));
    } catch {
      config = {};
    }
  }

  const plugins = ((config as Record<string, unknown>)["plugin"] as unknown[]) ?? [];
  (config as Record<string, unknown>)["plugin"] = plugins;
  const entry = OPENCODE_PLUGIN_PATH.replace(/\\/g, "/");
  if (!plugins.includes(entry)) {
    (plugins as unknown[]).push(entry);
    writeFileSync(configFile, JSON.stringify(config, null, 2), "utf-8");
    console.log(`  ${OPENCODE_CONFIG_PATH}  ->  plugin registered`);
  } else {
    console.log(`  ${OPENCODE_CONFIG_PATH}  ->  plugin already registered (no change)`);
  }
}

export function uninstallOpencodePlugin(projectDir: string): void {
  const pluginFile = join(projectDir, OPENCODE_PLUGIN_PATH);
  if (existsSync(pluginFile)) {
    unlinkSync(pluginFile);
    console.log(`  ${OPENCODE_PLUGIN_PATH}  ->  removed`);
  }

  const configFile = join(projectDir, OPENCODE_CONFIG_PATH);
  if (!existsSync(configFile)) return;
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configFile, "utf-8"));
  } catch {
    return;
  }
  const plugins = ((config as Record<string, unknown>)["plugin"] ?? []) as unknown[];
  const entry = OPENCODE_PLUGIN_PATH.replace(/\\/g, "/");
  if (plugins.includes(entry)) {
    const filtered = plugins.filter((p) => p !== entry);
    if (!filtered.length) {
      delete (config as Record<string, unknown>)["plugin"];
    } else {
      (config as Record<string, unknown>)["plugin"] = filtered;
    }
    writeFileSync(configFile, JSON.stringify(config, null, 2), "utf-8");
    console.log(`  ${OPENCODE_CONFIG_PATH}  ->  plugin deregistered`);
  }
}
