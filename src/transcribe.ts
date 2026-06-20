// Video transcription using CLI whisper
// Converts video/audio files to text transcripts for graph extraction
import * as child_process from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { validateUrl } from "./security.js";

export const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v",
  ".mp3", ".wav", ".m4a", ".ogg",
]);

export const URL_PREFIXES = ["http://", "https://", "www."] as const;

export const DEFAULT_MODEL = "base";
export const TRANSCRIPTS_DIR = "graphify-out/transcripts";
export const FALLBACK_PROMPT = "Use proper punctuation and paragraph breaks.";

/** Return the Whisper model name from env or default. */
function modelName(): string {
  return process.env.GRAPHIFY_WHISPER_MODEL || DEFAULT_MODEL;
}

/** Return True if the string looks like a URL rather than a file path. */
export function isUrl(p: string): boolean {
  return URL_PREFIXES.some(prefix => p.startsWith(prefix));
}

/**
  Download audio-only stream from a URL using yt-dlp.

  Returns the path to the downloaded audio file (.m4a or .opus).
  Uses cached file if already downloaded.
*/
export function downloadAudio(url: string, outputDir: string): string {
  validateUrl(url);
  fs.mkdirSync(outputDir, { recursive: true });

  const urlHash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
  const baseName = `yt_${urlHash}`;

  // Check for already-downloaded file
  for (const ext of [".m4a", ".opus", ".mp3", ".ogg", ".wav", ".webm"]) {
    const candidate = path.join(outputDir, `${baseName}${ext}`);
    if (fs.existsSync(candidate)) {
      console.log(`  cached audio: ${path.basename(candidate)}`);
      return candidate;
    }
  }

  const outTemplate = path.join(outputDir, `${baseName}.%(ext)s`);

  console.log(`  downloading audio: ${url.slice(0, 80)} ...`);

  const ytDlpPath = findExecutable("yt-dlp");
  child_process.execFileSync(
    ytDlpPath,
    [
      "--format", "bestaudio[ext=m4a]/bestaudio/best",
      "--output", outTemplate,
      "--quiet",
      "--no-warnings",
      "--no-playlist",
      url,
    ],
    { encoding: "utf-8", timeout: 300_000 },
  );

  // Find the downloaded file
  for (const ext of [".m4a", ".opus", ".mp3", ".ogg", ".wav", ".webm"]) {
    const candidate = path.join(outputDir, `${baseName}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Fallback: glob for any file with the base name
  const entries = fs.readdirSync(outputDir);
  for (const entry of entries) {
    if (entry.startsWith(baseName) && entry !== baseName) {
      return path.join(outputDir, entry);
    }
  }

  throw new Error(`yt-dlp download completed but output file not found in ${outputDir}`);
}

/** Build a domain hint for Whisper from god nodes. */
export function buildWhisperPrompt(godNodes: Array<Record<string, any>>): string {
  if (!godNodes || godNodes.length === 0) return FALLBACK_PROMPT;

  const override = process.env.GRAPHIFY_WHISPER_PROMPT;
  if (override) return override;

  const labels = godNodes.slice(0, 10)
    .map(n => n.label || "")
    .filter(l => l);
  if (labels.length === 0) return FALLBACK_PROMPT;

  const topics = labels.slice(0, 5).join(", ");
  return `Technical discussion about ${topics}. Use proper punctuation and paragraph breaks.`;
}

/** Find an executable on PATH. */
function findExecutable(name: string): string {
  const pathEnv = process.env.PATH || "";
  const isWin = process.platform === "win32";
  const suffixes = isWin ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathEnv.split(isWin ? ";" : ":")) {
    for (const suffix of suffixes) {
      const candidate = path.join(dir, name + suffix);
      try {
        if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
          return candidate;
        }
      } catch { continue; }
    }
  }
  throw new Error(`${name} not found on PATH`);
}

/**
  Transcribe a video/audio file or URL to a .txt transcript.

  If videoPath is a URL, audio is downloaded first via yt-dlp.
  Returns the path to the saved transcript file.
  Uses cached transcript if it exists unless force=true.
*/
export function transcribe(
  videoPath: string,
  outputDir?: string,
  initialPrompt?: string,
  force: boolean = false,
): string {
  const outDir = outputDir || TRANSCRIPTS_DIR;
  fs.mkdirSync(outDir, { recursive: true });

  let audioPath: string;
  if (isUrl(videoPath)) {
    audioPath = downloadAudio(videoPath, path.join(outDir, "downloads"));
  } else {
    audioPath = videoPath;
  }

  const transcriptPath = path.join(outDir, path.basename(audioPath, path.extname(audioPath)) + ".txt");
  if (fs.existsSync(transcriptPath) && !force) return transcriptPath;

  const whisperPath = findExecutable("whisper");
  const model = modelName();
  const prompt = initialPrompt || FALLBACK_PROMPT;

  console.log(`  transcribing ${path.basename(audioPath)} (model=${model}) ...`);

  const tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-"));

  try {
    child_process.execFileSync(
      whisperPath,
      [
        audioPath,
        "--model", model,
        "--output_format", "txt",
        "--output_dir", tmpOutDir,
        "--beam_size", "5",
        "--initial_prompt", prompt,
      ],
      { encoding: "utf-8", timeout: 600_000 },
    );
  } catch (exc: any) {
    throw new Error(`whisper transcription failed: ${exc?.message || exc}`);
  }

  // Whisper outputs <stem>.txt in the output dir
  const stem = path.basename(audioPath, path.extname(audioPath));
  const whisperOutput = path.join(tmpOutDir, `${stem}.txt`);
  let transcript = "";
  if (fs.existsSync(whisperOutput)) {
    transcript = fs.readFileSync(whisperOutput, "utf-8");
  }

  // Clean up temp dir
  try {
    fs.rmSync(tmpOutDir, { recursive: true, force: true });
  } catch {}

  const lines = transcript.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const finalTranscript = lines.join("\n");

  fs.writeFileSync(transcriptPath, finalTranscript, "utf-8");
  console.log(`  transcript saved -> ${transcriptPath} (${lines.length} segments)`);
  return transcriptPath;
}

/**
  Transcribe a list of video/audio files or URLs, return paths to transcript .txt files.

  Already-transcribed files are returned from cache instantly.
  initialPrompt is shared across all files -- built once from corpus god nodes.
*/
export function transcribeAll(
  videoFiles: string[],
  outputDir?: string,
  initialPrompt?: string,
): string[] {
  if (!videoFiles || videoFiles.length === 0) return [];

  const transcriptPaths: string[] = [];
  for (const vf of videoFiles) {
    try {
      const t = transcribe(vf, outputDir, initialPrompt);
      transcriptPaths.push(t);
    } catch (exc: any) {
      console.log(`  warning: could not transcribe ${vf}: ${exc?.message || exc}`);
    }
  }
  return transcriptPaths;
}
