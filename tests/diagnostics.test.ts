import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  scanProducerSuppressionSites,
  diagnoseExtraction,
  formatDiagnosticJson,
  formatDiagnosticReport,
} from "../src/diagnostics.js";

const FIXTURES = path.resolve(__dirname, "fixtures");

describe("diagnostics", () => {
  describe("scanProducerSuppressionSites", () => {
    it("returns default result for non-existent file", () => {
      const result = scanProducerSuppressionSites("/tmp/__no_such_file_diagnostics__.py");
      expect(result.path).toContain("__no_such_file_diagnostics__");
      expect(result.total_sites).toBe(0);
    });

    it("detects suppression sites in a python file", () => {
      const tmpFile = path.join(os.tmpdir(), `diag_test_${Date.now()}.py`);
      fs.writeFileSync(tmpFile, [
        "from graphify.diagnostics import scan_producer_suppression_sites",
        "seen_my_var = set()",
        "seen_other_var: set = set()",
        "x = 1",
      ].join("\n"));
      try {
        const result = scanProducerSuppressionSites(tmpFile);
        expect(result.total_sites).toBe(2);
        const names = result.sites.map((s: any) => s.name);
        expect(names).toContain("seen_my_var");
        expect(names).toContain("seen_other_var");
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });

  describe("diagnoseExtraction", () => {
    it("returns a summary with expected keys for a minimal extraction", () => {
      const extraction = {
        nodes: [
          { id: "a", label: "func_a", kind: "function", source: "main.py" },
          { id: "b", label: "func_b", kind: "function", source: "main.py" },
        ],
        edges: [
          { source: "a", target: "b", relation: "calls" },
        ],
      };
      const summary = diagnoseExtraction(extraction);
      expect(summary.node_count).toBe(2);
      expect(summary.raw_edge_count).toBe(1);
    });

    it("handles empty extraction", () => {
      const summary = diagnoseExtraction({ nodes: [], edges: [] });
      expect(summary.node_count).toBe(0);
      expect(summary.raw_edge_count).toBe(0);
    });
  });

  describe("formatDiagnosticJson", () => {
    it("returns an object with schema_version and summary", () => {
      const summary = diagnoseExtraction({ nodes: [], edges: [] });
      const json = formatDiagnosticJson(summary);
      expect(json).toHaveProperty("schema_version");
      expect(json).toHaveProperty("summary");
    });
  });

  describe("formatDiagnosticReport", () => {
    it("returns a string containing key metrics", () => {
      const summary = diagnoseExtraction({
        nodes: [{ id: "x", label: "foo", kind: "function" }],
        edges: [],
      });
      const report = formatDiagnosticReport(summary);
      expect(typeof report).toBe("string");
      expect(report).toContain("nodes:");
    });
  });
});
