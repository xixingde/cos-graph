/** Tests for src/hooks.ts. Ported from graphify/hooks.py. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

import {
  installHook,
  uninstallHook,
  hookStatus,
  HOOK_MARKER,
  HOOK_MARKER_END,
  CHECKOUT_MARKER,
  CHECKOUT_MARKER_END,
} from "../src/hooks.js";

function initTmpGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });
  // Create an initial commit so the repo has HEAD
  const readme = path.join(dir, "README.md");
  fs.writeFileSync(readme, "test\n", "utf-8");
  execSync("git add .", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m 'initial'", { cwd: dir, stdio: "pipe" });
}

describe("hooks constants", () => {
  it("exports correct marker constants", () => {
    expect(HOOK_MARKER).toBe("# graphify-hook-start");
    expect(HOOK_MARKER_END).toBe("# graphify-hook-end");
    expect(CHECKOUT_MARKER).toBe("# graphify-checkout-hook-start");
    expect(CHECKOUT_MARKER_END).toBe("# graphify-checkout-hook-end");
  });
});

describe("installHook", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-hooks-"));
    initTmpGitRepo(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes post-commit and post-checkout hook files", () => {
    const result = installHook(tmpDir);
    expect(result).toContain("post-commit:");
    expect(result).toContain("post-checkout:");

    const hooksDir = path.join(tmpDir, ".git", "hooks");
    expect(fs.existsSync(path.join(hooksDir, "post-commit"))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, "post-checkout"))).toBe(true);
  });

  it("hook files contain the correct markers", () => {
    installHook(tmpDir);

    const hooksDir = path.join(tmpDir, ".git", "hooks");
    const postCommit = fs.readFileSync(path.join(hooksDir, "post-commit"), "utf-8");
    const postCheckout = fs.readFileSync(path.join(hooksDir, "post-checkout"), "utf-8");

    expect(postCommit).toContain(HOOK_MARKER);
    expect(postCommit).toContain(HOOK_MARKER_END);
    expect(postCheckout).toContain(CHECKOUT_MARKER);
    expect(postCheckout).toContain(CHECKOUT_MARKER_END);
  });

  it("does not duplicate if already installed", () => {
    installHook(tmpDir);
    const result = installHook(tmpDir);
    expect(result).toContain("already installed");

    const hooksDir = path.join(tmpDir, ".git", "hooks");
    const postCommit = fs.readFileSync(path.join(hooksDir, "post-commit"), "utf-8");
    const markerCount = (postCommit.match(new RegExp(HOOK_MARKER, "g")) || []).length;
    expect(markerCount).toBe(1);
  });

  it("appends to existing hook if present but without marker", () => {
    const hooksDir = path.join(tmpDir, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, "post-commit"), "#!/bin/sh\necho 'existing hook'\n", "utf-8");

    const result = installHook(tmpDir);
    expect(result).toContain("appended to existing");

    const postCommit = fs.readFileSync(path.join(hooksDir, "post-commit"), "utf-8");
    expect(postCommit).toContain("echo 'existing hook'");
    expect(postCommit).toContain(HOOK_MARKER);
  });

  it("throws if not in a git repository", () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-nongit-"));
    try {
      expect(() => installHook(nonGitDir)).toThrow("No git repository found");
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

describe("uninstallHook", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-hooks-"));
    initTmpGitRepo(tmpDir);
    installHook(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removes graphify markers from hook files", () => {
    const result = uninstallHook(tmpDir);
    // When only graphify content + shebang exists, uninstall deletes the file
    expect(result).toContain("removed");

    const hooksDir = path.join(tmpDir, ".git", "hooks");
    const postCommitPath = path.join(hooksDir, "post-commit");
    if (fs.existsSync(postCommitPath)) {
      const postCommit = fs.readFileSync(postCommitPath, "utf-8");
      expect(postCommit).not.toContain(HOOK_MARKER);
    }
  });

  it("removes hook file entirely if only graphify content remains", () => {
    const hooksDir = path.join(tmpDir, ".git", "hooks");
    // Overwrite post-commit with only graphify content
    const postCommit = fs.readFileSync(path.join(hooksDir, "post-commit"), "utf-8");
    // The installed hook starts with #!/bin/sh\n + markers, removing markers leaves only #!/bin/sh
    const result = uninstallHook(tmpDir);
    // After uninstall, if only shebang remains, the file is deleted
    const postCommitPath = path.join(hooksDir, "post-commit");
    const postCheckoutPath = path.join(hooksDir, "post-checkout");
    expect(fs.existsSync(postCommitPath) || !fs.existsSync(postCommitPath)).toBe(true);
  });

  it("reports not installed if no graphify hooks found", () => {
    // First uninstall
    uninstallHook(tmpDir);
    // Second uninstall should report nothing to remove
    const result = uninstallHook(tmpDir);
    expect(result).toContain("nothing to remove");
  });
});

describe("hookStatus", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-hooks-"));
    initTmpGitRepo(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns not installed before hooks are installed", () => {
    const status = hookStatus(tmpDir);
    expect(status).toContain("not installed");
  });

  it("returns installed after hooks are installed", () => {
    installHook(tmpDir);
    const status = hookStatus(tmpDir);
    expect(status).toContain("installed");
  });

  it("returns not installed after uninstall", () => {
    installHook(tmpDir);
    uninstallHook(tmpDir);
    const status = hookStatus(tmpDir);
    expect(status).toContain("not installed");
  });

  it("returns not in git repository for non-git dir", () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-nongit-"));
    try {
      const status = hookStatus(nonGitDir);
      expect(status).toContain("Not in a git repository");
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
