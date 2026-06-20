import { describe, it, expect } from "vitest";

import {
  probeMultigraphCapabilities,
  requireMultigraphCapabilities,
} from "../src/multigraphCompat.js";

describe("multigraphCompat", () => {
  describe("probeMultigraphCapabilities", () => {
    it("returns a result with expected top-level keys", () => {
      const result = probeMultigraphCapabilities();
      expect(result).toHaveProperty("nodeVersion");
      expect(result).toHaveProperty("graphologyVersion");
      expect(result).toHaveProperty("checks");
      expect(result).toHaveProperty("ok");
    });

    it("checks is an array of CapabilityCheck objects", () => {
      const result = probeMultigraphCapabilities();
      expect(Array.isArray(result.checks)).toBe(true);
      for (const check of result.checks) {
        expect(check).toHaveProperty("name");
        expect(check).toHaveProperty("ok");
        expect(check).toHaveProperty("detail");
        expect(typeof check.ok).toBe("boolean");
        expect(typeof check.detail).toBe("string");
      }
    });

    it("nodeVersion is a string", () => {
      const result = probeMultigraphCapabilities();
      expect(typeof result.nodeVersion).toBe("string");
    });

    it("graphologyVersion is a string", () => {
      const result = probeMultigraphCapabilities();
      expect(typeof result.graphologyVersion).toBe("string");
    });

    it("caches result on second call (same object reference)", () => {
      const first = probeMultigraphCapabilities();
      const second = probeMultigraphCapabilities();
      expect(first).toBe(second);
    });

    it("ok is true when all checks pass", () => {
      const result = probeMultigraphCapabilities();
      const allChecksOk = result.checks.every((c) => c.ok);
      expect(result.ok).toBe(allChecksOk);
    });
  });

  describe("requireMultigraphCapabilities", () => {
    it("throws when capability checks fail", () => {
      const probe = probeMultigraphCapabilities();
      if (!probe.ok) {
        expect(() => requireMultigraphCapabilities()).toThrow();
      } else {
        const result = requireMultigraphCapabilities();
        expect(result).toHaveProperty("nodeVersion");
        expect(result).toHaveProperty("checks");
      }
    });
  });
});
