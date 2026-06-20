// MCP transport layer -- stdio and HTTP.
// Ported from graphify/serve.py lines 1041-1252.

import * as http from "node:http";
import * as crypto from "node:crypto";
import * as process from "node:process";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { buildServer } from "./server.js";

// ── stdio transport ────────────────────────────────────────────────────

export async function serve(graphPath?: string): Promise<void> {
  const resolvedPath = graphPath || process.env.GRAPHIFY_GRAPH || "graphify-out/graph.json";
  const server = buildServer(resolvedPath);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ── HTTP transport ─────────────────────────────────────────────────────

export interface ServeHttpOptions {
  host?: string;
  port?: number;
  apiKey?: string | null;
  path?: string;
  jsonResponse?: boolean;
  stateless?: boolean;
  sessionTimeout?: number | null;
}

export async function serveHttp(graphPath?: string, options?: ServeHttpOptions): Promise<void> {
  const resolvedPath = graphPath || process.env.GRAPHIFY_GRAPH || "graphify-out/graph.json";
  const opts = options || {};
  const host = opts.host || "0.0.0.0";
  const port = opts.port || 8080;
  const basePath = opts.path || "/mcp";
  const apiKey = opts.apiKey ?? process.env.GRAPHIFY_API_KEY ?? null;
  const stateless = opts.stateless ?? false;

  const server = buildServer(resolvedPath);

  // HTTP server with manual request handling for StreamableHTTPServerTransport
  const httpServer = http.createServer(async (req, res) => {
    // API key validation
    if (apiKey) {
      const provided = extractBearer(req) || new URL(req.url || "", `http://${host}`).searchParams.get("key") || "";
      if (!timingSafeEqual(provided, apiKey)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    // Only handle the MCP endpoint path
    const url = new URL(req.url || "/", `http://${host}`);
    if (!url.pathname.startsWith(basePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: stateless ? undefined : undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err: any) {
      console.error("MCP transport error:", err.message || err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });

  httpServer.listen(port, host, () => {
    console.error(`Graphify MCP server listening on http://${host}:${port}${basePath}`);
    if (apiKey) {
      console.error("API key authentication enabled");
    }
  });
}

// ── helpers ───────────────────────────────────────────────────────────

function extractBearer(req: http.IncomingMessage): string {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return "";
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid timing leaks from length check
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
