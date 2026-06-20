/**
 * Tests for image vision extraction (OpenAI Vision API integration).
 *
 * These tests require external API access and are skipped by default.
 */
import { describe, it, expect, test } from "vitest";

// Image vision extraction not yet migrated
// import { extractImageVision } from "../src/llm/index.js";

describe.skip("Image vision — requires external API key, not yet migrated", () => {
  it("extracts text from image via vision API", () => {});
  it("extracts diagram nodes from image", () => {});
  it("extracts flow chart from image", () => {});
  it("handles non-image files gracefully", () => {});
  it("handles API errors gracefully", () => {});
  it("handles rate limiting gracefully", () => {});
  it("handles missing API key gracefully", () => {});
});
