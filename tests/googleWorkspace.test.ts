import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  GOOGLE_WORKSPACE_EXTENSIONS,
  googleWorkspaceEnabled,
  extractFileIdFromUrl,
  extractResourceKey,
  readGoogleShortcut,
} from "../src/googleWorkspace.js";

describe("GOOGLE_WORKSPACE_EXTENSIONS", () => {
  it("contains .gdoc", () => {
    expect(GOOGLE_WORKSPACE_EXTENSIONS.has(".gdoc")).toBe(true);
  });

  it("contains .gsheet", () => {
    expect(GOOGLE_WORKSPACE_EXTENSIONS.has(".gsheet")).toBe(true);
  });

  it("contains .gslides", () => {
    expect(GOOGLE_WORKSPACE_EXTENSIONS.has(".gslides")).toBe(true);
  });

  it("does not contain .pdf", () => {
    expect(GOOGLE_WORKSPACE_EXTENSIONS.has(".pdf")).toBe(false);
  });
});

describe("googleWorkspaceEnabled", () => {
  const origEnv = process.env.GRAPHIFY_GOOGLE_WORKSPACE;

  it("returns true for '1'", () => {
    expect(googleWorkspaceEnabled("1")).toBe(true);
  });

  it("returns true for 'true'", () => {
    expect(googleWorkspaceEnabled("true")).toBe(true);
  });

  it("returns true for 'yes'", () => {
    expect(googleWorkspaceEnabled("yes")).toBe(true);
  });

  it("returns true for 'on'", () => {
    expect(googleWorkspaceEnabled("on")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(googleWorkspaceEnabled("")).toBe(false);
  });

  it("returns false for 'false'", () => {
    expect(googleWorkspaceEnabled("false")).toBe(false);
  });

  it("returns false for null", () => {
    expect(googleWorkspaceEnabled(null)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(googleWorkspaceEnabled("True")).toBe(true);
    expect(googleWorkspaceEnabled("YES")).toBe(true);
  });

  it("reads from env when no value passed", () => {
    process.env.GRAPHIFY_GOOGLE_WORKSPACE = "1";
    try {
      expect(googleWorkspaceEnabled()).toBe(true);
    } finally {
      if (origEnv !== undefined) process.env.GRAPHIFY_GOOGLE_WORKSPACE = origEnv;
      else delete process.env.GRAPHIFY_GOOGLE_WORKSPACE;
    }
  });
});

describe("extractFileIdFromUrl", () => {
  it("extracts id from /document/d/ID/edit URL", () => {
    expect(extractFileIdFromUrl("https://docs.google.com/document/d/1AbcDef/edit")).toBe("1AbcDef");
  });

  it("extracts id from /spreadsheets/d/ID URL", () => {
    expect(extractFileIdFromUrl("https://docs.google.com/spreadsheets/d/Xyz123/edit")).toBe("Xyz123");
  });

  it("extracts id from /presentation/d/ID URL", () => {
    expect(extractFileIdFromUrl("https://docs.google.com/presentation/d/Pqr456/edit")).toBe("Pqr456");
  });

  it("extracts id from /file/d/ID URL", () => {
    expect(extractFileIdFromUrl("https://drive.google.com/file/d/1AbcDef/view")).toBe("1AbcDef");
  });

  it("extracts id from query param id=...", () => {
    expect(extractFileIdFromUrl("https://drive.google.com/open?id=1AbcDef")).toBe("1AbcDef");
  });

  it("returns null for URL without a file ID", () => {
    expect(extractFileIdFromUrl("https://example.com/no-id-here")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractFileIdFromUrl("")).toBeNull();
  });
});

describe("extractResourceKey", () => {
  it("extracts resource_key from data", () => {
    expect(extractResourceKey("", { resource_key: "abc123" })).toBe("abc123");
  });

  it("extracts resourceKey from data", () => {
    expect(extractResourceKey("", { resourceKey: "def456" })).toBe("def456");
  });

  it("prefers resource_key over resourceKey", () => {
    expect(extractResourceKey("", { resource_key: "first", resourceKey: "second" })).toBe("first");
  });

  it("extracts resourcekey from URL query param", () => {
    expect(extractResourceKey("https://docs.google.com/document/d/1/edit?resourcekey=xyz", {})).toBe("xyz");
  });

  it("returns null when no resource key found", () => {
    expect(extractResourceKey("https://example.com", {})).toBeNull();
  });

  it("returns null for empty URL and empty data", () => {
    expect(extractResourceKey("", {})).toBeNull();
  });
});

describe("readGoogleShortcut", () => {
  it("reads a valid .gdoc shortcut with doc_id", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gws-test-"));
    const tmpFile = path.join(tmpDir, "test.gdoc");
    try {
      fs.writeFileSync(tmpFile, JSON.stringify({
        url: "https://docs.google.com/document/d/1AbcDef/edit",
        doc_id: "1AbcDef",
        email: "user@example.com",
      }));
      const result = readGoogleShortcut(tmpFile);
      expect(result.file_id).toBe("1AbcDef");
      expect(result.url).toBe("https://docs.google.com/document/d/1AbcDef/edit");
      expect(result.account).toBe("user@example.com");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads a shortcut with file_id field", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gws-test-"));
    const tmpFile = path.join(tmpDir, "test.gdoc");
    try {
      fs.writeFileSync(tmpFile, JSON.stringify({
        url: "https://docs.google.com/document/d/Xyz/edit",
        file_id: "Xyz",
      }));
      const result = readGoogleShortcut(tmpFile);
      expect(result.file_id).toBe("Xyz");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("extracts file ID from URL when no explicit ID field", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gws-test-"));
    const tmpFile = path.join(tmpDir, "test.gdoc");
    try {
      fs.writeFileSync(tmpFile, JSON.stringify({
        url: "https://docs.google.com/document/d/UrlId123/edit",
      }));
      const result = readGoogleShortcut(tmpFile);
      expect(result.file_id).toBe("UrlId123");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("extracts file ID from resource_id with colon format", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gws-test-"));
    const tmpFile = path.join(tmpDir, "test.gdoc");
    try {
      fs.writeFileSync(tmpFile, JSON.stringify({
        resource_id: "document:ResId456",
      }));
      const result = readGoogleShortcut(tmpFile);
      expect(result.file_id).toBe("ResId456");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when no file ID can be found", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gws-test-"));
    const tmpFile = path.join(tmpDir, "test.gdoc");
    try {
      fs.writeFileSync(tmpFile, JSON.stringify({ url: "https://example.com" }));
      expect(() => readGoogleShortcut(tmpFile)).toThrow(/does not include a Drive file ID/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws for unreadable file", () => {
    expect(() => readGoogleShortcut("/non/existent/file.gdoc")).toThrow();
  });

  it("returns null url when url field is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gws-test-"));
    const tmpFile = path.join(tmpDir, "test.gdoc");
    try {
      fs.writeFileSync(tmpFile, JSON.stringify({ doc_id: "abc" }));
      const result = readGoogleShortcut(tmpFile);
      expect(result.url).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
