import { describe, it, expect } from "vitest";
import {
  VIDEO_EXTENSIONS,
  URL_PREFIXES,
  DEFAULT_MODEL,
  TRANSCRIPTS_DIR,
  FALLBACK_PROMPT,
  isUrl,
  buildWhisperPrompt,
} from "../src/transcribe.js";

describe("VIDEO_EXTENSIONS", () => {
  it("contains .mp4", () => {
    expect(VIDEO_EXTENSIONS.has(".mp4")).toBe(true);
  });

  it("contains .mov", () => {
    expect(VIDEO_EXTENSIONS.has(".mov")).toBe(true);
  });

  it("contains audio extensions like .mp3", () => {
    expect(VIDEO_EXTENSIONS.has(".mp3")).toBe(true);
  });

  it("contains .wav", () => {
    expect(VIDEO_EXTENSIONS.has(".wav")).toBe(true);
  });

  it("does not contain .txt", () => {
    expect(VIDEO_EXTENSIONS.has(".txt")).toBe(false);
  });
});

describe("URL_PREFIXES", () => {
  it("contains http://", () => {
    expect(URL_PREFIXES).toContain("http://");
  });

  it("contains https://", () => {
    expect(URL_PREFIXES).toContain("https://");
  });

  it("contains www.", () => {
    expect(URL_PREFIXES).toContain("www.");
  });
});

describe("DEFAULT_MODEL", () => {
  it('is "base"', () => {
    expect(DEFAULT_MODEL).toBe("base");
  });
});

describe("TRANSCRIPTS_DIR", () => {
  it("is a non-empty string", () => {
    expect(typeof TRANSCRIPTS_DIR).toBe("string");
    expect(TRANSCRIPTS_DIR.length).toBeGreaterThan(0);
  });
});

describe("FALLBACK_PROMPT", () => {
  it("mentions punctuation", () => {
    expect(FALLBACK_PROMPT).toContain("punctuation");
  });
});

describe("isUrl", () => {
  it("returns true for https:// URL", () => {
    expect(isUrl("https://youtube.com/watch?v=abc")).toBe(true);
  });

  it("returns true for http:// URL", () => {
    expect(isUrl("http://example.com/video.mp4")).toBe(true);
  });

  it("returns true for www. prefix", () => {
    expect(isUrl("www.youtube.com/watch?v=abc")).toBe(true);
  });

  it("returns false for local file path", () => {
    expect(isUrl("/home/user/video.mp4")).toBe(false);
  });

  it("returns false for relative file path", () => {
    expect(isUrl("./video.mp4")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isUrl("")).toBe(false);
  });
});

describe("buildWhisperPrompt", () => {
  it("returns fallback prompt for empty array", () => {
    expect(buildWhisperPrompt([])).toBe(FALLBACK_PROMPT);
  });

  it("returns fallback prompt for null input", () => {
    expect(buildWhisperPrompt(null as any)).toBe(FALLBACK_PROMPT);
  });

  it("builds prompt from node labels", () => {
    const nodes = [
      { label: "Kubernetes" },
      { label: "Docker" },
      { label: "Microservices" },
    ];
    const result = buildWhisperPrompt(nodes);
    expect(result).toContain("Kubernetes");
    expect(result).toContain("Docker");
    expect(result).toContain("Microservices");
    expect(result).toContain("punctuation");
  });

  it("limits to 5 labels", () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({ label: `Topic${i}` }));
    const result = buildWhisperPrompt(nodes);
    expect(result).toContain("Topic0");
    expect(result).toContain("Topic4");
    expect(result).not.toContain("Topic5");
  });

  it("skips nodes without labels", () => {
    const nodes = [
      { label: "Valid" },
      { name: "NoLabel" },
      { label: "AlsoValid" },
    ];
    const result = buildWhisperPrompt(nodes);
    expect(result).toContain("Valid");
    expect(result).toContain("AlsoValid");
    expect(result).not.toContain("NoLabel");
  });

  it("returns fallback when all labels are empty", () => {
    const nodes = [{ label: "" }, { foo: "bar" }];
    expect(buildWhisperPrompt(nodes)).toBe(FALLBACK_PROMPT);
  });

  it("uses env override when set", () => {
    const orig = process.env.GRAPHIFY_WHISPER_PROMPT;
    process.env.GRAPHIFY_WHISPER_PROMPT = "Custom prompt override";
    try {
      const result = buildWhisperPrompt([{ label: "Ignored" }]);
      expect(result).toBe("Custom prompt override");
    } finally {
      if (orig !== undefined) process.env.GRAPHIFY_WHISPER_PROMPT = orig;
      else delete process.env.GRAPHIFY_WHISPER_PROMPT;
    }
  });
});
