/** Tests for src/prs.ts. Ported from graphify/prs.py. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyPr,
  daysOld,
  blastRadius,
  statusColor,
  ciIcon,
  formatPrsText,
  pathMatch,
  buildCommunityLabels,
  pad,
  green,
  red,
  yellow,
  cyan,
  bold,
  dim,
  magenta,
  _STATUS_ORDER,
  _TRIAGE_MODEL_DEFAULTS,
} from "../src/prs.js";
import type { PRInfo } from "../src/prs.js";

function makePr(overrides: Partial<PRInfo> = {}): PRInfo {
  return {
    number: 1,
    title: "Test PR",
    branch: "feature",
    baseBranch: "main",
    author: "alice",
    isDraft: false,
    reviewDecision: "",
    ciStatus: "SUCCESS",
    updatedAt: new Date(),
    expectedBase: "main",
    worktreePath: null,
    communitiesTouched: [],
    nodesAffected: 0,
    filesChanged: [],
    ...overrides,
  };
}

// ── ANSI color helpers ──────────────────────────────────────────────────

describe("ANSI color helpers", () => {
  it("green returns text when NO_COLOR", () => {
    // The actual result depends on _NO_COLOR which is set at module load time
    const result = green("hello");
    expect(typeof result).toBe("string");
    expect(result).toContain("hello");
  });

  it("pad adds spaces to reach target width", () => {
    expect(pad("abc", 6).replace(/\x1b\[[0-9;]*m/g, "").length).toBeGreaterThanOrEqual(6);
  });

  it("pad handles ANSI-colored strings by visible width", () => {
    const colored = green("abc");
    const result = pad(colored, 6);
    // After stripping ANSI, visible part should be >= 6
    const visible = result.replace(/\x1b\[[0-9;]*m/g, "");
    expect(visible.length).toBeGreaterThanOrEqual(6);
  });
});

// ── Classification ─────────────────────────────────────────────────────

describe("classifyPr", () => {
  it("returns WRONG-BASE for different base branch", () => {
    const pr = makePr({ baseBranch: "develop", expectedBase: "main" });
    expect(classifyPr(pr, "main")).toBe("WRONG-BASE");
  });

  it("returns CI-FAIL for failing CI", () => {
    const pr = makePr({ ciStatus: "FAILURE" });
    expect(classifyPr(pr, "main")).toBe("CI-FAIL");
  });

  it("returns CHANGES-REQ for changes requested", () => {
    const pr = makePr({ reviewDecision: "CHANGES_REQUESTED" });
    expect(classifyPr(pr, "main")).toBe("CHANGES-REQ");
  });

  it("returns DRAFT for draft PRs", () => {
    const pr = makePr({ isDraft: true });
    expect(classifyPr(pr, "main")).toBe("DRAFT");
  });

  it("returns STALE for PRs older than 14 days", () => {
    const pr = makePr({ updatedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) });
    expect(classifyPr(pr, "main")).toBe("STALE");
  });

  it("returns APPROVED for approved PRs", () => {
    const pr = makePr({ reviewDecision: "APPROVED" });
    expect(classifyPr(pr, "main")).toBe("APPROVED");
  });

  it("returns PENDING for pending CI", () => {
    const pr = makePr({ ciStatus: "PENDING" });
    expect(classifyPr(pr, "main")).toBe("PENDING");
  });

  it("returns READY for mergeable PRs", () => {
    const pr = makePr({ ciStatus: "SUCCESS", reviewDecision: "" });
    expect(classifyPr(pr, "main")).toBe("READY");
  });
});

// ── daysOld ─────────────────────────────────────────────────────────────

describe("daysOld", () => {
  it("returns 0 for today", () => {
    expect(daysOld(new Date())).toBe(0);
  });

  it("returns correct number of days", () => {
    const d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(daysOld(d)).toBe(3);
  });
});

// ── blastRadius ─────────────────────────────────────────────────────────

describe("blastRadius", () => {
  it("returns empty string for zero nodes affected", () => {
    expect(blastRadius(0, [])).toBe("");
  });

  it("returns singular form for 1 node / 1 community", () => {
    expect(blastRadius(1, [1])).toBe("1 node / 1 community");
  });

  it("returns plural form for multiple nodes/communities", () => {
    expect(blastRadius(5, [1, 2, 3])).toBe("5 nodes / 3 communities");
  });
});

// ── statusColor ────────────────────────────────────────────────────────

describe("statusColor", () => {
  it("returns a string for known statuses", () => {
    for (const s of _STATUS_ORDER) {
      expect(typeof statusColor(s)).toBe("string");
    }
  });

  it("returns raw status for unknown values", () => {
    expect(statusColor("UNKNOWN")).toBe("UNKNOWN");
  });
});

// ── ciIcon ─────────────────────────────────────────────────────────────

describe("ciIcon", () => {
  it("returns icon for known statuses", () => {
    expect(typeof ciIcon("SUCCESS")).toBe("string");
    expect(typeof ciIcon("FAILURE")).toBe("string");
    expect(typeof ciIcon("PENDING")).toBe("string");
    expect(typeof ciIcon("NONE")).toBe("string");
  });

  it("returns ? for unknown status", () => {
    expect(ciIcon("UNKNOWN")).toBe("?");
  });
});

// ── pathMatch ──────────────────────────────────────────────────────────

describe("pathMatch", () => {
  it("matches identical paths", () => {
    expect(pathMatch("src/app.ts", "src/app.ts")).toBe(true);
  });

  it("matches when graph source has prefix", () => {
    expect(pathMatch("repo/src/app.ts", "src/app.ts")).toBe(true);
  });

  it("matches when pr file has prefix", () => {
    expect(pathMatch("src/app.ts", "repo/src/app.ts")).toBe(true);
  });

  it("does not match unrelated paths", () => {
    expect(pathMatch("src/app.ts", "src/util.ts")).toBe(false);
  });
});

// ── formatPrsText ──────────────────────────────────────────────────────

describe("formatPrsText", () => {
  it("formats actionable PRs as text", () => {
    const pr = makePr({
      number: 42,
      title: "Fix bug",
      baseBranch: "main",
      ciStatus: "SUCCESS",
    });
    const text = formatPrsText([pr], "main");
    expect(text).toContain("#42");
    expect(text).toContain("Fix bug");
  });

  it("hides wrong-base PRs from count", () => {
    const pr = makePr({ baseBranch: "develop" });
    const text = formatPrsText([pr], "main");
    expect(text).toContain("0");  // 0 actionable PRs
    expect(text).toContain("wrong base");
  });
});

// ── buildCommunityLabels ───────────────────────────────────────────────

describe("buildCommunityLabels", () => {
  it("builds labels from graph node data", () => {
    const data = {
      nodes: [
        { id: "n1", label: "UserService", community: 0 },
        { id: "n2", label: "AuthService", community: 0 },
        { id: "n3", label: "PaymentService", community: 1 },
      ],
    };
    const labels = buildCommunityLabels(data, 4);
    expect(labels[0]).toEqual(["UserService", "AuthService"]);
    expect(labels[1]).toEqual(["PaymentService"]);
  });

  it("respects topN limit", () => {
    const data = {
      nodes: Array.from({ length: 10 }, (_, i) => ({
        id: `n${i}`, label: `Node${i}`, community: 0,
      })),
    };
    const labels = buildCommunityLabels(data, 3);
    expect(labels[0].length).toBe(3);
  });

  it("skips nodes without community", () => {
    const data = {
      nodes: [
        { id: "n1", label: "A", community: null },
        { id: "n2", label: "B" },
      ],
    };
    const labels = buildCommunityLabels(data);
    expect(Object.keys(labels).length).toBe(0);
  });
});

// ── _TRIAGE_MODEL_DEFAULTS ─────────────────────────────────────────────

describe("_TRIAGE_MODEL_DEFAULTS", () => {
  it("has expected backend keys", () => {
    expect(_TRIAGE_MODEL_DEFAULTS.claude).toBeTruthy();
    expect(_TRIAGE_MODEL_DEFAULTS.openai).toBeTruthy();
    expect(_TRIAGE_MODEL_DEFAULTS.kimi).toBeTruthy();
    expect(_TRIAGE_MODEL_DEFAULTS.gemini).toBeTruthy();
  });
});
