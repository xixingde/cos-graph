// Intra-file slicing for oversized text documents.
//
// The extraction packer treats each file as atomic and caps every file at
// _FILE_CHAR_CAP characters, so a document larger than that cap had everything
// past the cap silently dropped. This module splits an oversized splittable
// text document (Markdown, plain text, reStructuredText) into contiguous
// FileSlice units at heading / paragraph / line boundaries so the whole file
// gets extracted across several units. Every slice of a file reports the parent
// file path as its source, so the resulting nodes are never fragmented
// per-slice — they merge by source_file exactly as if the file had been
// extracted in one pass.

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Plain-text document types where boundary-based slicing is meaningful and
// where _file_to_text is a straight readText (so a char range matches the
// bytes the model is shown). Deliberately excludes code (.py, .ts, ...) and
// binary docs (.pdf) — those are never sliced.
const _SPLITTABLE_TEXT_SUFFIXES: ReadonlySet<string> = new Set([
  ".md",
  ".mdx",
  ".markdown",
  ".txt",
  ".rst",
]);

// Boundary preferences, strongest first. A Markdown heading (\n#) keeps a
// section with its title; a blank line keeps a paragraph intact; a bare
// newline avoids cutting mid-line. If none is found in the window we hard-cut.
const _BOUNDARY_SEPARATORS = ["\n#", "\n\n", "\n"] as const;

// ---------------------------------------------------------------------------
// FileSlice
// ---------------------------------------------------------------------------

/** A contiguous [start, end) character range of a splittable text file.
 *
 * index/total are for logging only. path is the real file on disk;
 * the slice always reports path as its source so slices don't fragment the
 * graph. */
export interface FileSlice {
  path: string;
  start: number;
  end: number;
  index: number;
  total: number;
}

/** A unit of extraction work: either a whole file (string path) or one slice. */
export type Unit = string | FileSlice;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The on-disk path a unit belongs to (the parent file for a slice). */
export function unitPath(unit: Unit): string {
  return typeof unit === "string" ? unit : unit.path;
}

/** True for plain-text document types that may be sliced. */
export function isSplittableText(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return _SPLITTABLE_TEXT_SUFFIXES.has(ext);
}

/** Return a cut index in (start, end] at the strongest nearby boundary.
 *
 * Searches the window text[start:end] for the latest heading, then blank
 * line, then newline, and returns the index just after it (a heading cuts
 * just before the # so the heading leads the next slice). Falls back to a
 * hard cut at end when the window has no usable boundary. */
export function bestCut(
  text: string,
  start: number,
  end: number
): number {
  const window = text.slice(start, end);
  for (const sep of _BOUNDARY_SEPARATORS) {
    const idx = window.lastIndexOf(sep);
    if (idx > 0) {
      // a boundary strictly inside the window (non-empty prev slice)
      if (sep === "\n#") {
        return start + idx + 1; // keep the newline with the previous slice
      }
      return start + idx + sep.length;
    }
  }
  return end;
}

/** Contiguous [start, end) ranges covering all of text, each <= maxChars.
 *
 * Ranges are gap-free and non-overlapping, so concatenating the slices
 * reproduces text exactly — no content is dropped. */
export function sliceBoundaries(
  text: string,
  maxChars: number
): [number, number][] {
  const n = text.length;
  if (n <= maxChars) {
    return [[0, n]];
  }
  const bounds: [number, number][] = [];
  let pos = 0;
  while (pos < n) {
    const hard = Math.min(pos + maxChars, n);
    const end = hard < n ? bestCut(text, pos, hard) : n;
    let actualEnd = end;
    if (end <= pos) {
      // defensive: never stall
      actualEnd = hard;
    }
    bounds.push([pos, actualEnd]);
    pos = actualEnd;
  }
  return bounds;
}

/** Replace each oversized splittable-text file with a list of FileSlices.
 *
 * Files at or below maxChars (and all non-splittable files) pass through
 * unchanged as string, so behaviour is identical for everything that already
 * fit. Unreadable files pass through untouched (the reader handles the error). */
export function expandOversizedFiles(
  files: string[],
  maxChars: number
): Unit[] {
  const out: Unit[] = [];
  for (const f of files) {
    if (!isSplittableText(f)) {
      out.push(f);
      continue;
    }
    let text: string;
    try {
      text = fs.readFileSync(f, "utf-8");
    } catch {
      out.push(f);
      continue;
    }
    if (text.length <= maxChars) {
      out.push(f);
      continue;
    }
    const ranges = sliceBoundaries(text, maxChars);
    const total = ranges.length;
    for (let i = 0; i < ranges.length; i++) {
      const [s, e] = ranges[i];
      out.push({ path: f, start: s, end: e, index: i, total });
    }
  }
  return out;
}

/** Read just this slice's characters from its parent file. */
export function readSliceText(fslice: FileSlice): string {
  const text = fs.readFileSync(fslice.path, "utf-8");
  return text.slice(fslice.start, fslice.end);
}

/** Split a slice into two halves at a newline near its midpoint, or null.
 *
 * Used by the adaptive-retry path when a single slice still overflows the
 * model's output: halving it produces a smaller response. Returns null when
 * the slice is already too small to split meaningfully. */
export function bisectSlice(
  fslice: FileSlice
): [FileSlice, FileSlice] | null {
  if (fslice.end - fslice.start <= 1) {
    return null;
  }
  let text: string;
  try {
    text = fs.readFileSync(fslice.path, "utf-8");
  } catch {
    return null;
  }
  const mid = Math.floor((fslice.start + fslice.end) / 2);
  const nl = text.indexOf("\n", mid);
  let cut: number;
  if (nl !== -1 && fslice.start < nl + 1 && nl + 1 < fslice.end) {
    cut = nl + 1;
  } else {
    cut = mid;
  }
  if (!(fslice.start < cut && cut < fslice.end)) {
    return null;
  }
  const left: FileSlice = {
    path: fslice.path,
    start: fslice.start,
    end: cut,
    index: fslice.index,
    total: fslice.total,
  };
  const right: FileSlice = {
    path: fslice.path,
    start: cut,
    end: fslice.end,
    index: fslice.index,
    total: fslice.total,
  };
  return [left, right];
}
