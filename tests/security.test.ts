import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  validateUrl,
  ipIsBlocked,
  maxGraphFileBytes,
  checkGraphFileSizeCap,
  validateGraphPath,
  sanitizeLabel,
  sanitizeMetadata,
} from "../src/security.js";

// ---------------------------------------------------------------------------
// ipIsBlocked
// ---------------------------------------------------------------------------
describe("ipIsBlocked", () => {
  it("blocks 127.0.0.1 (loopback)", () => {
    expect(ipIsBlocked("127.0.0.1")).toBe(true);
  });
  it("blocks 10.0.0.1 (private class A)", () => {
    expect(ipIsBlocked("10.0.0.1")).toBe(true);
  });
  it("blocks 172.16.0.1 (private class B)", () => {
    expect(ipIsBlocked("172.16.0.1")).toBe(true);
  });
  it("does NOT block 172.15.0.1 (not in private range)", () => {
    expect(ipIsBlocked("172.15.0.1")).toBe(false);
  });
  it("does NOT block 172.32.0.1 (not in private range)", () => {
    expect(ipIsBlocked("172.32.0.1")).toBe(false);
  });
  it("blocks 192.168.1.1 (private class C)", () => {
    expect(ipIsBlocked("192.168.1.1")).toBe(true);
  });
  it("blocks 169.254.1.1 (link-local)", () => {
    expect(ipIsBlocked("169.254.1.1")).toBe(true);
  });
  it("blocks 0.0.0.0 (reserved)", () => {
    expect(ipIsBlocked("0.0.0.0")).toBe(true);
  });
  it("blocks 100.64.0.1 (CGN)", () => {
    expect(ipIsBlocked("100.64.0.1")).toBe(true);
  });
  it("does NOT block 100.63.0.1 (not CGN)", () => {
    expect(ipIsBlocked("100.63.0.1")).toBe(false);
  });
  it("does NOT block 8.8.8.8 (public)", () => {
    expect(ipIsBlocked("8.8.8.8")).toBe(false);
  });
  it("blocks ::1 (IPv6 loopback)", () => {
    expect(ipIsBlocked("::1")).toBe(true);
  });
  it("blocks fc00::1 (IPv6 private)", () => {
    expect(ipIsBlocked("fc00::1")).toBe(true);
  });
  it("blocks fd00::1 (IPv6 private)", () => {
    expect(ipIsBlocked("fd00::1")).toBe(true);
  });
  it("blocks fe80::1 (IPv6 link-local)", () => {
    expect(ipIsBlocked("fe80::1")).toBe(true);
  });
  it("blocks :: (IPv6 unspecified)", () => {
    expect(ipIsBlocked("::")).toBe(true);
  });
  it("does NOT block 2001:db8::1 (public IPv6)", () => {
    expect(ipIsBlocked("2001:db8::1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateUrl
// ---------------------------------------------------------------------------
describe("validateUrl", () => {
  it("accepts http URLs", () => {
    expect(validateUrl("http://example.com")).toBe("http://example.com");
  });
  it("accepts https URLs", () => {
    expect(validateUrl("https://example.com")).toBe("https://example.com");
  });
  it("rejects ftp URLs", () => {
    expect(() => validateUrl("ftp://example.com")).toThrow("Blocked URL scheme");
  });
  it("rejects file URLs", () => {
    expect(() => validateUrl("file:///etc/passwd")).toThrow("Blocked URL scheme");
  });
  it("rejects invalid URLs", () => {
    expect(() => validateUrl("not-a-url")).toThrow("Invalid URL");
  });
  it("rejects cloud metadata hostname", () => {
    expect(() => validateUrl("http://metadata.google.internal")).toThrow(
      "Blocked cloud metadata endpoint",
    );
  });
  it("rejects private IPv4 in hostname", () => {
    expect(() => validateUrl("http://127.0.0.1")).toThrow("Blocked private/internal IP");
  });
  it("rejects private IPv4 192.168.x.x in hostname", () => {
    expect(() => validateUrl("http://192.168.1.1")).toThrow("Blocked private/internal IP");
  });
  it("accepts public IP in hostname", () => {
    expect(validateUrl("http://8.8.8.8")).toBe("http://8.8.8.8");
  });
});

// ---------------------------------------------------------------------------
// maxGraphFileBytes
// ---------------------------------------------------------------------------
describe("maxGraphFileBytes", () => {
  const origEnv = process.env.GRAPHIFY_MAX_GRAPH_BYTES;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.GRAPHIFY_MAX_GRAPH_BYTES = origEnv;
    } else {
      delete process.env.GRAPHIFY_MAX_GRAPH_BYTES;
    }
  });

  it("returns default 512 MiB when env is not set", () => {
    delete process.env.GRAPHIFY_MAX_GRAPH_BYTES;
    expect(maxGraphFileBytes()).toBe(512 * 1024 * 1024);
  });

  it("parses GB suffix", () => {
    process.env.GRAPHIFY_MAX_GRAPH_BYTES = "1GB";
    expect(maxGraphFileBytes()).toBe(1 * 1024 * 1024 * 1024);
  });

  it("parses MB suffix", () => {
    process.env.GRAPHIFY_MAX_GRAPH_BYTES = "256MB";
    expect(maxGraphFileBytes()).toBe(256 * 1024 * 1024);
  });

  it("parses plain number as bytes", () => {
    process.env.GRAPHIFY_MAX_GRAPH_BYTES = "1048576";
    expect(maxGraphFileBytes()).toBe(1048576);
  });

  it("returns default for invalid values", () => {
    process.env.GRAPHIFY_MAX_GRAPH_BYTES = "abc";
    expect(maxGraphFileBytes()).toBe(512 * 1024 * 1024);
  });

  it("returns default for zero or negative", () => {
    process.env.GRAPHIFY_MAX_GRAPH_BYTES = "0";
    expect(maxGraphFileBytes()).toBe(512 * 1024 * 1024);
    process.env.GRAPHIFY_MAX_GRAPH_BYTES = "-100";
    expect(maxGraphFileBytes()).toBe(512 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// checkGraphFileSizeCap
// ---------------------------------------------------------------------------
describe("checkGraphFileSizeCap", () => {
  it("does not throw for files under the cap", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-test-"));
    const tmpFile = path.join(tmpDir, "small.json");
    fs.writeFileSync(tmpFile, "x");
    try {
      expect(() => checkGraphFileSizeCap(tmpFile)).not.toThrow();
    } finally {
      fs.unlinkSync(tmpFile);
      fs.rmdirSync(tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// validateGraphPath
// ---------------------------------------------------------------------------
describe("validateGraphPath", () => {
  it("throws when base directory does not exist", () => {
    expect(() => validateGraphPath("/no/such/path/graph.json", "/no/such/base")).toThrow(
      "Graph base directory does not exist",
    );
  });

  it("throws when path escapes the base", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-test-"));
    try {
      expect(() => validateGraphPath("/etc/passwd", tmpDir)).toThrow("escapes the allowed directory");
    } finally {
      fs.rmdirSync(tmpDir);
    }
  });

  it("throws when file does not exist inside base", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-test-"));
    try {
      expect(() => validateGraphPath(path.join(tmpDir, "missing.json"), tmpDir)).toThrow(
        "Graph file not found",
      );
    } finally {
      fs.rmdirSync(tmpDir);
    }
  });

  it("returns resolved path for valid file inside base", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-test-"));
    const tmpFile = path.join(tmpDir, "graph.json");
    fs.writeFileSync(tmpFile, "{}");
    try {
      const result = validateGraphPath(tmpFile, tmpDir);
      expect(result).toBe(path.resolve(tmpFile));
    } finally {
      fs.unlinkSync(tmpFile);
      fs.rmdirSync(tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// re-exports
// ---------------------------------------------------------------------------
describe("re-exports", () => {
  it("re-exports sanitizeLabel", () => {
    expect(typeof sanitizeLabel).toBe("function");
    expect(sanitizeLabel("hello world")).toBe("hello world");
  });

  it("re-exports sanitizeMetadata", () => {
    expect(typeof sanitizeMetadata).toBe("function");
  });
});
