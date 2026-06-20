// mcpIngest.ts -- Extract MCP (Model Context Protocol) server configuration files.
//
// Reads `.mcp.json` / `claude_desktop_config.json` / `mcp.json` / `mcp_servers.json`
// and turns the `mcpServers` map into Graphify nodes and edges.

import * as fs from "fs";
import * as path from "path";
import { sanitizeLabel } from "./export/obsidian.js";

export const MCP_CONFIG_FILENAMES: Set<string> = new Set([
  ".mcp.json",
  "claude_desktop_config.json",
  "mcp.json",
  "mcp_servers.json",
]);

const _MAX_BYTES = 1_048_576; // 1 MiB -- same cap as extract_json
const _MAX_SERVERS_PER_FILE = 200;

// Patterns observed in real MCP server configs:
//   ["-y", "@modelcontextprotocol/server-filesystem", "/data"]   (npx)
//   ["-y", "@org/pkg@1.2.3"]
//   ["mcp-server-fetch"]                                          (uvx / python)
//   ["mcp-server-time", "--local-timezone=UTC"]
//   ["@scoped/some-mcp"]                                          (pnpx)
const _NPM_PKG_RE = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?:@[\w.\-+]+)?$/;
const _PY_MCP_PKG_RE = /^[a-z0-9][a-z0-9._-]*-mcp(?:-[a-z0-9._-]+)?$|^mcp-[a-z0-9][a-z0-9._-]*$/;
const _ARG_FLAG_RE = /^-{1,2}\w/;

export function isMcpConfigPath(filePath: string): boolean {
  return MCP_CONFIG_FILENAMES.has(path.basename(filePath));
}

export interface McpExtractionResult {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  error?: string;
}

export function extractMcpConfig(filePath: string): McpExtractionResult {
  let raw: Buffer;
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const stat = fs.fstatSync(fd);
      if (stat.size > _MAX_BYTES) {
        return { nodes: [], edges: [], error: "mcp config too large to index" };
      }
      raw = Buffer.alloc(stat.size);
      fs.readSync(fd, raw, 0, stat.size, null);
    } finally {
      fs.closeSync(fd);
    }
  } catch (exc: any) {
    return { nodes: [], edges: [], error: `mcp_ingest read error: ${exc.message || exc}` };
  }

  let text: string;
  try {
    text = raw.toString("utf-8");
    // Detect replacement character which indicates invalid UTF-8
    if (raw.includes(0xefbfbd) && !raw.equals(Buffer.from(text, "utf-8"))) {
      // If the buffer had bytes that became replacement chars, flag it
    }
  } catch (exc: any) {
    return { nodes: [], edges: [], error: `mcp_ingest decode error: ${exc.message || exc}` };
  }

  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch (exc: any) {
    return { nodes: [], edges: [], error: `mcp_ingest json error: ${exc.message || exc}` };
  }

  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { nodes: [], edges: [], error: "mcp_ingest: root is not an object" };
  }

  let servers: any = doc.mcpServers;
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
    // Some tools nest the map (e.g., {"mcp": {"servers": {...}}}). Try one
    // well-known alternate shape but do not search exhaustively.
    const nested = doc.mcp;
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      servers = nested.servers;
    }
    if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
      return { nodes: [], edges: [], error: "mcp_ingest: no mcpServers map" };
    }
  }

  const strPath = filePath;
  const fileNid = makeId(strPath);
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  const seenNodeIds: Set<string> = new Set();
  const seenEdgeKeys: Set<string> = new Set();

  addNode(
    nodes, seenNodeIds,
    fileNid,
    path.basename(filePath),
    "mcp_config_file",
    strPath,
    1,
  );

  const fileStemVal = fileStem(filePath);
  let serverCount = 0;
  for (const [serverName, spec] of Object.entries(servers)) {
    if (typeof serverName !== "string" || !serverName) continue;
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) continue;
    if (serverCount >= _MAX_SERVERS_PER_FILE) break;
    serverCount++;
    emitServer(
      serverName,
      spec as Record<string, unknown>,
      fileNid,
      fileStemVal,
      strPath,
      nodes,
      edges,
      seenNodeIds,
      seenEdgeKeys,
    );
  }

  return { nodes, edges };
}

function emitServer(
  serverName: string,
  spec: Record<string, unknown>,
  fileNid: string,
  fileStemVal: string,
  sourceFile: string,
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[],
  seenNodeIds: Set<string>,
  seenEdgeKeys: Set<string>,
): void {
  const serverNid = makeId(fileStemVal, "mcp_server", serverName);
  addNode(nodes, seenNodeIds, serverNid, serverName, "mcp_server", sourceFile, 1);
  addEdge(edges, seenEdgeKeys, fileNid, serverNid, "contains", sourceFile, 1);

  const command = spec.command;
  if (typeof command === "string" && command.trim()) {
    const cmdLabel = command.trim();
    const cmdNid = makeId("mcp_command", cmdLabel);
    addNode(nodes, seenNodeIds, cmdNid, cmdLabel, "mcp_command", sourceFile, 1);
    addEdge(edges, seenEdgeKeys, serverNid, cmdNid, "references", sourceFile, 1, "command");
  }

  const args = spec.args;
  if (Array.isArray(args)) {
    const pkg = detectPackageFromArgs(args);
    if (pkg) {
      const pkgNid = makeId("mcp_package", pkg);
      addNode(nodes, seenNodeIds, pkgNid, pkg, "mcp_package", sourceFile, 1);
      addEdge(edges, seenEdgeKeys, serverNid, pkgNid, "references", sourceFile, 1, "package");
    }
  }

  const env = spec.env;
  if (typeof env === "object" && env !== null && !Array.isArray(env)) {
    // ONLY KEYS. Values may contain secrets and are never read here.
    for (const envName of Object.keys(env as Record<string, unknown>)) {
      if (typeof envName !== "string" || !envName) continue;
      const envNid = makeId("env_var", envName);
      addNode(nodes, seenNodeIds, envNid, envName, "env_var", sourceFile, 1);
      addEdge(edges, seenEdgeKeys, serverNid, envNid, "requires_env", sourceFile, 1);
    }
  }
}

export function detectPackageFromArgs(args: unknown[]): string | null {
  for (const raw of args) {
    if (typeof raw !== "string") continue;
    const arg = raw.trim();
    if (!arg || _ARG_FLAG_RE.test(arg)) continue;
    if (_NPM_PKG_RE.test(arg)) {
      return stripVersion(arg);
    }
    if (_PY_MCP_PKG_RE.test(arg)) {
      return arg;
    }
  }
  return null;
}

export function stripVersion(pkg: string): string {
  if (pkg.startsWith("@")) {
    const versionAt = pkg.indexOf("@", 1);
    return versionAt === -1 ? pkg : pkg.slice(0, versionAt);
  }
  const versionAt = pkg.indexOf("@");
  return versionAt === -1 ? pkg : pkg.slice(0, versionAt);
}

function addNode(
  nodes: Record<string, unknown>[],
  seen: Set<string>,
  nid: string,
  label: string,
  kind: string,
  sourceFile: string,
  line: number,
): void {
  if (!nid || seen.has(nid)) return;
  seen.add(nid);
  nodes.push({
    id: nid,
    label: sanitizeLabel(label),
    file_type: "code",
    source_file: sourceFile,
    source_location: `L${line}`,
    metadata: { mcp_kind: kind },
  });
}

function addEdge(
  edges: Record<string, unknown>[],
  seen: Set<string>,
  source: string,
  target: string,
  relation: string,
  sourceFile: string,
  line: number,
  context?: string,
): void {
  if (!source || !target || source === target) return;
  const key = `${source}\0${target}\0${relation}`;
  if (seen.has(key)) return;
  seen.add(key);
  const edge: Record<string, unknown> = {
    source,
    target,
    relation,
    confidence: "EXTRACTED",
    confidence_score: 1.0,
    source_file: sourceFile,
    source_location: `L${line}`,
    weight: 1.0,
  };
  if (context) {
    edge.context = context;
  }
  edges.push(edge);
}

export function makeId(...parts: string[]): string {
  const combined = parts
    .filter((p) => p)
    .map((p) => p.replace(/^[_.]+|[_.]+$/g, ""))
    .join("_");
  const nfkc = combined.normalize("NFKC");
  const cleaned = nfkc.replace(/[^\w]+/g, "_").replace(/_+/g, "_");
  return cleaned.replace(/^_+|_+$/g, "").toLowerCase();
}

export function fileStem(filePath: string): string {
  const parsed = path.parse(filePath);
  const parent = path.basename(parsed.dir);
  if (parent && parent !== "." && parent !== "") {
    return `${parent}.${parsed.name}`;
  }
  return parsed.name;
}
