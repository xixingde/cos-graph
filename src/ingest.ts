// fetch URLs (tweet/arxiv/pdf/web) and save as annotated markdown
import * as fs from "fs";
import * as path from "path";
import { URL } from "url";

import { validateUrl, safeFetch, safeFetchText } from "./security.js";

/** Escape a string for embedding in a YAML double-quoted scalar.

  Handles every YAML 1.1/1.2 line-break and control character that could
  let a hostile value (e.g. a fetched page title) break out of the quoted
  scalar and inject sibling YAML keys (F-009 / F-019). The previous
  implementation missed `\t`, `\0`, the unicode line-separator U+2028 and
  paragraph-separator U+2029 -- all of which YAML treats as line breaks.

  We intentionally do not depend on a YAML library and instead emit
  safely-escaped double-quoted scalars by hand: the YAML double-quoted
  form recognises `\\`, `\"`, `\n`, `\r`, `\t`, `\0`, `\L` (U+2028),
  `\P` (U+2029), and `\xNN`/`\uNNNN` numeric escapes.
*/
export function yamlStr(s: string | null | undefined): string {
  if (s == null) return "";
  const src = String(s);
  const out: string[] = [];
  for (const ch of src) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out.push("\\\\");
    else if (ch === '"') out.push('\\"');
    else if (ch === "\n") out.push("\\n");
    else if (ch === "\r") out.push("\\r");
    else if (ch === "\t") out.push("\\t");
    else if (ch === "\0") out.push("\\0");
    else if (cp === 0x2028) out.push("\\L");
    else if (cp === 0x2029) out.push("\\P");
    else if (cp < 0x20 || cp === 0x7f) out.push(`\\x${cp.toString(16).padStart(2, "0")}`);
    else out.push(ch);
  }
  return out.join("");
}

/** Turn a URL into a safe filename. */
export function safeFilename(url: string, suffix: string): string {
  const parsed = new URL(url);
  const name = parsed.hostname + parsed.pathname;
  let safe = name.replace(/[^\w\-]/g, "_").replace(/^_+|_+$/g, "");
  safe = safe.replace(/_+/g, "_").slice(0, 80);
  return safe + suffix;
}

/** Classify the URL for targeted extraction. */
export function detectUrlType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("twitter.com") || lower.includes("x.com")) return "tweet";
  if (lower.includes("arxiv.org")) return "arxiv";
  if (lower.includes("github.com")) return "github";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  const parsed = new URL(url);
  const p = parsed.pathname.toLowerCase();
  if (p.endsWith(".pdf")) return "pdf";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].some(ext => p.endsWith(ext))) return "image";
  return "webpage";
}

/** Fetch HTML text from a URL safely. */
export async function fetchHtml(url: string): Promise<string> {
  return safeFetchText(url);
}

/** Convert HTML to clean markdown. Basic tag-strip fallback. */
export function htmlToMarkdown(html: string, _url: string): string {
  // Always pre-strip script/style so their text content never leaks into output
  let h = html.replace(/<script[^>]*>.*?<\/script>/gis, "");
  h = h.replace(/<style[^>]*>.*?<\/style>/gis, "");
  // Fallback: basic tag strip
  let text = h.replace(/<[^>]+>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, 8000);
}

/** Fetch a tweet URL. Returns [content, filename]. */
export async function fetchTweet(
  url: string,
  author: string | null,
  contributor: string | null,
): Promise<[string, string]> {
  const oembedUrl = url.replace("x.com", "twitter.com");
  const oembedApi = `https://publish.twitter.com/oembed?url=${encodeURIComponent(oembedUrl)}&omit_script=true`;
  let tweetText: string;
  let tweetAuthor: string;
  try {
    const data = JSON.parse(await safeFetchText(oembedApi));
    tweetText = (data.html || "").replace(/<[^>]+>/g, "").trim();
    tweetAuthor = data.author_name || "unknown";
  } catch {
    tweetText = `Tweet at ${url} (could not fetch content)`;
    tweetAuthor = "unknown";
  }

  const now = new Date().toISOString();
  const content = `---
source_url: "${yamlStr(url)}"
type: tweet
author: "${yamlStr(tweetAuthor)}"
captured_at: ${now}
contributor: "${yamlStr(contributor || author || 'unknown')}"
---

# Tweet by @${tweetAuthor}

${tweetText}

Source: ${url}
`;
  const filename = safeFilename(url, ".md");
  return [content, filename];
}

/** Fetch a generic webpage and convert to markdown. */
export async function fetchWebpage(
  url: string,
  author: string | null,
  contributor: string | null,
): Promise<[string, string]> {
  const html = await fetchHtml(url);
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
  const title = titleMatch
    ? titleMatch[1].replace(/\s+/g, " ").trim()
    : url;

  const markdown = htmlToMarkdown(html, url);
  const now = new Date().toISOString();
  const content = `---
source_url: "${yamlStr(url)}"
type: webpage
title: "${yamlStr(title)}"
captured_at: ${now}
contributor: "${yamlStr(contributor || author || 'unknown')}"
---

# ${title}

Source: ${url}

---

${markdown.slice(0, 12000)}
`;
  const filename = safeFilename(url, ".md");
  return [content, filename];
}

/** Fetch arXiv abstract page. */
export async function fetchArxiv(
  url: string,
  author: string | null,
  contributor: string | null,
): Promise<[string, string]> {
  const arxivId = url.match(/(\d{4}\.\d{4,5})/);
  let title: string;
  let abstract: string;
  let paperAuthors: string;
  if (arxivId) {
    const apiUrl = `https://export.arxiv.org/abs/${arxivId[1]}`;
    try {
      const html = await fetchHtml(apiUrl);
      const abstractMatch = html.match(/class="abstract[^"]*"[^>]*>(.*?)<\/blockquote>/is);
      abstract = abstractMatch ? abstractMatch[1].replace(/<[^>]+>/g, "").trim() : "";
      const titleMatch = html.match(/class="title[^"]*"[^>]*>(.*?)<\/h1>/is);
      title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, " ").trim() : arxivId[1];
      const authorsMatch = html.match(/class="authors"[^>]*>(.*?)<\/div>/is);
      paperAuthors = authorsMatch ? authorsMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    } catch {
      title = arxivId[1];
      abstract = "";
      paperAuthors = "";
    }
  } else {
    return fetchWebpage(url, author, contributor);
  }

  const now = new Date().toISOString();
  const content = `---
source_url: "${yamlStr(url)}"
arxiv_id: "${yamlStr(arxivId ? arxivId[1] : '')}"
type: paper
title: "${yamlStr(title)}"
paper_authors: "${yamlStr(paperAuthors)}"
captured_at: ${now}
contributor: "${yamlStr(contributor || author || 'unknown')}"
---

# ${title}

**Authors:** ${paperAuthors}
**arXiv:** ${arxivId ? arxivId[1] : url}

## Abstract

${abstract}

Source: ${url}
`;
  const filename = arxivId
    ? `arxiv_${arxivId[1].replace(".", "_")}.md`
    : safeFilename(url, ".md");
  return [content, filename];
}

/** Download a binary file (PDF, image) directly. */
export async function downloadBinary(
  url: string,
  suffix: string,
  targetDir: string,
): Promise<string> {
  const filename = safeFilename(url, suffix);
  const outPath = path.join(targetDir, filename);
  const buf = await safeFetch(url);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

/**
  Fetch a URL and save it into target_dir as a graphify-ready file.
  Returns the path of the saved file.
*/
export async function ingest(
  url: string,
  targetDir: string,
  author?: string,
  contributor?: string,
): Promise<string> {
  fs.mkdirSync(targetDir, { recursive: true });
  const urlType = detectUrlType(url);

  try {
    validateUrl(url);
  } catch (exc: any) {
    throw new Error(`ingest: ${exc.message}`);
  }

  let content: string = "";
  let filename: string = "";

  try {
    if (urlType === "pdf") {
      const out = await downloadBinary(url, ".pdf", targetDir);
      console.log(`Downloaded PDF: ${path.basename(out)}`);
      return out;
    }

    if (urlType === "image") {
      const suffix = path.extname(new URL(url).pathname) || ".jpg";
      const out = await downloadBinary(url, suffix, targetDir);
      console.log(`Downloaded image: ${path.basename(out)}`);
      return out;
    }

    if (urlType === "youtube") {
      const { downloadAudio } = await import("./transcribe.js");
      const out = await downloadAudio(url, targetDir);
      console.log(`Downloaded audio: ${path.basename(out)}`);
      return out;
    }

    if (urlType === "tweet") {
      [content, filename] = await fetchTweet(url, author ?? null, contributor ?? null);
    } else if (urlType === "arxiv") {
      [content, filename] = await fetchArxiv(url, author ?? null, contributor ?? null);
    } else {
      [content, filename] = await fetchWebpage(url, author ?? null, contributor ?? null);
    }
  } catch (exc: any) {
    throw new Error(`ingest: failed to fetch '${url}': ${exc.message}`);
  }

  let outPath = path.join(targetDir, filename);
  // Avoid overwriting -- append counter if needed
  let counter = 1;
  while (fs.existsSync(outPath) && counter < 1000) {
    const stem = path.basename(filename, path.extname(filename));
    outPath = path.join(targetDir, `${stem}_${counter}.md`);
    counter++;
  }

  fs.writeFileSync(outPath, content, "utf-8");
  console.log(`Saved ${urlType}: ${path.basename(outPath)}`);
  return outPath;
}

/**
  Save a Q&A result as markdown so it gets extracted into the graph on next --update.

  Files are stored in memory_dir (typically graphify-out/memory/) with YAML frontmatter
  that graphify's extractor reads as node metadata. This closes the feedback loop:
  the system grows smarter from both what you add AND what you ask.
*/
export function saveQueryResult(
  question: string,
  answer: string,
  memoryDir: string,
  queryType: string = "query",
  sourceNodes?: string[],
): string {
  fs.mkdirSync(memoryDir, { recursive: true });

  const now = new Date();
  const slug = question.toLowerCase().replace(/[^\w]/g, "_").slice(0, 50).replace(/^_+|_+$/g, "");
  const filename = `query_${formatCompact(now)}_${slug}.md`;

  const frontmatterLines: string[] = [
    "---",
    `type: "${queryType}"`,
    `date: "${now.toISOString()}"`,
    `question: "${yamlStr(question)}"`,
    `contributor: "graphify"`,
  ];
  if (sourceNodes && sourceNodes.length > 0) {
    const nodesStr = sourceNodes.slice(0, 10).map(n => `"${n}"`).join(", ");
    frontmatterLines.push(`source_nodes: [${nodesStr}]`);
  }
  frontmatterLines.push("---");

  const bodyLines: string[] = [
    "",
    `# Q: ${question}`,
    "",
    "## Answer",
    "",
    answer,
  ];
  if (sourceNodes && sourceNodes.length > 0) {
    bodyLines.push("", "## Source Nodes", "");
    for (const n of sourceNodes) {
      bodyLines.push(`- ${n}`);
    }
  }

  const content = [...frontmatterLines, ...bodyLines].join("\n");
  const outPath = path.join(memoryDir, filename);
  fs.writeFileSync(outPath, content, "utf-8");
  return outPath;
}

/** Format a Date as YYYYMMDD_HHMMSS for filename generation. */
function formatCompact(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
