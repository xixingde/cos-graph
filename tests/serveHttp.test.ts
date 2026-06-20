import { describe, it, expect, vi } from "vitest";
import { buildServer } from "../src/serve/server.js";
import { ServeHttpOptions } from "../src/serve/transport.js";

describe("buildServer", () => {
  it("returns an McpServer instance", () => {
    const server = buildServer("graphify-out/graph.json");
    expect(server).toBeTruthy();
    expect(typeof server.tool).toBe("function");
    expect(typeof server.resource).toBe("function");
    expect(typeof server.connect).toBe("function");
  });
});

describe("ServeHttpOptions", () => {
  it("accepts optional parameters", () => {
    const opts: ServeHttpOptions = {
      host: "0.0.0.0",
      port: 8080,
      apiKey: "secret",
      path: "/mcp",
      jsonResponse: true,
      stateless: true,
      sessionTimeout: 30000,
    };
    expect(opts.host).toBe("0.0.0.0");
    expect(opts.port).toBe(8080);
    expect(opts.apiKey).toBe("secret");
  });

  it("allows all-optional options", () => {
    const opts: ServeHttpOptions = {};
    expect(opts.host).toBeUndefined();
    expect(opts.port).toBeUndefined();
    expect(opts.apiKey).toBeUndefined();
  });

  it("allows null apiKey", () => {
    const opts: ServeHttpOptions = { apiKey: null };
    expect(opts.apiKey).toBeNull();
  });
});
