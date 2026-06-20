// graphify prs — graph-aware PR dashboard.
//
// Fast terminal overview of open PRs with CI/review state, worktree mapping,
// and optional graph-impact analysis (which communities a PR touches) and
// Opus-powered triage ranking.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type Graph from "graphology";

// ── ANSI colours ─────────────────────────────────────────────────────────────

const _NO_COLOR = !process.stdout.isTTY || !!process.env.NO_COLOR;

function _c(code: string, text: string): string {
  if (_NO_COLOR) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export function green(t: string): string { return _c("32", t); }
export function red(t: string): string { return _c("31", t); }
export function yellow(t: string): string { return _c("33", t); }
export function cyan(t: string): string { return _c("36", t); }
export function bold(t: string): string { return _c("1", t); }
export function dim(t: string): string { return _c("2", t); }
export function magenta(t: string): string { return _c("35", t); }

export const _ANSI_RE = /\x1b\[[0-9;]*m/;

/** Pad an ANSI-colored string to visible width (strips escape codes for length calc). */
export function pad(s: string, width: number): string {
  const visibleLen = s.replace(_ANSI_RE, "").length;
  return s + " ".repeat(Math.max(0, width - visibleLen));
}

// ── Data model ────────────────────────────────────────────────────────────────

export interface PRInfo {
  number: number;
  title: string;
  branch: string;
  baseBranch: string;
  author: string;
  isDraft: boolean;
  reviewDecision: string;
  ciStatus: string;
  updatedAt: Date;
  expectedBase: string;
  worktreePath: string | null;
  communitiesTouched: number[];
  nodesAffected: number;
  filesChanged: string[];
}

// ── Classification ────────────────────────────────────────────────────────────

export const _STATUS_ORDER = ["WRONG-BASE", "CI-FAIL", "CHANGES-REQ", "DRAFT", "STALE", "PENDING", "APPROVED", "READY"];
const _STALE_DAYS = 14;

export function classifyPr(pr: PRInfo, base: string = "main"): string {
  if (pr.baseBranch !== base) return "WRONG-BASE";
  if (pr.ciStatus === "FAILURE") return "CI-FAIL";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "CHANGES-REQ";
  if (pr.isDraft) return "DRAFT";
  if (daysOld(pr.updatedAt) >= _STALE_DAYS) return "STALE";
  if (pr.reviewDecision === "APPROVED") return "APPROVED";
  if (pr.ciStatus === "PENDING") return "PENDING";
  return "READY";
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    "READY": green(status),
    "APPROVED": bold(green(status)),
    "CI-FAIL": red(status),
    "CHANGES-REQ": red(status),
    "WRONG-BASE": dim(status),
    "STALE": dim(status),
    "DRAFT": yellow(status),
    "PENDING": yellow(status),
  };
  return map[status] ?? status;
}

export function ciIcon(status: string): string {
  const map: Record<string, string> = {
    "SUCCESS": green("✓"),
    "FAILURE": red("✗"),
    "PENDING": yellow("…"),
    "NONE": dim("–"),
  };
  return map[status] ?? "?";
}

export function daysOld(updatedAt: Date): number {
  const now = new Date();
  return Math.floor((now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24));
}

export function blastRadius(nodesAffected: number, communitiesTouched: number[]): string {
  if (!nodesAffected) return "";
  const n = nodesAffected;
  const c = communitiesTouched.length;
  return `${n} node${n !== 1 ? "s" : ""} / ${c} communit${c !== 1 ? "ies" : "y"}`;
}

// ── GitHub data fetching ──────────────────────────────────────────────────────

function gh(...args: string[]): unknown[] | Record<string, unknown> | null {
  try {
    const result = execFileSync("gh", args, { encoding: "utf-8", timeout: 30000 });
    return JSON.parse(result) as unknown[] | Record<string, unknown>;
  } catch {
    return null;
  }
}

export function detectDefaultBranch(repo?: string): string {
  // Try gh first
  const ghArgs = ["repo", "view", "--json", "defaultBranchRef"];
  if (repo) ghArgs.push("--repo", repo);
  const data = gh(...ghArgs) as Record<string, unknown> | null;
  if (data && typeof data === "object" && data.defaultBranchRef) {
    const ref = data.defaultBranchRef as Record<string, unknown>;
    if (ref.name && typeof ref.name === "string") return ref.name;
  }
  // Fall back to git symbolic-ref
  try {
    const result = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      encoding: "utf-8", timeout: 5000,
    });
    const ref = result.trim();
    if (ref) return ref.split("/").pop() ?? "main";
  } catch { /* ignore */ }
  return "main";
}

const _CI_FAILURE_CONCLUSIONS = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

function _parseCi(rollup: Record<string, string>[]): string {
  if (!rollup || !rollup.length) return "NONE";
  const conclusions = new Set(
    rollup.filter((r) => r.conclusion).map((r) => r.conclusion as string),
  );
  if ([...conclusions].some((c) => _CI_FAILURE_CONCLUSIONS.has(c))) return "FAILURE";
  const statuses = new Set(rollup.map((r) => r.status as string));
  if (statuses.has("IN_PROGRESS") || statuses.has("QUEUED")) return "PENDING";
  if (conclusions.has("SUCCESS")) return "SUCCESS";
  return "NONE";
}

export function fetchPrs(repo?: string, base?: string, limit: number = 50): PRInfo[] {
  const resolvedBase = base ?? detectDefaultBranch(repo);
  const args = [
    "pr", "list", "--state", "open", "--limit", String(limit),
    "--json", "number,title,headRefName,baseRefName,author,isDraft,reviewDecision,statusCheckRollup,updatedAt",
  ];
  if (repo) args.push("--repo", repo);

  const raw = gh(...args);
  if (raw === null) {
    throw new RuntimeError("gh CLI not found or not authenticated. Run: gh auth login");
  }

  const items = Array.isArray(raw) ? raw : [raw];
  const prs: PRInfo[] = [];
  for (const item of items) {
    const it = item as Record<string, unknown>;
    const authorObj = it.author as Record<string, string> | null;
    const rollup = (it.statusCheckRollup ?? []) as Record<string, string>[];
    const updatedAt = new Date(it.updatedAt as string);
    prs.push({
      number: it.number as number,
      title: it.title as string,
      branch: it.headRefName as string,
      baseBranch: it.baseRefName as string,
      author: authorObj?.login ?? "?",
      isDraft: (it.isDraft as boolean) ?? false,
      reviewDecision: (it.reviewDecision as string) || "",
      ciStatus: _parseCi(rollup),
      updatedAt,
      expectedBase: resolvedBase,
      worktreePath: null,
      communitiesTouched: [],
      nodesAffected: 0,
      filesChanged: [],
    });
  }
  return prs;
}

export function fetchPrFiles(number: number, repo?: string): string[] {
  const args = ["pr", "diff", String(number), "--name-only"];
  if (repo) args.push("--repo", repo);
  try {
    const result = execFileSync("gh", args, { encoding: "utf-8", timeout: 30000 });
    return result.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Graph-native impact ────────────────────────────────────────────────────

export function pathMatch(graphSrc: string, prFile: string): boolean {
  if (graphSrc === prFile) return true;
  return graphSrc.endsWith("/" + prFile) || prFile.endsWith("/" + graphSrc);
}

export function computePrImpact(
  files: string[],
  graph: Graph,
): { communities: number[]; nodes: number } {
  // Build index once
  const fileComms: Record<string, Set<number>> = {};
  const fileCount: Record<string, number> = {};

  graph.forEachNode((node: string) => {
    const attrs = graph.getNodeAttributes(node);
    const src = (attrs.source_file as string) || "";
    if (!src) return;
    if (!fileComms[src]) {
      fileComms[src] = new Set();
      fileCount[src] = 0;
    }
    const c = attrs.community;
    if (c !== undefined && c !== null) {
      fileComms[src].add(Number(c));
    }
    fileCount[src]++;
  });

  const comms = new Set<number>();
  let nodes = 0;
  const matched = new Set<string>();
  for (const f of files) {
    for (const [src, srcComms] of Object.entries(fileComms)) {
      if (!matched.has(src) && pathMatch(src, f)) {
        for (const c of srcComms) comms.add(c);
        nodes += fileCount[src];
        matched.add(src);
      }
    }
  }
  return { communities: [...comms].sort((a, b) => a - b), nodes };
}

export function formatPrsText(prs: PRInfo[], base: string): string {
  const actionable = prs.filter((p) => p.baseBranch === base);
  const wrong = prs.length - actionable.length;
  const lines = [`Open PRs targeting ${base}: ${actionable.length}  (${wrong} on wrong base, not shown)\n`];
  for (const p of actionable
    .sort((a, b) => {
      const ai = _STATUS_ORDER.indexOf(classifyPr(a, base)) ?? 99;
      const bi = _STATUS_ORDER.indexOf(classifyPr(b, base)) ?? 99;
      return ai !== bi ? ai - bi : daysOld(a.updatedAt) - daysOld(b.updatedAt);
    })) {
    const impact = blastRadius(p.nodesAffected, p.communitiesTouched);
    const impactStr = impact ? `  blast_radius=${impact}` : "";
    const status = classifyPr(p, base);
    lines.push(
      `#${p.number} [${status}] CI=${p.ciStatus} review=${p.reviewDecision || "none"} ` +
      `age=${daysOld(p.updatedAt)}d author=${p.author}${impactStr}\n  ${p.title}`,
    );
  }
  return lines.join("\n\n");
}

// ── Worktree mapping ────────────────────────────────────────────────────────

export function fetchWorktrees(): Record<string, string> {
  try {
    const result = execFileSync("git", ["worktree", "list", "--porcelain"], {
      encoding: "utf-8", timeout: 10000,
    });
    const mapping: Record<string, string> = {};
    let currentPath: string | null = null;
    for (const line of result.split("\n")) {
      if (!line) {
        currentPath = null;
      } else if (line.startsWith("worktree ")) {
        currentPath = line.substring(9);
      } else if (line.startsWith("branch refs/heads/") && currentPath) {
        mapping[line.substring(18)] = currentPath;
      }
    }
    return mapping;
  } catch {
    return {};
  }
}

// ── Graph impact analysis ─────────────────────────────────────────────────────

export function buildCommunityLabels(
  data: Record<string, unknown>,
  topN: number = 4,
): Record<number, string[]> {
  const commLabels: Record<number, string[]> = {};
  const nodes = (data.nodes as Record<string, unknown>[]) ?? [];
  for (const node of nodes) {
    const c = node.community;
    if (c === undefined || c === null) continue;
    const label = (node.label as string) || (node.id as string) || "";
    if (label) {
      const cid = Number(c);
      if (!commLabels[cid]) commLabels[cid] = [];
      commLabels[cid].push(label);
    }
  }
  const result: Record<number, string[]> = {};
  for (const [c, labels] of Object.entries(commLabels)) {
    result[Number(c)] = labels.slice(0, topN);
  }
  return result;
}

export function attachGraphImpact(
  prs: PRInfo[],
  graphPath: string,
  repo?: string,
): Record<number, string[]> {
  if (!fs.existsSync(graphPath)) return {};

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
  } catch {
    return {};
  }

  // Build file → {community, node_count} index
  const fileToCommunities: Record<string, Set<number>> = {};
  const fileToNodes: Record<string, number> = {};
  for (const node of (data.nodes as Record<string, unknown>[]) ?? []) {
    const src = (node.source_file as string) || "";
    if (!src) continue;
    const comm = node.community;
    if (!fileToCommunities[src]) {
      fileToCommunities[src] = new Set();
      fileToNodes[src] = 0;
    }
    if (comm !== undefined && comm !== null) {
      fileToCommunities[src].add(Number(comm));
    }
    fileToNodes[src]++;
  }

  // Fetch diffs concurrently using Promise.all with concurrency limit
  const actionable = prs.filter((p) => classifyPr(p, p.expectedBase) !== "WRONG-BASE");
  const limit = Math.min(8, actionable.length) || 1;

  // Simple concurrent processing with limit
  const tasks = actionable.map((pr) => () => {
    const files = fetchPrFiles(pr.number, repo);
    pr.filesChanged = files;

    const comms = new Set<number>();
    let nodes = 0;
    const matched = new Set<string>();
    for (const f of files) {
      for (const [gf, gcomms] of Object.entries(fileToCommunities)) {
        if (!matched.has(gf) && pathMatch(gf, f)) {
          for (const c of gcomms) comms.add(c);
          nodes += fileToNodes[gf] ?? 0;
          matched.add(gf);
        }
      }
    }
    pr.communitiesTouched = [...comms].sort((a, b) => a - b);
    pr.nodesAffected = nodes;
  });

  // Process in batches
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    batch.forEach((fn) => fn());
  }

  return buildCommunityLabels(data);
}

// ── Dashboard rendering ───────────────────────────────────────────────────────

function _truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

export function renderDashboard(
  prs: PRInfo[],
  base: string = "main",
  showWrongBase: boolean = false,
): void {
  const actionable = prs.filter((p) => p.baseBranch === base);
  const wrongBase = prs.filter((p) => p.baseBranch !== base);

  actionable.sort((a, b) => {
    const sa = classifyPr(a, base);
    const sb = classifyPr(b, base);
    const ai = _STATUS_ORDER.indexOf(sa) ?? 99;
    const bi = _STATUS_ORDER.indexOf(sb) ?? 99;
    return ai !== bi ? ai - bi : daysOld(a.updatedAt) - daysOld(b.updatedAt);
  });

  console.log();
  console.log(bold(`  graphify prs  ·  base: ${base}  ·  ${actionable.length} PRs`));
  console.log();

  if (!actionable.length) {
    console.log(dim("  No open PRs targeting this base branch."));
  } else {
    console.log(`  ${"    #"}  CI  ${pad("STATUS", 13)}  ${pad("UPDATED", 8)}  ${pad("IMPACT", 22)}  TITLE`);
    console.log(`  ${"─".repeat(4)}  ${"─".repeat(2)}  ${"─".repeat(13)}  ${"─".repeat(8)}  ${"─".repeat(22)}  ${"─".repeat(40)}`);

    for (const pr of actionable) {
      const status = classifyPr(pr, base);
      const statusStr = pad(statusColor(status), 13);
      const ciStr = ciIcon(pr.ciStatus);
      const age = daysOld(pr.updatedAt);
      const ageStr = age > 0 ? `${age}d` : "today";
      const br = blastRadius(pr.nodesAffected, pr.communitiesTouched);
      const impact = br ? pad(dim(_truncate(br, 22)), 22) : pad(dim("–"), 22);
      const wt = pr.worktreePath ? ` ${cyan("⬡")}` : "  ";
      const draftStr = pr.isDraft ? dim(" [draft]") : "";
      const title = _truncate(pr.title, 52);
      const num = pad(bold(`#${pr.number}`), 6);
      console.log(`  ${num}${wt}  ${ciStr}  ${statusStr}  ${ageStr.padStart(6)}   ${impact}  ${title}${draftStr}`);
    }
  }

  // Summary line
  const byStatus: Record<string, number> = {};
  for (const p of actionable) {
    const s = classifyPr(p, base);
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }

  const parts: string[] = [];
  if (byStatus["READY"]) parts.push(green(`${byStatus["READY"]} ready`));
  if (byStatus["APPROVED"]) parts.push(bold(green(`${byStatus["APPROVED"]} approved`)));
  if (byStatus["PENDING"]) parts.push(yellow(`${byStatus["PENDING"]} pending CI`));
  if (byStatus["CI-FAIL"]) parts.push(red(`${byStatus["CI-FAIL"]} CI failing`));
  if (byStatus["CHANGES-REQ"]) parts.push(red(`${byStatus["CHANGES-REQ"]} changes requested`));
  if (byStatus["DRAFT"]) parts.push(yellow(`${byStatus["DRAFT"]} draft`));
  if (byStatus["STALE"]) parts.push(dim(`${byStatus["STALE"]} stale`));

  if (wrongBase.length) {
    parts.push(dim(`${wrongBase.length} wrong base`));
  }

  console.log();
  console.log(`  ${parts.join(" · ")}`);
  console.log();

  if (wrongBase.length && showWrongBase) {
    console.log(dim(`  ── ${wrongBase.length} PRs targeting wrong base ──`));
    for (const pr of [...wrongBase].sort((a, b) => b.number - a.number)) {
      console.log(dim(`  #${String(pr.number).padStart(4)}  base=${pr.baseBranch.padEnd(12)}  ${_truncate(pr.title, 60)}`));
    }
    console.log();
  }
}

export function renderWorktrees(prs: PRInfo[], worktrees: Record<string, string>): void {
  console.log();
  console.log(bold("  Worktrees"));
  console.log();
  if (!Object.keys(worktrees).length) {
    console.log(dim("  No active worktrees found."));
    console.log();
    return;
  }

  const prByBranch: Record<string, PRInfo> = {};
  for (const p of prs) prByBranch[p.branch] = p;

  for (const [branch, wtPath] of Object.entries(worktrees).sort()) {
    const pr = prByBranch[branch];
    if (pr) {
      const status = classifyPr(pr, pr.expectedBase);
      console.log(`  ${cyan(wtPath)}`);
      console.log(`    ${dim("branch:")} ${branch}  ->  PR ${bold(`#${pr.number}`)}  [${statusColor(status)}]  ${_truncate(pr.title, 50)}`);
    } else {
      console.log(`  ${cyan(wtPath)}`);
      console.log(`    ${dim("branch:")} ${branch}  ${dim("(no open PR)")}`);
    }
    console.log();
  }
}

export function renderConflicts(
  prs: PRInfo[],
  base: string = "main",
  communityLabels?: Record<number, string[]>,
): void {
  const actionable = prs.filter(
    (p) => p.baseBranch === base && p.communitiesTouched.length > 0,
  );
  if (!actionable.length) {
    console.log(dim("\n  No graph impact data - run with a valid graph.json to detect conflicts.\n"));
    return;
  }

  const commToPrs: Record<number, PRInfo[]> = {};
  for (const pr of actionable) {
    for (const c of pr.communitiesTouched) {
      if (!commToPrs[c]) commToPrs[c] = [];
      commToPrs[c].push(pr);
    }
  }

  const conflicts = Object.fromEntries(
    Object.entries(commToPrs).filter(([, ps]) => ps.length > 1),
  );
  if (!Object.keys(conflicts).length) {
    console.log(green("\n  No community overlap between open PRs - safe to merge in any order.\n"));
    return;
  }

  console.log();
  console.log(bold("  Community conflicts (PRs sharing the same graph community)"));
  console.log();
  const labels = communityLabels ?? {};
  for (const [comm, ps] of Object.entries(conflicts).sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    let commLabelStr = "";
    const cid = Number(comm);
    if (labels[cid]?.length) {
      commLabelStr = dim("  — " + labels[cid].join(", "));
    }
    console.log(`  ${yellow(`Community ${comm}`)}${commLabelStr}  (${ps.length} PRs overlap)`);
    for (const pr of ps) {
      const status = classifyPr(pr, pr.expectedBase);
      console.log(`    #${String(pr.number).padStart(4)}  ${pad(statusColor(status), 13)}  ${_truncate(pr.title, 55)}`);
    }
    console.log();
  }
}

export function renderPrDetail(pr: PRInfo, repo?: string): void {
  const status = classifyPr(pr, pr.expectedBase);
  console.log();
  console.log(bold(`  PR #${pr.number}  ·  ${statusColor(status)}`));
  console.log(`  ${pr.title}`);
  console.log();
  console.log(`  ${dim("branch:")}  ${pr.branch}  ->  ${pr.baseBranch}`);
  console.log(`  ${dim("author:")}  ${pr.author}`);
  console.log(`  ${dim("updated:")} ${daysOld(pr.updatedAt)}d ago`);
  console.log(`  ${dim("CI:")}      ${ciIcon(pr.ciStatus)} ${pr.ciStatus}`);
  if (pr.reviewDecision) {
    console.log(`  ${dim("review:")} ${pr.reviewDecision}`);
  }
  if (pr.worktreePath) {
    console.log(`  ${dim("worktree:")} ${cyan(pr.worktreePath)}`);
  }
  const br = blastRadius(pr.nodesAffected, pr.communitiesTouched);
  if (br) {
    console.log();
    console.log(`  ${bold("Graph impact:")}  ${br}`);
    console.log(`  ${dim("communities:")} ${pr.communitiesTouched}`);
    if (pr.filesChanged.length) {
      console.log(`  ${dim("files changed:")} ${pr.filesChanged.length}`);
      for (const f of pr.filesChanged.slice(0, 10)) {
        console.log(`    ${dim(f)}`);
      }
      if (pr.filesChanged.length > 10) {
        console.log(dim(`    … and ${pr.filesChanged.length - 10} more`));
      }
    }
  }
  console.log();
}

// ── Triage (multi-backend) ────────────────────────────────────────────────────

export const _TRIAGE_MODEL_DEFAULTS: Record<string, string> = {
  claude: "claude-opus-4-7",
  kimi: "kimi-k2.6",
  openai: "gpt-4.1-mini",
  gemini: "gemini-3-flash-preview",
};

export async function resolveTriageBackend(): Promise<[string, string]> {
  const {
    BACKENDS,
    getBackendApiKey,
    defaultModelForBackend,
  } = await import("./llm/index.js");

  const explicit = (process.env.GRAPHIFY_TRIAGE_BACKEND || "").trim();
  if (explicit in BACKENDS) {
    const model = process.env.GRAPHIFY_TRIAGE_MODEL ||
      _TRIAGE_MODEL_DEFAULTS[explicit] ||
      defaultModelForBackend(explicit);
    return [explicit, model];
  }

  for (const b of ["claude", "kimi", "openai", "gemini"]) {
    if (getBackendApiKey(b)) {
      const model = process.env.GRAPHIFY_TRIAGE_MODEL ||
        _TRIAGE_MODEL_DEFAULTS[b] ||
        defaultModelForBackend(b);
      return [b, model];
    }
  }

  // Check for claude CLI
  try {
    execFileSync("which", ["claude"], { encoding: "utf-8", timeout: 3000 });
    return ["claude-cli", "claude-code-plan"];
  } catch { /* ignore */ }

  return ["ollama", defaultModelForBackend("ollama")];
}

export async function triageWithOpus(prs: PRInfo[], base: string): Promise<void> {
  let BACKENDS: Record<string, any>;
  let getBackendApiKey: (b: string) => string | undefined;
  try {
    const llm = await import("./llm/index.js");
    BACKENDS = llm.BACKENDS;
    getBackendApiKey = llm.getBackendApiKey;
  } catch {
    console.error(red("  graphify.llm not available - cannot run triage."));
    process.exit(1);
    return; // unreachable but satisfies TS
  }

  const candidates = prs.filter(
    (p) => p.baseBranch === base && !["WRONG-BASE", "STALE"].includes(classifyPr(p, base)),
  );
  if (!candidates.length) {
    console.log(dim("  No actionable PRs to triage."));
    return;
  }

  const lines: string[] = [];
  for (const pr of candidates) {
    const impact = blastRadius(pr.nodesAffected, pr.communitiesTouched);
    const impactStr = impact ? `, blast_radius=${impact}` : "";
    const status = classifyPr(pr, base);
    lines.push(
      `PR #${pr.number} [${status}] CI=${pr.ciStatus} review=${pr.reviewDecision || "none"} ` +
      `age=${daysOld(pr.updatedAt)}d author=${pr.author}${impactStr}\n  title: ${pr.title}`,
    );
  }

  const prompt =
    "You are a senior engineer helping triage a PR review queue. " +
    "Given these open PRs, rank them by review priority for the repo maintainer. " +
    "For each PR give: priority number, one sentence on what action to take and why. " +
    "Be direct and specific. Format each as: #<number> -- <action>.\n\n" +
    lines.join("\n\n");

  let backend: string;
  let model: string;
  try {
    [backend, model] = await resolveTriageBackend();
  } catch (e) {
    console.error(red(`  Could not resolve triage backend: ${e}`));
    process.exit(1);
    return; // unreachable but satisfies TS
  }

  console.log();
  console.log(bold("  Triage") + dim(` (${backend} / ${model})`));
  console.log();

  try {
    if (backend === "claude") {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const apiKey = getBackendApiKey!("claude");
      const client = new Anthropic({ apiKey });
      const stream = client.messages.stream({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      process.stdout.write("  ");
      for await (const event of stream) {
        // Anthropic stream events; extract text from content_block_delta
        const delta = (event as any).delta;
        const text: string | undefined = delta?.text;
        if (text) {
          process.stdout.write(text.replace(/\n/g, "\n  "));
        }
      }
      console.log("\n");
    } else if (["kimi", "openai", "gemini", "ollama"].includes(backend)) {
      const OpenAI = (await import("openai")).default;
      const cfg = BACKENDS![backend];
      const apiKey = getBackendApiKey!(backend) || "ollama";
      const client = new OpenAI({ apiKey, baseURL: cfg?.base_url || undefined });
      const stream = await client.chat.completions.create({
        model,
        max_tokens: 1024,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      });
      process.stdout.write("  ");
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          process.stdout.write(delta.replace(/\n/g, "\n  "));
        }
      }
      console.log("\n");
    } else if (backend === "claude-cli") {
      const { execSync } = await import("node:child_process");
      try {
        const result = execSync(`claude -p --no-session-persistence`, {
          input: prompt,
          encoding: "utf-8",
          timeout: 120000,
        });
        let output: string;
        try {
          output = JSON.parse(result).result || result;
        } catch {
          output = result;
        }
        for (const line of output.split("\n")) {
          console.log(`  ${line}`);
        }
        console.log();
      } catch (e: any) {
        console.error(red(`  claude -p failed: ${String(e.stderr || e).slice(0, 300)}`));
      }
    }
  } catch (e) {
    console.error(`\n\n  ${red(`Triage failed: ${e}`)}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function cmdPrs(argv: string[]): void {
  let base: string | undefined;
  let repo: string | undefined;
  let doTriage = false;
  let doWorktrees = false;
  let doConflicts = false;
  let showWrongBase = false;
  let prNumber: number | undefined;
  let graphPath = "graphify-out/graph.json";

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--triage") doTriage = true;
    else if (arg === "--worktrees") doWorktrees = true;
    else if (arg === "--conflicts") doConflicts = true;
    else if (arg === "--wrong-base") showWrongBase = true;
    else if ((arg === "--base" || arg === "-b") && i + 1 < argv.length) { base = argv[++i]; }
    else if (arg.startsWith("--base=")) base = arg.split("=").slice(1).join("=");
    else if ((arg === "--repo" || arg === "-R") && i + 1 < argv.length) { repo = argv[++i]; }
    else if (arg.startsWith("--graph=")) graphPath = arg.split("=").slice(1).join("=");
    else if (arg === "--graph" && i + 1 < argv.length) { graphPath = argv[++i]; }
    else if (/^#?\d+$/.test(arg)) prNumber = parseInt(arg.replace("#", ""), 10);
    else if (arg === "-h" || arg === "--help") {
      console.log("graphify prs — graph-aware PR dashboard");
      return;
    }
    i++;
  }

  if (!base) base = detectDefaultBranch(repo);

  let prs: PRInfo[];
  try {
    prs = fetchPrs(repo, base);
  } catch (e: any) {
    console.error(red(`  Error: ${e.message}`));
    process.exit(1);
  }

  const worktrees = fetchWorktrees();
  for (const pr of prs) {
    pr.worktreePath = worktrees[pr.branch] ?? null;
  }

  let communityLabels: Record<number, string[]> = {};
  const needsImpact = fs.existsSync(graphPath) && (prNumber !== undefined || doTriage || doConflicts);
  if (needsImpact) {
    communityLabels = attachGraphImpact(prs, graphPath, repo);
  }

  if (prNumber !== undefined) {
    const match = prs.find((p) => p.number === prNumber);
    if (!match) {
      console.error(red(`  PR #${prNumber} not found in open PRs.`));
      process.exit(1);
    }
    renderPrDetail(match, repo);
    return;
  }

  if (doTriage) {
    renderDashboard(prs, base, showWrongBase);
    triageWithOpus(prs, base);
    return;
  }

  if (doWorktrees) {
    renderWorktrees(prs, worktrees);
    return;
  }

  if (doConflicts) {
    renderDashboard(prs, base, showWrongBase);
    renderConflicts(prs, base, communityLabels);
    return;
  }

  renderDashboard(prs, base, showWrongBase);
}

// Minimal RuntimeError class (Node.js doesn't have one built in)
class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}
