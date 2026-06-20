/** Git hook integration — install/uninstall graphify post-commit and post-checkout hooks. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

export const HOOK_MARKER = "# graphify-hook-start";
export const HOOK_MARKER_END = "# graphify-hook-end";
export const CHECKOUT_MARKER = "# graphify-checkout-hook-start";
export const CHECKOUT_MARKER_END = "# graphify-checkout-hook-end";

const _NODE_DETECT = [
  "# Detect the correct Node.js interpreter (handles npx, global, nvm installs).",
  'GRAPHIFY_NODE=""',
  "_PINNED='__PINNED_NODE__'",
  'if [ -n "$_PINNED" ] && [ -x "$_PINNED" ]; then',
  '    GRAPHIFY_NODE="$_PINNED"',
  "fi",
  "# Second probe: read graphify-out/.graphify_node (written by CLI).",
  'if [ -z "$GRAPHIFY_NODE" ]; then',
  '    _GFY_NODE_FILE="graphify-out/.graphify_node"',
  '    if [ -f "$_GFY_NODE_FILE" ]; then',
  '        _FROM_FILE=$(cat "$_GFY_NODE_FILE" 2>/dev/null | tr -d \'[:space:]\')',
  "        case \"$_FROM_FILE\" in",
  "            *[!a-zA-Z0-9/_.@:\\\\-]*) _FROM_FILE=\"\" ;;",
  "        esac",
  '        if [ -n "$_FROM_FILE" ] && [ -x "$_FROM_FILE" ]; then',
  '            GRAPHIFY_NODE="$_FROM_FILE"',
  "        fi",
  "    fi",
  "fi",
  "# Third probe: resolve via the graphify launcher on PATH.",
  'if [ -z "$GRAPHIFY_NODE" ]; then',
  "    GRAPHIFY_BIN=$(command -v graphify 2>/dev/null)",
  '    if [ -n "$GRAPHIFY_BIN" ]; then',
  "        case \"$GRAPHIFY_BIN\" in",
  '            *.exe) _SHEBANG="" ;;',
  '            *)     _SHEBANG=$(head -1 "$GRAPHIFY_BIN" | sed \'s/^#![[:space:]]*//\' ) ;;',
  "        esac",
  "        case \"$_SHEBANG\" in",
  "            */env\\\\ *) GRAPHIFY_NODE=\"${_SHEBANG#*/env }\" ;;",
  '            *)         GRAPHIFY_NODE="$_SHEBANG" ;;',
  "        esac",
  "        case \"$GRAPHIFY_NODE\" in",
  "            *[!a-zA-Z0-9/_.@-]*) GRAPHIFY_NODE=\"\" ;;",
  "        esac",
  '        if [ -n "$GRAPHIFY_NODE" ] && ! "$GRAPHIFY_NODE" -e "true" 2>/dev/null; then',
  '            GRAPHIFY_NODE=""',
  "        fi",
  "    fi",
  "fi",
  "# Last resort: try node (works for system/nvm installs on PATH).",
  'if [ -z "$GRAPHIFY_NODE" ]; then',
  '    if command -v node >/dev/null 2>&1; then',
  '        GRAPHIFY_NODE="node"',
  "    else",
  '        echo "[graphify hook] could not locate Node.js. Add the graphify bin dir to PATH or re-run \'graphify hook install\'." >&2',
  "        exit 0",
  "    fi",
  "fi",
].join("\n");

const _REBUILD_BODY_COMMIT = [
  "const { execSync } = require('child_process');",
  "const path = require('path');",
  "const fs = require('fs');",
  "",
  "const changedRaw = process.env.GRAPHIFY_CHANGED || '';",
  "const changed = changedRaw.trim().split(/\\\\r?\\\\n/).filter(f => f.trim());",
  "",
  "if (changed.length === 0) {",
  "    process.exit(0);",
  "}",
  "",
  "console.log('[graphify hook] ' + changed.length + ' file(s) changed - rebuilding graph...');",
  "",
  "try {",
  "    const force = ['1','true','yes'].includes((process.env.GRAPHIFY_FORCE || '').toLowerCase());",
  "    let root = '.';",
  "    const saved = path.join('.', 'graphify-out', '.graphify_root');",
  "    if (fs.existsSync(saved)) {",
  "        const txt = fs.readFileSync(saved, 'utf-8').trim();",
  "        if (txt) root = txt;",
  "    }",
  "    const changedPathsArg = changed.join('\\\\n');",
  "    const cmd = 'npx graphify update --changed-paths ' + JSON.stringify(changedPathsArg) + (force ? ' --force' : '');",
  "    execSync(cmd, { cwd: root, stdio: 'inherit', timeout: 600000 });",
  "} catch (err) {",
  "    console.error('[graphify hook] Rebuild failed: ' + (err && err.message ? err.message : err));",
  "    process.exit(1);",
  "}",
].join("\\n");

const _REBUILD_BODY_CHECKOUT = [
  "const { execSync } = require('child_process');",
  "const path = require('path');",
  "const fs = require('fs');",
  "",
  "try {",
  "    const force = ['1','true','yes'].includes((process.env.GRAPHIFY_FORCE || '').toLowerCase());",
  "    let root = '.';",
  "    const saved = path.join('.', 'graphify-out', '.graphify_root');",
  "    if (fs.existsSync(saved)) {",
  "        const txt = fs.readFileSync(saved, 'utf-8').trim();",
  "        if (txt) root = txt;",
  "    }",
  "    const cmd = 'npx graphify update' + (force ? ' --force' : '');",
  "    execSync(cmd, { cwd: root, stdio: 'inherit', timeout: 600000 });",
  "} catch (err) {",
  "    console.error('[graphify] Rebuild failed: ' + (err && err.message ? err.message : err));",
  "    process.exit(1);",
  "}",
].join("\\n");

const _LAUNCHER_TEMPLATE = [
  "const { spawn } = require('child_process');",
  "const os = require('os');",
  "const fs = require('fs');",
  "const path = require('path');",
  "const _src = '__REBUILD_BODY__';",
  "const _log = process.env.GRAPHIFY_REBUILD_LOG || path.join(os.homedir(), '.cache', 'graphify-rebuild.log');",
  "try {",
  "    fs.mkdirSync(path.dirname(_log), { recursive: true });",
  "} catch (_) {}",
  "let _out = 'pipe';",
  "try {",
  "    _out = fs.openSync(_log, 'a');",
  "} catch (_) {}",
  "const _cmd = [process.execPath, '-e', _src];",
  "const _opts = { cwd: process.cwd(), stdio: ['ignore', _out, _out], detached: true };",
  "const _child = spawn(_cmd[0], _cmd.slice(1), _opts);",
  "if (typeof _child.unref === 'function') _child.unref();",
].join("\\n");

function _detachedLaunch(rebuildBody: string): string {
  const escapedBody = rebuildBody.replace(/'/g, "'\\''");
  const launcher = _LAUNCHER_TEMPLATE.replace("__REBUILD_BODY__", escapedBody);
  return '"$GRAPHIFY_NODE" -e \'' + launcher + "'\n";
}

const _HOOK_SCRIPT =
  HOOK_MARKER +
  "\n" +
  [
    "# Auto-rebuilds the knowledge graph after each commit (code files only, no LLM needed).",
    "# Installed by: graphify hook install",
    "",
    "# Skip during rebase/merge/cherry-pick",
    "GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)",
    '[ -d "$GIT_DIR/rebase-merge" ] && exit 0',
    '[ -d "$GIT_DIR/rebase-apply" ] && exit 0',
    '[ -f "$GIT_DIR/MERGE_HEAD" ] && exit 0',
    '[ -f "$GIT_DIR/CHERRY_PICK_HEAD" ] && exit 0',
    "",
    '[ "${GRAPHIFY_SKIP_HOOK:-0}" = "1" ] && exit 0',
    "",
    "CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null)",
    'if [ -z "$CHANGED" ]; then',
    "    exit 0",
    "fi",
    "",
    "# Skip when only graphify-out/ artifacts changed",
    '_NON_GRAPH=$(echo "$CHANGED" | grep -v \'^graphify-out/\' || true)',
    'if [ -z "$_NON_GRAPH" ]; then',
    "    exit 0",
    "fi",
    "",
  ].join("\n") +
  "\n" +
  _NODE_DETECT +
  "\n" +
  [
    'export GRAPHIFY_CHANGED="$CHANGED"',
    "",
    "# Run the rebuild detached so git commit returns immediately.",
    '_GRAPHIFY_LOG="${HOME}/.cache/graphify-rebuild.log"',
    'mkdir -p "$(dirname "$_GRAPHIFY_LOG")"',
    'export GRAPHIFY_REBUILD_LOG="$_GRAPHIFY_LOG"',
    'echo "[graphify hook] launching background rebuild (log: $_GRAPHIFY_LOG)"',
  ].join("\n") +
  "\n" +
  _detachedLaunch(_REBUILD_BODY_COMMIT) +
  HOOK_MARKER_END +
  "\n";

const _CHECKOUT_SCRIPT =
  CHECKOUT_MARKER +
  "\n" +
  [
    "# Auto-rebuilds the knowledge graph (code only) when switching branches.",
    "# Installed by: graphify hook install",
    "",
    "PREV_HEAD=$1",
    "NEW_HEAD=$2",
    "BRANCH_SWITCH=$3",
    "",
    "# Only run on branch switches, not file checkouts",
    'if [ "$BRANCH_SWITCH" != "1" ]; then',
    "    exit 0",
    "fi",
    "",
    "# Only run if graphify-out/ exists",
    'if [ ! -d "graphify-out" ]; then',
    "    exit 0",
    "fi",
    "",
    "# Skip during rebase/merge/cherry-pick",
    "GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)",
    '[ -d "$GIT_DIR/rebase-merge" ] && exit 0',
    '[ -d "$GIT_DIR/rebase-apply" ] && exit 0',
    '[ -f "$GIT_DIR/MERGE_HEAD" ] && exit 0',
    '[ -f "$GIT_DIR/CHERRY_PICK_HEAD" ] && exit 0',
    "",
  ].join("\n") +
  "\n" +
  _NODE_DETECT +
  "\n" +
  [
    '_GRAPHIFY_LOG="${HOME}/.cache/graphify-rebuild.log"',
    'mkdir -p "$(dirname "$_GRAPHIFY_LOG")"',
    'export GRAPHIFY_REBUILD_LOG="$_GRAPHIFY_LOG"',
    'echo "[graphify] Branch switched - launching background rebuild (log: $_GRAPHIFY_LOG)"',
  ].join("\n") +
  "\n" +
  _detachedLaunch(_REBUILD_BODY_CHECKOUT) +
  CHECKOUT_MARKER_END +
  "\n";

function _gitRoot(p: string): string | null {
  let dir = path.resolve(p);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function _hooksDir(root: string): string {
  try {
    const raw = execSync("git config core.hooksPath", {
      cwd: root,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (raw) {
      let p = raw.startsWith("~")
        ? path.join(os.homedir(), raw.slice(1))
        : raw;
      if (!path.isAbsolute(p)) {
        p = path.join(root, p);
      }
      const resolved = path.resolve(p);
      const relative = path.relative(path.resolve(root), resolved);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
        fs.mkdirSync(resolved, { recursive: true });
        return resolved;
      }
    }
  } catch {
    // core.hooksPath not set or error
  }

  try {
    const raw = execSync(
      "git -C " + JSON.stringify(root) + " rev-parse --git-path hooks",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (raw && !raw.includes("\n") && !raw.includes("\r") && !raw.includes("\0")) {
      const d = path.resolve(root, raw);
      fs.mkdirSync(d, { recursive: true });
      return d;
    }
  } catch {
    // fall through
  }
  const d = path.join(root, ".git", "hooks");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function _installHook(hooksDir: string, name: string, script: string, marker: string): string {
  const hookPath = path.join(hooksDir, name);
  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, "utf-8");
    if (content.includes(marker)) {
      return `already installed at ${hookPath}`;
    }
    fs.writeFileSync(hookPath, content.trimEnd() + "\n\n" + script, "utf-8");
    return `appended to existing ${name} hook at ${hookPath}`;
  }
  fs.writeFileSync(hookPath, "#!/bin/sh\n" + script, "utf-8");
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // chmod may fail on Windows
  }
  return `installed at ${hookPath}`;
}

function _uninstallHook(hooksDir: string, name: string, marker: string, markerEnd: string): string {
  const hookPath = path.join(hooksDir, name);
  if (!fs.existsSync(hookPath)) {
    return `no ${name} hook found - nothing to remove.`;
  }
  const content = fs.readFileSync(hookPath, "utf-8");
  if (!content.includes(marker)) {
    return `graphify hook not found in ${name} - nothing to remove.`;
  }
  const markerRe = new RegExp(
    escapeRegExp(marker) + ".*?" + escapeRegExp(markerEnd) + "\\n?",
    "gs",
  );
  const newContent = content.replace(markerRe, "").trim();
  if (!newContent || newContent === "#!/bin/bash" || newContent === "#!/bin/sh") {
    fs.unlinkSync(hookPath);
    return `removed ${name} hook at ${hookPath}`;
  }
  fs.writeFileSync(hookPath, newContent + "\n", "utf-8");
  return `graphify removed from ${name} at ${hookPath} (other hook content preserved)`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _userHooksDir(hooksDir: string): string {
  if (path.basename(hooksDir) === "_") {
    return path.dirname(hooksDir);
  }
  return hooksDir;
}

export function installHook(inputPath?: string): string {
  const p = inputPath || ".";
  const root = _gitRoot(p);
  if (root === null) {
    throw new Error(`No git repository found at or above ${path.resolve(p)}`);
  }

  const hooksDir = _userHooksDir(_hooksDir(root));

  // Pin the current Node.js interpreter
  const nodeExe = process.execPath;
  const safeRe = /[^a-zA-Z0-9/_.@:\\-]/;
  const pinned = safeRe.test(nodeExe) ? "" : nodeExe;

  const hook = _HOOK_SCRIPT.replace("__PINNED_NODE__", pinned);
  const checkout = _CHECKOUT_SCRIPT.replace("__PINNED_NODE__", pinned);

  const commitMsg = _installHook(hooksDir, "post-commit", hook, HOOK_MARKER);
  const checkoutMsg = _installHook(hooksDir, "post-checkout", checkout, CHECKOUT_MARKER);

  return `post-commit: ${commitMsg}\npost-checkout: ${checkoutMsg}`;
}

export function uninstallHook(inputPath?: string): string {
  const p = inputPath || ".";
  const root = _gitRoot(p);
  if (root === null) {
    throw new Error(`No git repository found at or above ${path.resolve(p)}`);
  }

  const hooksDir = _userHooksDir(_hooksDir(root));
  const commitMsg = _uninstallHook(hooksDir, "post-commit", HOOK_MARKER, HOOK_MARKER_END);
  const checkoutMsg = _uninstallHook(hooksDir, "post-checkout", CHECKOUT_MARKER, CHECKOUT_MARKER_END);

  return `post-commit: ${commitMsg}\npost-checkout: ${checkoutMsg}`;
}

export function hookStatus(inputPath?: string): string {
  const p = inputPath || ".";
  const root = _gitRoot(p);
  if (root === null) {
    return "Not in a git repository.";
  }
  const hooksDir = _userHooksDir(_hooksDir(root));

  function check(name: string, marker: string): string {
    const hookPath = path.join(hooksDir, name);
    if (!fs.existsSync(hookPath)) {
      return "not installed";
    }
    const content = fs.readFileSync(hookPath, "utf-8");
    return content.includes(marker) ? "installed" : "not installed (hook exists but graphify not found)";
  }

  const commit = check("post-commit", HOOK_MARKER);
  const checkout = check("post-checkout", CHECKOUT_MARKER);
  return `post-commit: ${commit}\npost-checkout: ${checkout}`;
}
