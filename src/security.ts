// Security helpers -- URL validation, safe fetch, path guards, label sanitisation

import * as dns from "dns";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { URL } from "url";

import { sanitizeLabel } from "./export/obsidian.js";
export { sanitizeLabel };

import { sanitizeMetadata } from "./symbolResolution.js";
export { sanitizeMetadata };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_SCHEMES: Set<string> = new Set(["http", "https"]);
const _MAX_FETCH_BYTES = 52_428_800; // 50 MB hard cap for binary downloads
const _MAX_TEXT_BYTES = 10_485_760;   // 10 MB hard cap for HTML / text
const _MAX_GRAPH_FILE_BYTES = 512 * 1024 * 1024; // 512 MiB

const BLOCKED_HOSTS: Set<string> = new Set([
  "metadata.google.internal",
  "metadata.google.com",
]);

const _CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/g;
const _MAX_LABEL_LEN = 256;

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

class FileNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// IP blocking -- SSRF protection
// ---------------------------------------------------------------------------

function isIPv4Private(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;
  // 127.x.x.x -- loopback
  if (parts[0] === 127) return true;
  // 10.x.x.x/8 -- private
  if (parts[0] === 10) return true;
  // 172.16.x.x/12 -- private (172.16.0.0 -- 172.31.255.255)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.x.x/16 -- private
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.x.x/16 -- link-local
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 100.64.x.x/10 -- CGN (RFC 6598)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  // 0.x.x.x -- reserved
  if (parts[0] === 0) return true;
  return false;
}

function isIPv6Blocked(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // ::1 -- loopback
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1" || normalized === "0000:0000:0000:0000:0000:0000:0000:0001") return true;
  // fc00::/7 -- private (fc00: and fd00: prefixes)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  // fe80::/10 -- link-local
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  // :: -- unspecified
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0" || normalized === "0000:0000:0000:0000:0000:0000:0000:0000") return true;
  return false;
}

export function ipIsBlocked(ip: string): boolean {
  if (ip.includes(":")) {
    return isIPv6Blocked(ip);
  }
  return isIPv4Private(ip);
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

export function validateUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValueError(`Invalid URL: ${url}`);
  }

  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (!ALLOWED_SCHEMES.has(scheme)) {
    throw new ValueError(
      `Blocked URL scheme '${scheme}' - only http and https are allowed. Got: ${url}`,
    );
  }

  const hostname = parsed.hostname;
  if (hostname) {
    // Block known cloud metadata hostnames
    if (BLOCKED_HOSTS.has(hostname.toLowerCase())) {
      throw new ValueError(
        `Blocked cloud metadata endpoint '${hostname}'. Got: ${url}`,
      );
    }

    // For IP-literal hostnames, check directly
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) {
      if (ipIsBlocked(hostname)) {
        throw new ValueError(
          `Blocked private/internal IP ${hostname} (resolved from '${hostname}'). Got: ${url}`,
        );
      }
    }
    // DNS hostnames will be checked at fetch time by resolveAndValidate
  }

  return url;
}

// ---------------------------------------------------------------------------
// SSRF-guarded DNS resolution
// ---------------------------------------------------------------------------

async function resolveAndValidate(host: string, port: number): Promise<string> {
  const addresses = await dns.promises.resolve4(host).catch(() => [] as string[]);
  const v6Addresses = await dns.promises.resolve6(host).catch(() => [] as string[]);
  const all = [...addresses, ...v6Addresses];

  if (all.length === 0) {
    // Try lookup as fallback
    try {
      const result = await dns.promises.lookup(host, { family: 0 });
      all.push(result.address);
    } catch {
      throw new Error(`SSRF blocked: no usable address resolved from '${host}'`);
    }
  }

  for (const addr of all) {
    if (ipIsBlocked(addr)) {
      throw new Error(`SSRF blocked: IP ${addr} resolved from '${host}' is private/reserved`);
    }
    return addr;
  }

  throw new Error(`SSRF blocked: no usable address resolved from '${host}'`);
}

// ---------------------------------------------------------------------------
// Safe fetch
// ---------------------------------------------------------------------------

export async function safeFetch(
  url: string,
  maxBytes: number = _MAX_FETCH_BYTES,
  timeout: number = 30000,
): Promise<Buffer> {
  validateUrl(url);

  const parsed = new URL(url);
  const defaultPort = parsed.protocol === "https:" ? 443 : 80;
  const connectPort = parseInt(parsed.port) || defaultPort;
  const validatedIp = await resolveAndValidate(parsed.hostname, connectPort);

  return new Promise<Buffer>((resolve, reject) => {
    const lib = parsed.protocol === "https:" ? https : http;

    const options: https.RequestOptions = {
      hostname: validatedIp,
      port: connectPort,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 graphify/1.0",
        Host: parsed.hostname + (parsed.port ? `:${parsed.port}` : ""),
      },
      timeout,
    };

    const req = lib.request(options, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;

      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          req.destroy();
          reject(new Error(
            `Response from '${url}' exceeds size limit (${Math.floor(maxBytes / 1_048_576)} MB). Aborting download.`,
          ));
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      res.on("error", reject);
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request to '${url}' timed out after ${timeout}ms`));
    });

    req.end();
  });
}

export async function safeFetchText(
  url: string,
  maxBytes: number = _MAX_TEXT_BYTES,
  timeout: number = 15000,
): Promise<string> {
  const raw = await safeFetch(url, maxBytes, timeout);
  return raw.toString("utf-8");
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

export function validateGraphPath(filePath: string, base?: string): string {
  if (!base) {
    const resolvedHint = path.resolve(filePath);
    for (let candidate = resolvedHint; candidate !== path.dirname(candidate); candidate = path.dirname(candidate)) {
      if (path.basename(candidate) === "graphify-out") {
        base = candidate;
        break;
      }
    }
    if (!base) {
      base = path.resolve("graphify-out");
    }
  }

  const resolvedBase = path.resolve(base);
  if (!fs.existsSync(resolvedBase)) {
    throw new ValueError(
      `Graph base directory does not exist: ${resolvedBase}. Run /graphify first to build the graph.`,
    );
  }

  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new ValueError(
      `Path '${filePath}' escapes the allowed directory ${resolvedBase}. Only paths inside graphify-out/ are permitted.`,
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new FileNotFoundError(`Graph file not found: ${resolved}`);
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Graph file size cap
// ---------------------------------------------------------------------------

export function maxGraphFileBytes(): number {
  const raw = (process.env.GRAPHIFY_MAX_GRAPH_BYTES || "").trim();
  if (!raw) return _MAX_GRAPH_FILE_BYTES;
  let text = raw.toUpperCase();
  let multiplier = 1;
  if (text.endsWith("GB")) {
    multiplier = 1024 * 1024 * 1024;
    text = text.slice(0, -2).trim();
  } else if (text.endsWith("MB")) {
    multiplier = 1024 * 1024;
    text = text.slice(0, -2).trim();
  }
  const value = parseInt(text, 10);
  if (isNaN(value) || value <= 0) return _MAX_GRAPH_FILE_BYTES;
  return value * multiplier;
}

export function checkGraphFileSizeCap(filePath: string): void {
  const cap = maxGraphFileBytes();
  try {
    const size = fs.statSync(filePath).size;
    if (size > cap) {
      throw new ValueError(
        `graph file ${filePath} is ${size} bytes, exceeds ${cap}-byte cap\n(set GRAPHIFY_MAX_GRAPH_BYTES=<bytes> or GRAPHIFY_MAX_GRAPH_BYTES=<N>GB to raise the limit)`,
      );
    }
  } catch (exc: any) {
    if (exc instanceof ValueError) throw exc;
    // stat failure -- caller's own existence/path check is expected to surface
  }
}
