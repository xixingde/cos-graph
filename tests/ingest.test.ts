import { describe, it, expect } from "vitest";
import { yamlStr, safeFilename, detectUrlType, htmlToMarkdown, saveQueryResult } from "../src/ingest.js";

describe("yamlStr", () => {
  it("returns empty string for null", () => {
    expect(yamlStr(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(yamlStr(undefined)).toBe("");
  });

  it("passes through plain text unchanged", () => {
    expect(yamlStr("hello world")).toBe("hello world");
  });

  it("escapes backslash", () => {
    expect(yamlStr("a\\b")).toBe("a\\\\b");
  });

  it("escapes double quote", () => {
    expect(yamlStr('a"b')).toBe('a\\"b');
  });

  it("escapes newline", () => {
    expect(yamlStr("a\nb")).toBe("a\\nb");
  });

  it("escapes carriage return", () => {
    expect(yamlStr("a\rb")).toBe("a\\rb");
  });

  it("escapes tab", () => {
    expect(yamlStr("a\tb")).toBe("a\\tb");
  });

  it("escapes null byte", () => {
    expect(yamlStr("a\0b")).toBe("a\\0b");
  });

  it("escapes unicode line separator U+2028", () => {
    expect(yamlStr("a\u2028b")).toBe("a\\Lb");
  });

  it("escapes unicode paragraph separator U+2029", () => {
    expect(yamlStr("a\u2029b")).toBe("a\\Pb");
  });

  it("escapes other control characters", () => {
    expect(yamlStr("a\x01b")).toBe("a\\x01b");
  });

  it("escapes DEL (0x7f)", () => {
    expect(yamlStr("a\x7fb")).toBe("a\\x7fb");
  });

  it("handles multiple special characters in one string", () => {
    expect(yamlStr('he"llo\nwo\\rld')).toBe('he\\"llo\\nwo\\\\rld');
  });
});

describe("safeFilename", () => {
  it("turns a simple URL into a safe filename", () => {
    const result = safeFilename("https://example.com/page", ".md");
    expect(result).toMatch(/example_com_page\.md$/);
  });

  it("replaces non-word characters with underscore", () => {
    const result = safeFilename("https://example.com/path/with-dash", ".md");
    expect(result).not.toContain("/");
  });

  it("truncates long names to 80 chars plus suffix", () => {
    const longPath = "a".repeat(200);
    const result = safeFilename(`https://example.com/${longPath}`, ".md");
    expect(result.length).toBeLessThanOrEqual(80 + 3); // 80 + ".md"
  });

  it("strips leading and trailing underscores", () => {
    const result = safeFilename("https://example.com/", ".md");
    expect(result).not.toMatch(/^_+/);
  });

  it("includes the suffix at the end", () => {
    const result = safeFilename("https://example.com/page", ".pdf");
    expect(result).toMatch(/\.pdf$/);
  });
});

describe("detectUrlType", () => {
  it("detects twitter.com as tweet", () => {
    expect(detectUrlType("https://twitter.com/user/status/123")).toBe("tweet");
  });

  it("detects x.com as tweet", () => {
    expect(detectUrlType("https://x.com/user/status/456")).toBe("tweet");
  });

  it("detects arxiv.org as arxiv", () => {
    expect(detectUrlType("https://arxiv.org/abs/2401.00001")).toBe("arxiv");
  });

  it("detects github.com as github", () => {
    expect(detectUrlType("https://github.com/org/repo")).toBe("github");
  });

  it("detects youtube.com as youtube", () => {
    expect(detectUrlType("https://youtube.com/watch?v=abc")).toBe("youtube");
  });

  it("detects youtu.be as youtube", () => {
    expect(detectUrlType("https://youtu.be/abc")).toBe("youtube");
  });

  it("detects .pdf extension as pdf", () => {
    expect(detectUrlType("https://example.com/paper.pdf")).toBe("pdf");
  });

  it("detects .png extension as image", () => {
    expect(detectUrlType("https://example.com/photo.png")).toBe("image");
  });

  it("detects .jpg extension as image", () => {
    expect(detectUrlType("https://example.com/photo.jpg")).toBe("image");
  });

  it("detects unknown URLs as webpage", () => {
    expect(detectUrlType("https://example.com/about")).toBe("webpage");
  });

  it("is case-insensitive", () => {
    expect(detectUrlType("https://TWITTER.COM/user/status/123")).toBe("tweet");
  });
});

describe("htmlToMarkdown", () => {
  it("strips HTML tags in fallback mode", () => {
    const result = htmlToMarkdown("<p>Hello <b>world</b></p>", "https://example.com");
    expect(result).toContain("Hello");
    expect(result).toContain("world");
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<b>");
  });

  it("collapses whitespace", () => {
    const result = htmlToMarkdown("<p>  spaced   out  </p>", "https://example.com");
    expect(result).not.toMatch(/\s{2,}/);
  });
});

describe("saveQueryResult", () => {
  it("is a function", () => {
    expect(typeof saveQueryResult).toBe("function");
  });
});
