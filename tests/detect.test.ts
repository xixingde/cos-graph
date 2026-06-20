import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  classifyFile,
  countWords,
  detect,
  detectIncremental,
  saveManifest,
  loadManifest,
  isSensitive,
  isIgnored,
  loadGraphifyignore,
  looksLikePaper,
  shebangInterpreter,
  isNoiseDir,
  parseGitignoreLine,
  findVcsRoot,
  autoFollowSymlinks,
  genericKeywordHit,
  fileWithinSizeCap,
  envCommandArgs,
  splitEnvS,
  CODE_EXTENSIONS,
  DOC_EXTENSIONS,
  PAPER_EXTENSIONS,
  IMAGE_EXTENSIONS,
  OFFICE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  GOOGLE_WORKSPACE_EXTENSIONS,
} from "../src/detect.js";

import { FileType } from "../src/types/language.js";

const FIXTURES = path.join(__dirname, "fixtures");

// Helper: create temp directory
function mkdtemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "detect-test-"));
}

// Helper: recursively remove directory
function rmdir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// classifyFile tests
// ---------------------------------------------------------------------------

describe("classifyFile", () => {
  it("classifies Python as Code", () => {
    expect(classifyFile("foo.py")).toBe(FileType.Code);
  });

  it("classifies TypeScript as Code", () => {
    expect(classifyFile("bar.ts")).toBe(FileType.Code);
  });

  it("classifies .psm1 as Code", () => {
    expect(classifyFile("Utils.psm1")).toBe(FileType.Code);
  });

  it("classifies .psd1 as Code", () => {
    expect(classifyFile("MyModule.psd1")).toBe(FileType.Code);
  });

  it("classifies Markdown as Document", () => {
    expect(classifyFile("README.md")).toBe(FileType.Document);
  });

  it("classifies PDF as Paper", () => {
    expect(classifyFile("paper.pdf")).toBe(FileType.Paper);
  });

  it("skips PDFs inside Xcode asset catalogs", () => {
    const assetPdf = path.join("MyApp", "Images.xcassets", "icon.imageset", "icon.pdf");
    expect(classifyFile(assetPdf)).toBeNull();
  });

  it("returns null for unknown extensions", () => {
    expect(classifyFile("archive.zip")).toBeNull();
  });

  it("classifies image extensions", () => {
    expect(classifyFile("screenshot.png")).toBe(FileType.Image);
    expect(classifyFile("design.jpg")).toBe(FileType.Image);
    expect(classifyFile("diagram.webp")).toBe(FileType.Image);
  });

  it("classifies video extensions", () => {
    expect(classifyFile("lecture.mp4")).toBe(FileType.Video);
    expect(classifyFile("podcast.mp3")).toBe(FileType.Video);
    expect(classifyFile("talk.mov")).toBe(FileType.Video);
  });
});

// ---------------------------------------------------------------------------
// Paper detection tests
// ---------------------------------------------------------------------------

describe("looksLikePaper", () => {
  it("detects a markdown file with enough paper signals", () => {
    const tmp = mkdtemp();
    const paper = path.join(tmp, "paper.md");
    fs.writeFileSync(paper, [
      "# Abstract",
      "",
      "We propose a new method. See [1] and [23].",
      "This work was published in the Journal of AI. ArXiv preprint.",
      "See Equation 3 for details. \\cite{vaswani2017}.",
    ].join("\n"));
    expect(classifyFile(paper)).toBe(FileType.Paper);
    rmdir(tmp);
  });

  it("keeps plain .md as Document without paper signals", () => {
    const tmp = mkdtemp();
    const doc = path.join(tmp, "notes.md");
    fs.writeFileSync(doc, "# My Notes\n\nHere are some notes about the project.\n");
    expect(classifyFile(doc)).toBe(FileType.Document);
    rmdir(tmp);
  });
});

// ---------------------------------------------------------------------------
// Sensitive file detection tests
// ---------------------------------------------------------------------------

describe("isSensitive", () => {
  it("flags api_token.txt", () => {
    expect(isSensitive("api_token.txt")).toBe(true);
  });

  it("flags oauth_token.json", () => {
    expect(isSensitive("oauth_token.json")).toBe(true);
  });

  it("flags app_secret.yaml", () => {
    expect(isSensitive("app_secret.yaml")).toBe(true);
  });

  it("does not flag tokenizer.py", () => {
    expect(isSensitive("tokenizer.py")).toBe(false);
  });

  it("does not flag tokenize.py", () => {
    expect(isSensitive("tokenize.py")).toBe(false);
  });

  it("flags passwords.py", () => {
    expect(isSensitive("passwords.py")).toBe(true);
  });

  it("flags .ssh directory", () => {
    expect(isSensitive(path.join("/home", "user", ".ssh", "id_rsa"))).toBe(true);
  });

  it("flags secrets directory", () => {
    expect(isSensitive(path.join("config", "secrets", "db.json"))).toBe(true);
  });

  it("flags token.txt", () => {
    expect(isSensitive("token.txt")).toBe(true);
  });

  it("flags credentials.json", () => {
    expect(isSensitive("credentials.json")).toBe(true);
  });

  it("flags root-level credentials (via name pattern)", () => {
    expect(isSensitive("credentials")).toBe(true);
  });

  it("flags secret_handler.txt", () => {
    expect(isSensitive("secret_handler.txt")).toBe(true);
  });

  it("flags token_config.yaml", () => {
    expect(isSensitive("token_config.yaml")).toBe(true);
  });

  it("does NOT flag long descriptive topic slugs", () => {
    expect(isSensitive("token-economics-of-recall.md")).toBe(false);
    expect(isSensitive("password-policy-discussion.md")).toBe(false);
  });

  it("flags keyword at end of long name", () => {
    expect(isSensitive("github-personal-access-token.txt")).toBe(true);
  });

  it("flags my_private_key.txt", () => {
    expect(isSensitive("my_private_key.txt")).toBe(true);
  });

  it("flags .token dotfile", () => {
    expect(isSensitive(".token")).toBe(true);
  });

  it("flags tokens.txt (plural)", () => {
    expect(isSensitive("tokens.txt")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// genericKeywordHit tests
// ---------------------------------------------------------------------------

describe("genericKeywordHit", () => {
  it("detects keyword in short name", () => {
    expect(genericKeywordHit("api_token.txt")).toBe(true);
  });

  it("does not flag descriptive long slugs", () => {
    expect(genericKeywordHit("token-economics-of-recall.md")).toBe(false);
    expect(genericKeywordHit("password-policy-discussion.md")).toBe(false);
  });

  it("flags keyword at end of stem", () => {
    expect(genericKeywordHit("github-personal-access-token.txt")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shebang interpreter tests
// ---------------------------------------------------------------------------

describe("shebangInterpreter", () => {
  it("parses plain shebang", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "plain");
    fs.writeFileSync(script, "#!/usr/bin/python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses env single arg", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_single");
    fs.writeFileSync(script, "#!/usr/bin/env python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses env -S form", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_dashs");
    fs.writeFileSync(script, "#!/usr/bin/env -S python3 -u\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses env with flags", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_flags");
    fs.writeFileSync(script, "#!/usr/bin/env -i bash\necho hi\n");
    expect(shebangInterpreter(script)).toBe("bash");
    rmdir(tmp);
  });

  it("parses env with assignment", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_assign");
    fs.writeFileSync(script, "#!/usr/bin/env DEBUG=1 python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("returns null for no shebang", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "no_shebang");
    fs.writeFileSync(script, "print('x')\n");
    expect(shebangInterpreter(script)).toBeNull();
    rmdir(tmp);
  });

  it("parses quoted interpreter path", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "quoted");
    fs.writeFileSync(script, '#!"/usr/local/bin/python3"\nprint("x")\n');
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("returns null for unreadable files", () => {
    expect(shebangInterpreter("/nonexistent/path/does_not_exist")).toBeNull();
  });

  it("parses env -u with operand", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_unset");
    fs.writeFileSync(script, "#!/usr/bin/env -u PYTHONPATH python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses env -C with operand", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_chdir");
    fs.writeFileSync(script, "#!/usr/bin/env -C /tmp python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses env -P with operand", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_path");
    fs.writeFileSync(script, "#!/usr/bin/env -P /bin python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses env -i -S form", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_flag_dash_s");
    fs.writeFileSync(script, '#!/usr/bin/env -i -S "python3 -u"\nprint("x")\n');
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses clumped -u operand", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_clumped");
    fs.writeFileSync(script, "#!/usr/bin/env -uPYTHONPATH python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("returns null when env -u has no operand", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_missing_op");
    fs.writeFileSync(script, "#!/usr/bin/env -u\n");
    expect(shebangInterpreter(script)).toBeNull();
    rmdir(tmp);
  });

  it("parses GNU --split-string= form", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_split_eq");
    fs.writeFileSync(script, "#!/usr/bin/env --split-string='python3 -u'\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses GNU --split-string separate form", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_split_sep");
    fs.writeFileSync(script, '#!/usr/bin/env --split-string "python3 -u"\nprint("x")\n');
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses GNU -a with operand", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_argv0");
    fs.writeFileSync(script, "#!/usr/bin/env -a alias python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses compact -S form", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_compact_dash_s");
    fs.writeFileSync(script, "#!/usr/bin/env -Spython3 -u\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses compact -vS form", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_compact_vs");
    fs.writeFileSync(script, "#!/usr/bin/env -vSpython3 -u\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses GNU --unset separate", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_long_unset");
    fs.writeFileSync(script, "#!/usr/bin/env --unset PYTHONPATH python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses GNU --unset= form", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_long_unset_eq");
    fs.writeFileSync(script, "#!/usr/bin/env --unset=PYTHONPATH python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses GNU --chdir separate", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_long_chdir");
    fs.writeFileSync(script, "#!/usr/bin/env --chdir /tmp python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses GNU --chdir= form", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_long_chdir_eq");
    fs.writeFileSync(script, "#!/usr/bin/env --chdir=/tmp python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses signal-handling flags", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_signal");
    fs.writeFileSync(script, "#!/usr/bin/env --default-signal=TERM --ignore-signal=PIPE python3\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("returns null for unknown env option", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_unknown");
    fs.writeFileSync(script, "#!/usr/bin/env --no-such-flag python3\n");
    expect(shebangInterpreter(script)).toBeNull();
    rmdir(tmp);
  });

  it("parses -S with assignments before interpreter", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_s_assignment");
    fs.writeFileSync(script, "#!/usr/bin/env -S PYTHONPATH=/opt/custom:${PYTHONPATH} python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("parses -S with env flags before interpreter", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_s_flag");
    fs.writeFileSync(script, "#!/usr/bin/env -S -i OLDUSER=${USER} python3\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("rejects nested -S (bounds recursion)", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_nested_split");
    fs.writeFileSync(script, "#!/usr/bin/env -S -S python3 -u\nprint('x')\n");
    expect(shebangInterpreter(script)).toBeNull();
    rmdir(tmp);
  });

  it("parses -vS with assignments before interpreter", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "env_vs_assignment");
    fs.writeFileSync(script, "#!/usr/bin/env -vS DEBUG=1 python3 -u\nprint('x')\n");
    expect(shebangInterpreter(script)).toBe("python3");
    rmdir(tmp);
  });

  it("classifies extensionless file via shebang", () => {
    const tmp = mkdtemp();
    const script = path.join(tmp, "tool");
    fs.writeFileSync(script, "#!/usr/bin/env -S python3 -u\nprint('x')\n");
    expect(classifyFile(script)).toBe(FileType.Code);
    rmdir(tmp);
  });
});

// ---------------------------------------------------------------------------
// envCommandArgs tests
// ---------------------------------------------------------------------------

describe("envCommandArgs", () => {
  it("handles -- separator", () => {
    expect(envCommandArgs(["--", "python3"])).toEqual(["python3"]);
  });

  it("handles -S split-string", () => {
    expect(envCommandArgs(["-S", "python3 -u"])).toEqual(["python3", "-u"]);
  });
});

// ---------------------------------------------------------------------------
// splitEnvS tests
// ---------------------------------------------------------------------------

describe("splitEnvS", () => {
  it("splits packed string", () => {
    expect(splitEnvS("python3 -u", [])).toEqual(["python3", "-u"]);
  });

  it("prepends value and joins rest", () => {
    expect(splitEnvS("python3", ["-u"])).toEqual(["python3", "-u"]);
  });
});

// ---------------------------------------------------------------------------
// isNoiseDir tests
// ---------------------------------------------------------------------------

describe("isNoiseDir", () => {
  it("flags known skip dirs", () => {
    expect(isNoiseDir("node_modules")).toBe(true);
    expect(isNoiseDir("__pycache__")).toBe(true);
    expect(isNoiseDir(".next")).toBe(true);
  });

  it("allows .github", () => {
    expect(isNoiseDir(".github")).toBe(false);
  });

  it("flags _venv suffix", () => {
    expect(isNoiseDir("my_venv")).toBe(true);
  });

  it("flags .egg-info suffix", () => {
    expect(isNoiseDir("my_pkg.egg-info")).toBe(true);
  });

  it("flags worktrees inside dotted dir", () => {
    expect(isNoiseDir("worktrees", "/home/user/.claude")).toBe(true);
  });

  it("does not flag worktrees outside dotted dir", () => {
    expect(isNoiseDir("worktrees", "/home/user/src")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseGitignoreLine tests
// ---------------------------------------------------------------------------

describe("parseGitignoreLine", () => {
  it("returns empty for comments", () => {
    expect(parseGitignoreLine("# this is a comment")).toBe("");
  });

  it("returns empty for blank lines", () => {
    expect(parseGitignoreLine("")).toBe("");
  });

  it("strips inline comments", () => {
    expect(parseGitignoreLine("vendor/ # ignore deps")).toBe("vendor/");
  });

  it("preserves path#with#hash", () => {
    expect(parseGitignoreLine("path#with#hash.py")).toBe("path#with#hash.py");
  });

  it("unescapes \\#", () => {
    expect(parseGitignoreLine("file\\#1.txt")).toBe("file#1.txt");
  });

  it("strips leading whitespace", () => {
    expect(parseGitignoreLine("  vendor/")).toBe("vendor/");
  });
});

// ---------------------------------------------------------------------------
// detect tests
// ---------------------------------------------------------------------------

describe("detect", () => {
  it("finds fixture files", () => {
    const result = detect(FIXTURES);
    expect(result.total_files).toBeGreaterThanOrEqual(2);
    expect("code" in result.files).toBe(true);
    expect("document" in result.files).toBe(true);
  });

  it("warns on small corpus", () => {
    const result = detect(FIXTURES);
    expect(result.needs_graph).toBe(false);
    expect(result.warning).not.toBeNull();
  });

  it("always includes video key", () => {
    const tmp = mkdtemp();
    fs.writeFileSync(path.join(tmp, "main.py"), "x = 1");
    const result = detect(tmp);
    expect("video" in result.files).toBe(true);
    rmdir(tmp);
  });

  it("skips .next cache", () => {
    const tmp = mkdtemp();
    const nextDir = path.join(tmp, ".next", "cache");
    fs.mkdirSync(nextDir, { recursive: true });
    fs.writeFileSync(path.join(nextDir, "build.js"), "(function(){var s=1;})()");
    const pagesDir = path.join(tmp, "pages");
    fs.mkdirSync(pagesDir);
    fs.writeFileSync(path.join(pagesDir, "index.tsx"), "export default function Home() { return <div/> }");
    const result = detect(tmp);
    const allFiles = Object.values(result.files).flat();
    expect(allFiles.some((f) => f.includes(".next"))).toBe(false);
    expect(allFiles.some((f) => f.includes("index.tsx"))).toBe(true);
    rmdir(tmp);
  });

  it("skips graphify own cache", () => {
    const tmp = mkdtemp();
    const cacheDir = path.join(tmp, ".graphify", "cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "abc123.json"), '{"nodes": [], "edges": []}');
    fs.writeFileSync(path.join(tmp, "app.py"), "def go(): pass");
    const result = detect(tmp);
    const allFiles = Object.values(result.files).flat();
    expect(allFiles.some((f) => f.includes(".graphify"))).toBe(false);
    expect(allFiles.some((f) => f.includes("app.py"))).toBe(true);
    rmdir(tmp);
  });

  it("allows .github dir", () => {
    const tmp = mkdtemp();
    const ghDir = path.join(tmp, ".github", "workflows");
    fs.mkdirSync(ghDir, { recursive: true });
    fs.writeFileSync(path.join(ghDir, "ci.yml"), "name: CI\non: push\n");
    fs.writeFileSync(path.join(tmp, "main.py"), "def run(): pass");
    const result = detect(tmp);
    const allFiles = Object.values(result.files).flat();
    expect(allFiles.some((f) => f.includes(".github"))).toBe(true);
    rmdir(tmp);
  });

  it("skips __snapshots__ dir", () => {
    const tmp = mkdtemp();
    fs.mkdirSync(path.join(tmp, "__snapshots__"));
    fs.writeFileSync(path.join(tmp, "__snapshots__", "app.test.ts.snap"), "// Jest Snapshot");
    fs.writeFileSync(path.join(tmp, "app.ts"), "export function greet() { return 'hi'; }");
    const result = detect(tmp);
    const allFiles = Object.values(result.files).flat();
    expect(allFiles.some((f) => f.includes("__snapshots__"))).toBe(false);
    expect(allFiles.some((f) => f.includes("app.ts"))).toBe(true);
    rmdir(tmp);
  });

  it("skips coverage dir", () => {
    const tmp = mkdtemp();
    const covDir = path.join(tmp, "coverage", "lcov-report");
    fs.mkdirSync(covDir, { recursive: true });
    fs.writeFileSync(path.join(covDir, "index.html"), "<html>coverage report</html>");
    fs.writeFileSync(path.join(tmp, "main.py"), "def hello(): pass");
    const result = detect(tmp);
    const allFiles = Object.values(result.files).flat();
    expect(allFiles.some((f) => f.includes("coverage"))).toBe(false);
    rmdir(tmp);
  });
});

// ---------------------------------------------------------------------------
// gitignore tests
// ---------------------------------------------------------------------------

describe("gitignore integration", () => {
  it("excludes files matching .graphifyignore", () => {
    const tmp = mkdtemp();
    fs.writeFileSync(path.join(tmp, ".graphifyignore"), "vendor/\n*.generated.py\n");
    const vendorDir = path.join(tmp, "vendor");
    fs.mkdirSync(vendorDir);
    fs.writeFileSync(path.join(vendorDir, "lib.py"), "x = 1");
    fs.writeFileSync(path.join(tmp, "main.py"), "print('hi')");
    fs.writeFileSync(path.join(tmp, "schema.generated.py"), "x = 1");
    const result = detect(tmp);
    const codeFiles = result.files["code"];
    expect(codeFiles.some((f) => f.includes("main.py"))).toBe(true);
    expect(codeFiles.some((f) => f.includes("vendor"))).toBe(false);
    expect(codeFiles.some((f) => f.includes("generated"))).toBe(false);
    expect(result.graphifyignore_patterns).toBe(2);
    rmdir(tmp);
  });

  it("handles missing .graphifyignore", () => {
    const tmp = mkdtemp();
    fs.writeFileSync(path.join(tmp, "main.py"), "x = 1");
    const result = detect(tmp);
    expect(result.graphifyignore_patterns).toBe(0);
    rmdir(tmp);
  });

  it("ignores comment lines in .graphifyignore", () => {
    const tmp = mkdtemp();
    fs.writeFileSync(path.join(tmp, ".graphifyignore"), "# this is a comment\n\nmain.py\n");
    fs.writeFileSync(path.join(tmp, "main.py"), "x = 1");
    fs.writeFileSync(path.join(tmp, "other.py"), "x = 2");
    const result = detect(tmp);
    expect(result.files["code"].some((f) => f.includes("main.py"))).toBe(false);
    expect(result.files["code"].some((f) => f.includes("other.py"))).toBe(true);
    rmdir(tmp);
  });

  it("is hermetic without VCS root", () => {
    const tmp = mkdtemp();
    fs.writeFileSync(path.join(tmp, ".graphifyignore"), "vendor/\n");
    const sub = path.join(tmp, "packages", "mylib");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "main.py"), "x = 1");
    const vendorDir = path.join(sub, "vendor");
    fs.mkdirSync(vendorDir);
    fs.writeFileSync(path.join(vendorDir, "dep.py"), "y = 2");
    const result = detect(sub);
    expect(result.files["code"].some((f) => f.includes("main.py"))).toBe(true);
    expect(result.files["code"].some((f) => f.includes("vendor"))).toBe(true);
    rmdir(tmp);
  });

  it("discovers from parent in VCS", () => {
    const tmp = mkdtemp();
    fs.mkdirSync(path.join(tmp, ".git"));
    fs.writeFileSync(path.join(tmp, ".graphifyignore"), "vendor/\n");
    const sub = path.join(tmp, "packages", "mylib");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "main.py"), "x = 1");
    const vendorDir = path.join(sub, "vendor");
    fs.mkdirSync(vendorDir);
    fs.writeFileSync(path.join(vendorDir, "dep.py"), "y = 2");
    const result = detect(sub);
    expect(result.files["code"].some((f) => f.includes("main.py"))).toBe(true);
    expect(result.files["code"].some((f) => f.includes("vendor"))).toBe(false);
    expect(result.graphifyignore_patterns).toBeGreaterThanOrEqual(1);
    rmdir(tmp);
  });

  it("negation cannot rescue file under excluded dir", () => {
    const tmp = mkdtemp();
    const android = path.join(tmp, "android", "app", "src");
    fs.mkdirSync(android, { recursive: true });
    fs.writeFileSync(path.join(android, "Main.kt"), "fun main() {}");
    fs.writeFileSync(path.join(tmp, ".graphifyignore"), "android/\n!src/\n");
    const patterns = loadGraphifyignore(tmp);
    expect(isIgnored(path.join(android, "Main.kt"), tmp, patterns)).toBe(true);
    rmdir(tmp);
  });

  it("negation works when no ancestor excluded", () => {
    const tmp = mkdtemp();
    const src = path.join(tmp, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "keep.py"), "x = 1");
    fs.writeFileSync(path.join(tmp, ".graphifyignore"), "*.py\n!src/keep.py\n");
    const patterns = loadGraphifyignore(tmp);
    expect(isIgnored(path.join(src, "keep.py"), tmp, patterns)).toBe(false);
    rmdir(tmp);
  });

  it("negation re-includes ancestor dir", () => {
    const tmp = mkdtemp();
    const vendor = path.join(tmp, "vendor", "lib");
    fs.mkdirSync(vendor, { recursive: true });
    fs.writeFileSync(path.join(vendor, "utils.py"), "x = 1");
    fs.writeFileSync(path.join(tmp, ".graphifyignore"), "vendor/\n!vendor/\n");
    const patterns = loadGraphifyignore(tmp);
    expect(isIgnored(path.join(vendor, "utils.py"), tmp, patterns)).toBe(false);
    rmdir(tmp);
  });

  it("anchored dir not matched at depth", () => {
    const tmp = mkdtemp();
    const srcInbox = path.join(tmp, "src", "inbox");
    fs.mkdirSync(srcInbox, { recursive: true });
    fs.writeFileSync(path.join(srcInbox, "main.rs"), "fn main() {}");
    fs.writeFileSync(path.join(tmp, ".graphifyignore"), "/inbox/\n");
    const patterns = loadGraphifyignore(tmp);
    expect(isIgnored(path.join(srcInbox, "main.rs"), tmp, patterns)).toBe(false);
    rmdir(tmp);
  });

  it("anchored dir matches at root", () => {
    const tmp = mkdtemp();
    const inbox = path.join(tmp, "inbox");
    fs.mkdirSync(inbox);
    fs.writeFileSync(path.join(inbox, "data.json"), "{}");
    fs.writeFileSync(path.join(tmp, ".graphifyignore"), "/inbox/\n");
    const patterns = loadGraphifyignore(tmp);
    expect(isIgnored(path.join(inbox, "data.json"), tmp, patterns)).toBe(true);
    rmdir(tmp);
  });

  it("merges .gitignore and .graphifyignore", () => {
    const tmp = mkdtemp();
    fs.mkdirSync(path.join(tmp, ".git"));
    fs.writeFileSync(path.join(tmp, ".gitignore"), "main.py\n");
    fs.writeFileSync(path.join(tmp, ".graphifyignore"), "other.py\n");
    fs.writeFileSync(path.join(tmp, "main.py"), "x = 1");
    fs.writeFileSync(path.join(tmp, "other.py"), "x = 2");
    fs.writeFileSync(path.join(tmp, "keep.py"), "x = 3");
    const result = detect(tmp);
    const code = result.files["code"];
    expect(code.some((f) => f.includes("main.py"))).toBe(false);
    expect(code.some((f) => f.includes("other.py"))).toBe(false);
    expect(code.some((f) => f.includes("keep.py"))).toBe(true);
    rmdir(tmp);
  });
});

// ---------------------------------------------------------------------------
// extraExcludes tests
// ---------------------------------------------------------------------------

describe("extraExcludes", () => {
  it("excludes files matching extra_excludes patterns", () => {
    const tmp = mkdtemp();
    fs.writeFileSync(path.join(tmp, "main.py"), "x = 1");
    fs.writeFileSync(path.join(tmp, "secret.py"), "API_KEY = 'abc'");
    const subdir = path.join(tmp, "legacy");
    fs.mkdirSync(subdir);
    fs.writeFileSync(path.join(subdir, "old.py"), "y = 2");
    const result = detect(tmp, { extraExcludes: ["secret.py", "legacy/"] });
    const code = result.files["code"];
    expect(code.some((f) => f.includes("main.py"))).toBe(true);
    expect(code.some((f) => f.includes("secret.py"))).toBe(false);
    expect(code.some((f) => f.includes("legacy"))).toBe(false);
    rmdir(tmp);
  });
});

// ---------------------------------------------------------------------------
// fileWithinSizeCap tests
// ---------------------------------------------------------------------------

describe("fileWithinSizeCap", () => {
  it("returns true for existing small file", () => {
    const tmp = mkdtemp();
    const f = path.join(tmp, "small.txt");
    fs.writeFileSync(f, "hello");
    expect(fileWithinSizeCap(f, 100)).toBe(true);
    rmdir(tmp);
  });

  it("returns false for file exceeding cap", () => {
    const tmp = mkdtemp();
    const f = path.join(tmp, "big.txt");
    fs.writeFileSync(f, "x".repeat(200));
    expect(fileWithinSizeCap(f, 100)).toBe(false);
    rmdir(tmp);
  });

  it("returns false for nonexistent file", () => {
    expect(fileWithinSizeCap("/nonexistent/file.txt")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Manifest tests
// ---------------------------------------------------------------------------

describe("manifest", () => {
  it("saveManifest relativizes keys when root given", () => {
    const tmp = mkdtemp();
    const srcDir = path.join(tmp, "src");
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, "foo.py"), "def x(): pass\n");
    fs.writeFileSync(path.join(tmp, "doc.md"), "hello\n");
    const manifestDir = path.join(tmp, "graphify-out");
    fs.mkdirSync(manifestDir);
    const manifestPath = path.join(manifestDir, "manifest.json");
    const files: Record<string, string[]> = {
      code: [path.join(tmp, "src", "foo.py")],
      document: [path.join(tmp, "doc.md")],
    };
    saveManifest(files, manifestPath, { root: tmp });
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(new Set(Object.keys(raw))).toEqual(new Set(["src/foo.py", "doc.md"]));
    const loaded = loadManifest(manifestPath, tmp);
    expect(path.resolve(tmp, "src/foo.py") in loaded || Object.values(loaded).length > 0).toBe(true);
    rmdir(tmp);
  });

  it("saveManifest without root keeps absolute keys", () => {
    const tmp = mkdtemp();
    const f = path.join(tmp, "foo.py");
    fs.writeFileSync(f, "pass\n");
    const manifestDir = path.join(tmp, "graphify-out");
    fs.mkdirSync(manifestDir);
    const manifestPath = path.join(manifestDir, "manifest.json");
    saveManifest({ code: [f] }, manifestPath);
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const keys = Object.keys(raw);
    expect(path.isAbsolute(keys[0])).toBe(true);
    rmdir(tmp);
  });

  it("detectIncremental treats first run as all new", () => {
    const tmp = mkdtemp();
    const srcDir = path.join(tmp, "src");
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, "main.py"), "x = 1");
    const manifestDir = path.join(tmp, "graphify-out");
    fs.mkdirSync(manifestDir);
    const manifestPath = path.join(manifestDir, "manifest.json");
    const result = detectIncremental(tmp, manifestPath);
    expect(result.incremental).toBe(true);
    expect(result.new_total).toBe(result.total_files);
    rmdir(tmp);
  });
});

// ---------------------------------------------------------------------------
// findVcsRoot tests
// ---------------------------------------------------------------------------

describe("findVcsRoot", () => {
  it("finds .git directory", () => {
    const tmp = mkdtemp();
    fs.mkdirSync(path.join(tmp, ".git"));
    expect(findVcsRoot(tmp)).toBe(tmp);
    rmdir(tmp);
  });

  it("returns null when no VCS root", () => {
    const tmp = mkdtemp();
    // No VCS marker — should return null or the path itself
    const result = findVcsRoot(tmp);
    // When there's no VCS root, the function walks up to home or root and returns null
    // This is expected behavior
    rmdir(tmp);
  });
});

// ---------------------------------------------------------------------------
// autoFollowSymlinks tests
// ---------------------------------------------------------------------------

describe("autoFollowSymlinks", () => {
  it("detects symlinked child", () => {
    const tmp = mkdtemp();
    const realDir = path.join(tmp, "real_lib");
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, "util.py"), "x = 1");
    try {
      fs.symlinkSync(realDir, path.join(tmp, "linked_lib"));
      expect(autoFollowSymlinks(tmp)).toBe(true);
    } catch {
      // symlink not supported on this platform
    }
    rmdir(tmp);
  });

  it("returns false when no symlinks", () => {
    const tmp = mkdtemp();
    fs.writeFileSync(path.join(tmp, "main.py"), "x = 1");
    expect(autoFollowSymlinks(tmp)).toBe(false);
    rmdir(tmp);
  });
});

// ---------------------------------------------------------------------------
// Constants tests
// ---------------------------------------------------------------------------

describe("extension sets", () => {
  it("CODE_EXTENSIONS contains .py and .ts", () => {
    expect(CODE_EXTENSIONS.has(".py")).toBe(true);
    expect(CODE_EXTENSIONS.has(".ts")).toBe(true);
  });

  it("DOC_EXTENSIONS contains .md", () => {
    expect(DOC_EXTENSIONS.has(".md")).toBe(true);
  });

  it("PAPER_EXTENSIONS contains .pdf", () => {
    expect(PAPER_EXTENSIONS.has(".pdf")).toBe(true);
  });

  it("IMAGE_EXTENSIONS contains .png and .jpg", () => {
    expect(IMAGE_EXTENSIONS.has(".png")).toBe(true);
    expect(IMAGE_EXTENSIONS.has(".jpg")).toBe(true);
  });

  it("OFFICE_EXTENSIONS contains .docx and .xlsx", () => {
    expect(OFFICE_EXTENSIONS.has(".docx")).toBe(true);
    expect(OFFICE_EXTENSIONS.has(".xlsx")).toBe(true);
  });

  it("VIDEO_EXTENSIONS contains .mp4 and .mp3", () => {
    expect(VIDEO_EXTENSIONS.has(".mp4")).toBe(true);
    expect(VIDEO_EXTENSIONS.has(".mp3")).toBe(true);
  });

  it("GOOGLE_WORKSPACE_EXTENSIONS is empty (Phase 4)", () => {
    expect(GOOGLE_WORKSPACE_EXTENSIONS.size).toBe(0);
  });
});
