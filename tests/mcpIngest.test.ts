import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  isMcpConfigPath,
  extractMcpConfig,
  MCP_CONFIG_FILENAMES,
  detectPackageFromArgs,
  stripVersion,
  makeId,
  fileStem,
} from "../src/mcpIngest.js";

// ---------------------------------------------------------------------------
// isMcpConfigPath
// ---------------------------------------------------------------------------
describe("isMcpConfigPath", () => {
  it("returns true for .mcp.json", () => {
    expect(isMcpConfigPath("/project/.mcp.json")).toBe(true);
  });
  it("returns true for claude_desktop_config.json", () => {
    expect(isMcpConfigPath("/home/.claude/claude_desktop_config.json")).toBe(true);
  });
  it("returns true for mcp.json", () => {
    expect(isMcpConfigPath("/project/mcp.json")).toBe(true);
  });
  it("returns true for mcp_servers.json", () => {
    expect(isMcpConfigPath("/project/mcp_servers.json")).toBe(true);
  });
  it("returns false for other files", () => {
    expect(isMcpConfigPath("/project/package.json")).toBe(false);
    expect(isMcpConfigPath("/project/tsconfig.json")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MCP_CONFIG_FILENAMES
// ---------------------------------------------------------------------------
describe("MCP_CONFIG_FILENAMES", () => {
  it("contains the four expected filenames", () => {
    expect(MCP_CONFIG_FILENAMES.has(".mcp.json")).toBe(true);
    expect(MCP_CONFIG_FILENAMES.has("claude_desktop_config.json")).toBe(true);
    expect(MCP_CONFIG_FILENAMES.has("mcp.json")).toBe(true);
    expect(MCP_CONFIG_FILENAMES.has("mcp_servers.json")).toBe(true);
    expect(MCP_CONFIG_FILENAMES.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// extractMcpConfig
// ---------------------------------------------------------------------------
describe("extractMcpConfig", () => {
  const fixturePath = path.resolve(__dirname, "fixtures/sample.mcp.json");

  it("parses sample.mcp.json and returns nodes and edges", () => {
    const result = extractMcpConfig(fixturePath);
    expect(result.error).toBeUndefined();
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it("creates a config file node", () => {
    const result = extractMcpConfig(fixturePath);
    const fileNodes = result.nodes.filter(
      (n: any) => n.metadata?.mcp_kind === "mcp_config_file",
    );
    expect(fileNodes.length).toBe(1);
    expect(fileNodes[0].label).toBe("sample.mcp.json");
  });

  it("creates server nodes for each mcpServers entry", () => {
    const result = extractMcpConfig(fixturePath);
    const serverNodes = result.nodes.filter(
      (n: any) => n.metadata?.mcp_kind === "mcp_server",
    );
    expect(serverNodes.length).toBe(4);
    const names = serverNodes.map((n: any) => n.label);
    expect(names).toContain("filesystem");
    expect(names).toContain("fetch");
    expect(names).toContain("github");
    expect(names).toContain("time");
  });

  it("creates command nodes", () => {
    const result = extractMcpConfig(fixturePath);
    const cmdNodes = result.nodes.filter(
      (n: any) => n.metadata?.mcp_kind === "mcp_command",
    );
    expect(cmdNodes.length).toBeGreaterThan(0);
  });

  it("creates package nodes from args", () => {
    const result = extractMcpConfig(fixturePath);
    const pkgNodes = result.nodes.filter(
      (n: any) => n.metadata?.mcp_kind === "mcp_package",
    );
    expect(pkgNodes.length).toBeGreaterThan(0);
  });

  it("creates env_var nodes when env is present", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
    const tmpFile = path.join(tmpDir, ".mcp.json");
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({
        mcpServers: {
          myserver: {
            command: "npx",
            args: ["-y", "@scope/pkg"],
            env: { API_KEY: "x", SECRET_TOKEN: "y" },
          },
        },
      }),
    );
    try {
      const result = extractMcpConfig(tmpFile);
      const envNodes = result.nodes.filter(
        (n: any) => n.metadata?.mcp_kind === "env_var",
      );
      expect(envNodes.length).toBe(2);
      const labels = envNodes.map((n: any) => n.label);
      expect(labels).toContain("API_KEY");
      expect(labels).toContain("SECRET_TOKEN");
    } finally {
      fs.unlinkSync(tmpFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it("returns error for missing file", () => {
    const result = extractMcpConfig("/nonexistent/path/.mcp.json");
    expect(result.error).toContain("mcp_ingest read error");
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("returns error for invalid JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
    const tmpFile = path.join(tmpDir, ".mcp.json");
    fs.writeFileSync(tmpFile, "{not valid json}");
    try {
      const result = extractMcpConfig(tmpFile);
      expect(result.error).toContain("mcp_ingest json error");
    } finally {
      fs.unlinkSync(tmpFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it("returns error for non-object root", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
    const tmpFile = path.join(tmpDir, ".mcp.json");
    fs.writeFileSync(tmpFile, JSON.stringify([1, 2, 3]));
    try {
      const result = extractMcpConfig(tmpFile);
      expect(result.error).toContain("root is not an object");
    } finally {
      fs.unlinkSync(tmpFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it("returns error when no mcpServers map", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
    const tmpFile = path.join(tmpDir, ".mcp.json");
    fs.writeFileSync(tmpFile, JSON.stringify({ otherKey: "value" }));
    try {
      const result = extractMcpConfig(tmpFile);
      expect(result.error).toContain("no mcpServers map");
    } finally {
      fs.unlinkSync(tmpFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it("handles nested mcp.servers shape", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
    const tmpFile = path.join(tmpDir, ".mcp.json");
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({
        mcp: {
          servers: {
            myserver: { command: "npx", args: ["-y", "@scope/pkg"] },
          },
        },
      }),
    );
    try {
      const result = extractMcpConfig(tmpFile);
      expect(result.error).toBeUndefined();
      const serverNodes = result.nodes.filter(
        (n: any) => n.metadata?.mcp_kind === "mcp_server",
      );
      expect(serverNodes.length).toBe(1);
    } finally {
      fs.unlinkSync(tmpFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it("returns error for too-large file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
    const tmpFile = path.join(tmpDir, ".mcp.json");
    const big = "x".repeat(1_048_577);
    fs.writeFileSync(tmpFile, big);
    try {
      const result = extractMcpConfig(tmpFile);
      expect(result.error).toContain("too large");
    } finally {
      fs.unlinkSync(tmpFile);
      fs.rmdirSync(tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// detectPackageFromArgs
// ---------------------------------------------------------------------------
describe("detectPackageFromArgs", () => {
  it("detects npm scoped package", () => {
    expect(detectPackageFromArgs(["-y", "@modelcontextprotocol/server-filesystem", "/data"])).toBe(
      "@modelcontextprotocol/server-filesystem",
    );
  });

  it("detects npm scoped package with version", () => {
    expect(detectPackageFromArgs(["-y", "@org/pkg@1.2.3"])).toBe("@org/pkg");
  });

  it("detects python mcp-server package", () => {
    expect(detectPackageFromArgs(["mcp-server-fetch"])).toBe("mcp-server-fetch");
  });

  it("detects python mcp-server-time", () => {
    expect(detectPackageFromArgs(["mcp-server-time", "--local-timezone=UTC"])).toBe(
      "mcp-server-time",
    );
  });

  it("returns null for no recognizable package", () => {
    expect(detectPackageFromArgs(["--help"])).toBeNull();
    expect(detectPackageFromArgs(["-v"])).toBeNull();
  });

  it("skips non-string args", () => {
    expect(detectPackageFromArgs([42 as any, null as any])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stripVersion
// ---------------------------------------------------------------------------
describe("stripVersion", () => {
  it("strips version from scoped package", () => {
    expect(stripVersion("@org/pkg@1.2.3")).toBe("@org/pkg");
  });

  it("returns scoped package unchanged when no version", () => {
    expect(stripVersion("@org/pkg")).toBe("@org/pkg");
  });

  it("strips version from unscoped package", () => {
    expect(stripVersion("pkg@2.0.0")).toBe("pkg");
  });

  it("returns unscoped package unchanged when no version", () => {
    expect(stripVersion("pkg")).toBe("pkg");
  });
});

// ---------------------------------------------------------------------------
// makeId
// ---------------------------------------------------------------------------
describe("makeId", () => {
  it("combines parts with underscore", () => {
    expect(makeId("a", "b", "c")).toBe("a_b_c");
  });

  it("filters empty parts", () => {
    expect(makeId("a", "", "b")).toBe("a_b");
  });

  it("strips leading/trailing dots and underscores from parts", () => {
    expect(makeId(".a", "_b_")).toBe("a_b");
  });

  it("normalizes non-word sequences to underscore", () => {
    expect(makeId("a-b", "c d")).toBe("a_b_c_d");
  });

  it("collapses multiple underscores", () => {
    expect(makeId("a__b")).toBe("a_b");
  });

  it("lowercases the result", () => {
    expect(makeId("Hello", "World")).toBe("hello_world");
  });

  it("returns empty string for all-empty input", () => {
    expect(makeId("", "")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// fileStem
// ---------------------------------------------------------------------------
describe("fileStem", () => {
  it("returns stem for top-level file", () => {
    expect(fileStem("sample.mcp.json")).toBe("sample.mcp");
  });

  it("qualifies with parent directory", () => {
    expect(fileStem("config/sample.mcp.json")).toBe("config.sample.mcp");
  });

  it("handles nested paths", () => {
    expect(fileStem("a/b/c/file.json")).toBe("c.file");
  });

  it("handles dot directory", () => {
    expect(fileStem("./file.json")).toBe("file");
  });
});
