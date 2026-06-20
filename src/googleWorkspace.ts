// Optional Google Workspace shortcut export support.
//
// Google Drive for desktop stores native Docs, Sheets, and Slides as small JSON
// shortcut files (.gdoc, .gsheet, .gslides). Those files are pointers, not the
// document content. This module exports them to Markdown sidecars via the
// googleworkspace CLI (`gws`) so Graphify can extract their actual contents.
import * as child_process from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { URL } from "url";

export const GOOGLE_WORKSPACE_EXTENSIONS = new Set([".gdoc", ".gsheet", ".gslides"]);

export interface GoogleShortcutInfo {
  file_id: string;
  url: string | null;
  resource_key: string | null;
  account: string | null;
}

/** Return True when Google Workspace shortcut export is enabled. */
export function googleWorkspaceEnabled(value?: string | null): boolean {
  const raw = value ?? process.env.GRAPHIFY_GOOGLE_WORKSPACE ?? "";
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/** Escape a value for embedding in a YAML double-quoted scalar (minimal). */
function safeYamlStr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ").replace(/\r/g, " ");
}

/** Extract a Drive file ID from common Google Docs/Drive URL shapes. */
export function extractFileIdFromUrl(url: string): string | null {
  if (!url) return null;
  const parsed = new URL(url);
  const query = new URLSearchParams(parsed.search);
  const idParam = query.get("id");
  if (idParam) return idParam;
  const match = parsed.pathname.match(/\/(?:document|spreadsheets|presentation|file)\/d\/([^/?#]+)/);
  if (match) return match[1];
  return null;
}

/** Extract a resource key from URL query params or shortcut data. */
export function extractResourceKey(url: string, data: Record<string, any>): string | null {
  for (const key of ["resource_key", "resourceKey"]) {
    const value = data[key];
    if (value) return String(value);
  }
  if (!url) return null;
  const parsed = new URL(url);
  const query = new URLSearchParams(parsed.search);
  const rk = query.get("resourcekey");
  if (rk) return rk;
  return null;
}

/** Read a .gdoc/.gsheet/.gslides shortcut and return export metadata. */
export function readGoogleShortcut(filePath: string): GoogleShortcutInfo {
  let data: Record<string, any>;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    data = JSON.parse(content);
  } catch (exc: any) {
    throw new Error(`could not read Google Workspace shortcut ${filePath}: ${exc.message}`);
  }

  const url = String(data.url || "");
  let fileId: string | null =
    data.doc_id || data.file_id || data.fileId || data.id || extractFileIdFromUrl(url);

  if (!fileId) {
    const resourceId = String(data.resource_id || "");
    if (resourceId.includes(":")) {
      fileId = resourceId.split(":", 2)[1];
    }
  }

  if (!fileId) {
    throw new Error(`Google Workspace shortcut ${filePath} does not include a Drive file ID`);
  }

  return {
    file_id: String(fileId),
    url: url || null,
    resource_key: extractResourceKey(url, data),
    account: data.email ? String(data.email) : null,
  };
}

/** Run `gws drive files export` to download a Google Workspace file. */
function runGwsExport(
  fileId: string,
  mimeType: string,
  output: string,
  resourceKey?: string | null,
): void {
  // Look up gws executable
  let exe: string;
  try {
    exe = child_process.execSync("which gws 2>/dev/null", { encoding: "utf-8" }).trim();
  } catch {
    throw new Error(
      "gws is required for Google Workspace export. Install it from " +
      "https://github.com/googleworkspace/cli and run `gws auth login -s drive`."
    );
  }

  const params: Record<string, string> = { fileId, mimeType };
  // Drive resource keys are sent via X-Goog-Drive-Resource-Keys. The current
  // gws export command has no custom-header flag, so do not pass resourceKey
  // as an unsupported query parameter.
  void resourceKey;

  const outputResolved = path.resolve(output);
  fs.mkdirSync(path.dirname(outputResolved), { recursive: true });

  const timeout = parseInt(process.env.GRAPHIFY_GOOGLE_WORKSPACE_TIMEOUT || "120", 10) * 1000;

  const result = child_process.execFileSync(
    exe,
    ["drive", "files", "export", "--params", JSON.stringify(params), "-o", path.basename(outputResolved)],
    {
      cwd: path.dirname(outputResolved),
      encoding: "utf-8",
      timeout,
    },
  );
  // execFileSync throws on non-zero exit, but check just in case
  if (result && typeof result === "object" && "status" in result && (result as any).status !== 0) {
    throw new Error(`gws export failed for ${fileId}`);
  }
}

/** Compute the sidecar Markdown path for a Google Workspace shortcut. */
function sidecarPath(filePath: string, outDir: string): string {
  const nameHash = crypto.createHash("sha256").update(path.resolve(filePath)).digest("hex").slice(0, 8);
  const stem = path.basename(filePath, path.extname(filePath));
  return path.join(outDir, `${stem}_${nameHash}.md`);
}

/** Build a Markdown string with YAML frontmatter wrapping the exported body. */
function withFrontmatter(
  filePath: string,
  shortcut: GoogleShortcutInfo,
  body: string,
  exportedMimeType: string,
): string {
  const sourceUrl = shortcut.url || "";
  const account = shortcut.account || "";
  let accountLine = "";
  if (account) {
    const accountHash = crypto.createHash("sha256").update(account).digest("hex").slice(0, 12);
    accountLine = `google_account_hash: "${accountHash}"\n`;
  }
  return (
    "---\n" +
    `source_file: "${safeYamlStr(filePath)}"\n` +
    'source_type: "google_workspace"\n' +
    `google_file_id: "${safeYamlStr(shortcut.file_id || "")}"\n` +
    `google_export_mime_type: "${safeYamlStr(exportedMimeType)}"\n` +
    `source_url: "${safeYamlStr(sourceUrl)}"\n` +
    accountLine +
    "---\n\n" +
    `<!-- converted from Google Workspace shortcut: ${path.basename(filePath)} -->\n\n` +
    `${body.trim()}\n`
  );
}

/**
  Export a Google Workspace shortcut to a Markdown sidecar.

  Returns the converted Markdown path, or null when conversion is unsupported
  or produced no readable content.
*/
export function convertGoogleWorkspaceFile(
  filePath: string,
  outDir: string,
  xlsxToMarkdown?: (tmpPath: string) => string,
): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (!GOOGLE_WORKSPACE_EXTENSIONS.has(ext)) return null;

  const shortcut = readGoogleShortcut(filePath);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = sidecarPath(filePath, outDir);

  if (ext === ".gdoc") {
    const tmpPath = path.join(outDir, `tmp_${Date.now()}.md`);
    try {
      runGwsExport(shortcut.file_id || "", "text/markdown", tmpPath, shortcut.resource_key);
      const body = fs.readFileSync(tmpPath, "utf-8");
      if (!body.trim()) return null;
      fs.writeFileSync(outPath, withFrontmatter(filePath, shortcut, body, "text/markdown"), "utf-8");
      return outPath;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  if (ext === ".gslides") {
    const tmpPath = path.join(outDir, `tmp_${Date.now()}.txt`);
    try {
      runGwsExport(shortcut.file_id || "", "text/plain", tmpPath, shortcut.resource_key);
      const body = fs.readFileSync(tmpPath, "utf-8");
      if (!body.trim()) return null;
      fs.writeFileSync(outPath, withFrontmatter(filePath, shortcut, body, "text/plain"), "utf-8");
      return outPath;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  if (ext === ".gsheet") {
    if (!xlsxToMarkdown) {
      throw new Error("Google Sheets export requires the office extra: pip install graphifyy[office,google]");
    }
    const tmpPath = path.join(outDir, `tmp_${Date.now()}.xlsx`);
    try {
      runGwsExport(
        shortcut.file_id || "",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        tmpPath,
        shortcut.resource_key,
      );
      const body = xlsxToMarkdown(tmpPath);
      if (!body.trim()) return null;
      fs.writeFileSync(
        outPath,
        withFrontmatter(
          filePath,
          shortcut,
          body,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
        "utf-8",
      );
      return outPath;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  return null;
}
