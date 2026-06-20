// monitor a folder and auto-trigger --update when files change

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const _GRAPHIFY_OUT = process.env.GRAPHIFY_OUT || "graphify-out";
const _PENDING_FILENAME = ".pending_changes";
const _PENDING_DRAIN_MAX_PASSES = 20;

// ── Pending file queue ────────────────────────────────────────────────────

export function queuePending(outDir: string, changedPaths: string[]): void {
  if (!changedPaths.length) return;
  fs.mkdirSync(outDir, { recursive: true });
  const pending = path.join(outDir, _PENDING_FILENAME);
  const payload = changedPaths.map((p) => `${p}\n`).join("");
  fs.appendFileSync(pending, payload, "utf-8");
}

export function drainPending(outDir: string): string[] {
  const pending = path.join(outDir, _PENDING_FILENAME);
  if (!fs.existsSync(pending)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(pending, "utf-8");
  } catch {
    return [];
  }
  // Unlink before returning so a crash retains data in the lines we return
  try {
    fs.unlinkSync(pending);
  } catch { /* missing_ok: tolerate racing drain */ }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n|\n/)) {
    const s = line.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function mergeChangedPaths(...sources: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    for (const p of src) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

// ── Rebuild lock (cross-platform) ────────────────────────────────────────

export interface LockResult {
  acquired: boolean;
  release: () => void;
}

export async function rebuildLock(
  outDir: string,
  options: { blocking?: boolean } = {},
): Promise<LockResult> {
  const { blocking = false } = options;
  fs.mkdirSync(outDir, { recursive: true });
  const lockPath = path.join(outDir, ".rebuild.lock");

  // Cross-platform file-based exclusive lock:
  // Try to create the file with 'wx' flag (exclusive write).
  // If it exists, another process holds the lock.
  // On POSIX, we could use flock, but Windows doesn't have it.

  const tryAcquire = (): boolean => {
    try {
      // 'wx' = write + exclusive (fail if exists)
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid}\n`, "utf-8");
      fs.closeSync(fd);
      return true;
    } catch (e: any) {
      if (e.code === "EEXIST") {
        // Lock file exists. If blocking, wait and retry.
        return false;
      }
      // Unexpected error — treat as not acquired
      return false;
    }
  };

  const release = (): void => {
    try {
      // Only release if we own the lock (PID matches)
      if (fs.existsSync(lockPath)) {
        const content = fs.readFileSync(lockPath, "utf-8").trim();
        if (content === String(process.pid)) {
          fs.unlinkSync(lockPath);
        }
      }
    } catch { /* ignore */ }
  };

  if (tryAcquire()) {
    return { acquired: true, release };
  }

  if (blocking) {
    // Poll with retries
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (tryAcquire()) {
        return { acquired: true, release };
      }
    }
    return { acquired: false, release: () => {} };
  }

  return { acquired: false, release: () => {} };
}

// ── Resource limits ──────────────────────────────────────────────────────

export function applyResourceLimits(): void {
  // Node.js has no equivalent for os.nice() or resource.RLIMIT_AS.
  // This is a best-effort no-op on Node.js.
}

// ── Git helper ───────────────────────────────────────────────────────────

export function gitHead(): string | null {
  try {
    const result = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf-8",
      timeout: 3000,
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

// ── Path processing ──────────────────────────────────────────────────────

export function reportRootLabel(watchPath: string): string {
  if (path.isAbsolute(watchPath)) {
    return path.basename(watchPath) || watchPath;
  }
  return watchPath === "." ? path.basename(process.cwd()) : watchPath;
}

export function isRelativeTo(filePath: string, root: string): boolean {
  // Use path.relative to check containment
  const rel = path.relative(root, filePath);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function changedPathCandidates(
  raw: string,
  changeRoot: string,
  watchRoot: string,
): string[] {
  if (path.isAbsolute(raw)) {
    return [path.resolve(raw)];
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const base of [changeRoot, watchRoot]) {
    const cand = path.resolve(base, raw);
    if (seen.has(cand)) continue;
    seen.add(cand);
    candidates.push(cand);
  }
  return candidates;
}

export function relativizeSourceFiles(
  payload: Record<string, any>,
  root: string,
): void {
  for (const bucket of ["nodes", "edges", "hyperedges"]) {
    for (const item of (payload[bucket] as Record<string, any>[]) ?? []) {
      const source = item.source_file;
      if (!source) continue;
      if (!path.isAbsolute(source)) continue;
      try {
        const resolved = path.resolve(source);
        const rel = path.relative(root, resolved).replace(/\\/g, "/");
        item.source_file = rel;
      } catch {
        continue;
      }
    }
  }
}

// ── Graph comparison ─────────────────────────────────────────────────────

export function nodeCommunityMap(graphData: Record<string, any>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const node of graphData.nodes ?? []) {
    const nodeId = node.id;
    const cid = node.community;
    if (nodeId === undefined || cid === undefined || cid === null) continue;
    try {
      out[String(nodeId)] = Number(cid);
    } catch {
      continue;
    }
  }
  return out;
}

function _sortKey(item: any): string {
  return JSON.stringify(item, Object.keys(item).sort());
}

export function canonicalGraphForCompare(graphData: Record<string, any>): Record<string, any> {
  const canonical = { ...graphData };
  delete (canonical as any).built_at_commit;
  for (const key of ["nodes", "links", "edges", "hyperedges"]) {
    if (key in canonical && Array.isArray(canonical[key])) {
      canonical[key] = [...(canonical[key] as any[])].sort((a, b) =>
        _sortKey(a).localeCompare(_sortKey(b)),
      );
    }
  }
  return canonical;
}

export function canonicalTopologyForCompare(graphData: Record<string, any>): Record<string, any> {
  const canonical = { ...graphData };
  delete (canonical as any).built_at_commit;

  const nodes = canonical.nodes;
  if (Array.isArray(nodes)) {
    const normNodes = nodes
      .filter((node: any) => typeof node === "object" && node !== null)
      .map((node: any) => {
        const n = { ...node };
        delete n.community;
        delete n.norm_label;
        return n;
      });
    canonical.nodes = normNodes.sort((a: any, b: any) =>
      _sortKey(a).localeCompare(_sortKey(b)),
    );
  }

  for (const key of ["links", "edges"]) {
    const items = canonical[key];
    if (!Array.isArray(items)) continue;
    const normEdges = items
      .filter((edge: any) => typeof edge === "object" && edge !== null)
      .map((edge: any) => {
        const e = { ...edge };
        const trueSrc = e._src;
        const trueTgt = e._tgt;
        if (trueSrc !== undefined && trueTgt !== undefined) {
          e.source = trueSrc;
          e.target = trueTgt;
        }
        delete e._src;
        delete e._tgt;
        delete e.confidence_score;
        return e;
      });
    canonical[key] = normEdges.sort((a: any, b: any) =>
      _sortKey(a).localeCompare(_sortKey(b)),
    );
  }

  const hyperedges = canonical.hyperedges;
  if (Array.isArray(hyperedges)) {
    canonical.hyperedges = [...hyperedges].sort((a: any, b: any) =>
      _sortKey(a).localeCompare(_sortKey(b)),
    );
  }

  return canonical;
}

export function checkShrink(
  force: boolean,
  existingData: Record<string, any> | null,
  newData: Record<string, any>,
  tmp?: string,
  options: { hadExplicitDeletions?: boolean } = {},
): boolean {
  const { hadExplicitDeletions = false } = options;
  if (force || !existingData || hadExplicitDeletions) return true;
  const existingN = (existingData.nodes ?? []).length;
  const newN = (newData.nodes ?? []).length;
  if (newN < existingN) {
    if (tmp) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
    process.stderr.write(
      `[graphify] WARNING: new graph has ${newN} nodes but existing ` +
      `graph.json has ${existingN}. Refusing to overwrite — you may be ` +
      `missing chunk files from a previous session. ` +
      `Pass --force to override.\n`,
    );
    return false;
  }
  return true;
}

export function reportForCompare(reportText: string): string {
  return reportText.replace(/^- Built from commit: `[^`]+`\n?/gm, "");
}

function _jsonText(data: Record<string, any>): string {
  return JSON.stringify(data, null, 2) + "\n";
}

// ── Core rebuild function ────────────────────────────────────────────────

export interface RebuildCodeDeps {
  detect: (watchPath: string, options?: { followSymlinks?: boolean }) => any;
  extract: (targets: string[], options?: { cacheRoot?: string }) => any;
  getExtractor: (p: string) => any;
  buildFromJson: (result: any) => any;
  normSourceFile: (p: string, root: string) => string;
  cluster: (G: any) => Record<number, string[]>;
  remapCommunities: (communities: any, prevMap: Record<string, number>) => any;
  scoreAll: (G: any, communities: any) => any;
  godNodes: (G: any) => any[];
  surprisingConnections: (G: any, communities: any) => any[];
  suggestQuestions: (G: any, communities: any, labels: any) => string[];
  generate: (...args: any[]) => string;
  toJson: (...args: any[]) => boolean;
  toHtml: (...args: any[]) => void;
  checkGraphFileSizeCap: (p: string) => void;
  backupIfProtected: (outDir: string) => void;
  saveManifest: (files: any, options: any) => void;
  dedupeEdges: (edges: any[]) => any[];
  dedupeNodes: (nodes: any[]) => any[];
}

export async function rebuildCode(
  watchPath: string,
  options: {
    changedPaths?: string[] | null;
    followSymlinks?: boolean;
    force?: boolean;
    noCluster?: boolean;
    acquireLock?: boolean;
    blockOnLock?: boolean;
    deps?: Partial<RebuildCodeDeps>;
  } = {},
): Promise<boolean> {
  const {
    changedPaths = null,
    followSymlinks = false,
    force = false,
    noCluster = false,
    acquireLock = true,
    blockOnLock = false,
  } = options;

  const outDir = path.join(watchPath, _GRAPHIFY_OUT);

  if (acquireLock) {
    if (changedPaths !== null && !blockOnLock) {
      queuePending(outDir, changedPaths);
    }
    const lock = await rebuildLock(outDir, { blocking: blockOnLock });
    if (!lock.acquired) {
      process.stderr.write(
        `[graphify watch] Rebuild already in progress for ` +
        `${path.resolve(watchPath)} - changes queued.\n`,
      );
      return false;
    }
    try {
      let merged: string[] | null;
      if (changedPaths !== null) {
        merged = mergeChangedPaths(changedPaths, drainPending(outDir));
      } else {
        drainPending(outDir);
        merged = null;
      }
      let ok = await rebuildCode(watchPath, {
        changedPaths: merged,
        followSymlinks,
        force,
        noCluster,
        acquireLock: false,
        deps: options.deps,
      });
      if (merged !== null) {
        for (let pass = 0; pass < _PENDING_DRAIN_MAX_PASSES; pass++) {
          const late = drainPending(outDir);
          if (!late.length) break;
          ok = await rebuildCode(watchPath, {
            changedPaths: late,
            followSymlinks,
            force,
            noCluster,
            acquireLock: false,
            deps: options.deps,
          }) && ok;
        }
      }
      return ok;
    } finally {
      lock.release();
    }
  }

  // Import dependencies — either injected or from project modules
  const deps = options.deps ?? {};
  const detectFn = deps.detect ?? ((wp: string) => require("./detect.js").detect(wp, { followSymlinks }));
  const extractFn = deps.extract ?? ((targets: string[], opts: any) => require("./extract/index.js").extract(targets, opts));
  const getExtractor = deps.getExtractor ?? ((p: string) => require("./extract/index.js").getExtractor(p));
  const buildFromJson = deps.buildFromJson ?? ((r: any) => require("./build.js").buildFromJson(r));
  const normSourceFile = deps.normSourceFile ?? ((p: string, r: string) => require("./build.js").normSourceFile(p, r));
  const clusterFn = deps.cluster ?? ((G: any) => require("./cluster.js").cluster(G));
  const remapCommunities = deps.remapCommunities ?? ((c: any, p: Record<string, number>) => require("./cluster.js").remapCommunitiesToPrevious(c, p));
  const scoreAllFn = deps.scoreAll ?? ((G: any, c: any) => require("./cluster.js").scoreAll(G, c));
  const godNodesFn = deps.godNodes ?? ((G: any) => require("./analyze.js").godNodes(G));
  const surprisingConnectionsFn = deps.surprisingConnections ?? ((G: any, c: any) => require("./analyze.js").surprisingConnections(G, c));
  const suggestQuestionsFn = deps.suggestQuestions ?? ((G: any, c: any, l: any) => require("./analyze.js").suggestQuestions(G, c, l));
  const generateFn = deps.generate ?? ((...args: any[]) => require("./report.js").generate(...args));
  const toJsonFn = deps.toJson ?? ((...args: any[]) => require("./export/json.js").toJson(...args));
  const toHtmlFn = deps.toHtml ?? ((...args: any[]) => require("./export/html.js").toHtml(...args));
  const checkCapFn = deps.checkGraphFileSizeCap ?? ((p: string) => { /* no-op if not available */ });
  const backupFn = deps.backupIfProtected ?? ((d: string) => require("./export/index.js").backupIfProtected(d));
  const saveManifestFn = deps.saveManifest ?? ((...args: any[]) => { /* no-op */ });
  const dedupeEdgesFn = deps.dedupeEdges ?? ((e: any[]) => require("./build.js").dedupeEdges(e));
  const dedupeNodesFn = deps.dedupeNodes ?? ((n: any[]) => require("./build.js").dedupeNodes(n));

  const watchRoot = path.resolve(watchPath);
  const projectRoot = path.isAbsolute(watchPath) ? watchRoot : path.resolve(process.cwd());
  const reportRoot = reportRootLabel(watchPath);

  try {
    const detected = detectFn(watchPath, { followSymlinks });
    let codeFiles: string[] = [...(detected?.files?.code ?? [])];

    // Include document files that have AST extractors
    for (const docFile of detected?.files?.document ?? []) {
      if (getExtractor(docFile) !== null) {
        codeFiles.push(docFile);
      }
    }

    if (!codeFiles.length) {
      console.log("[graphify watch] No code files found - nothing to rebuild.");
      return false;
    }

    // Incremental path
    const deletedPaths = new Set<string>();
    const addDeletedSource = (p: string) => {
      for (const root of [projectRoot, watchRoot]) {
        deletedPaths.add(normSourceFile(p, root) || p);
      }
    };

    let extractTargets: string[];
    if (changedPaths !== null) {
      const codeSet = new Set(codeFiles.map((f) => path.resolve(f)));
      const wanted: string[] = [];
      const changeRoot = path.resolve(process.cwd());
      for (const raw of changedPaths) {
        const candidates = changedPathCandidates(raw, changeRoot, watchRoot);
        const tracked = candidates.find((cand) => fs.existsSync(cand) && codeSet.has(cand));
        if (tracked) {
          if (!wanted.includes(tracked)) wanted.push(tracked);
          continue;
        }
        const existingInRoot = candidates.find(
          (cand) => fs.existsSync(cand) && isRelativeTo(cand, watchRoot),
        );
        if (existingInRoot) {
          addDeletedSource(existingInRoot);
          continue;
        }
        const deletedInRoot = candidates.find((cand) => isRelativeTo(cand, watchRoot));
        if (deletedInRoot) {
          addDeletedSource(deletedInRoot);
        }
      }
      if (!wanted.length && !deletedPaths.size) {
        console.log("[graphify watch] No tracked code files in change set - skipping rebuild.");
        return true;
      }
      extractTargets = wanted;
    } else {
      extractTargets = codeFiles;
    }

    const commit = gitHead();
    let result: any;
    if (extractTargets.length) {
      result = extractFn(extractTargets, { cacheRoot: watchRoot });
    } else {
      result = { nodes: [], edges: [], hyperedges: [], input_tokens: 0, output_tokens: 0 };
    }

    // Preserve semantic nodes/edges from a previous full run
    const existingGraph = path.join(outDir, "graph.json");
    let existingGraphData: Record<string, any> = {};
    if (fs.existsSync(existingGraph)) {
      try {
        checkCapFn(existingGraph);
        const existing = JSON.parse(fs.readFileSync(existingGraph, "utf-8"));
        existingGraphData = existing;
        const newAstIds = new Set((result.nodes ?? []).map((n: any) => n.id));
        relativizeSourceFiles(existing, projectRoot);
        const evictSources = new Set<string>(deletedPaths);
        if (changedPaths !== null) {
          for (const p of extractTargets) {
            for (const root of [projectRoot, watchRoot]) {
              evictSources.add(normSourceFile(p, root) || p);
            }
          }
        }
        const fullRebuild = changedPaths === null;
        const preservedNodes = (existing.nodes ?? []).filter(
          (n: any) =>
            !newAstIds.has(n.id) &&
            !(fullRebuild && n._origin === "ast") &&
            (!evictSources.size || !evictSources.has(n.source_file)),
        );
        const allIds = new Set([
          ...newAstIds,
          ...preservedNodes.map((n: any) => n.id),
        ]);
        const preservedEdges = (existing.links ?? existing.edges ?? []).filter(
          (e: any) => allIds.has(e.source) && allIds.has(e.target),
        );
        result = {
          nodes: [...(result.nodes ?? []), ...preservedNodes],
          edges: [...(result.edges ?? []), ...preservedEdges],
          hyperedges: existing.hyperedges ?? [],
          input_tokens: 0,
          output_tokens: 0,
        };
      } catch { /* corrupt graph.json — proceed with AST-only */ }
    }

    relativizeSourceFiles(result, projectRoot);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, ".graphify_root"), watchPath, "utf-8");

    if (noCluster) {
      const candidateGraphData = {
        ...Object.fromEntries(
          Object.entries(result).filter(([k]) => !["edges", "nodes"].includes(k)),
        ),
        nodes: dedupeNodesFn(result.nodes ?? []),
        links: dedupeEdgesFn(result.edges ?? []),
      };
      const candidateGraphText = _jsonText(candidateGraphData);
      let sameGraph = false;
      if (fs.existsSync(existingGraph)) {
        try {
          checkCapFn(existingGraph);
          const existingPayload = JSON.parse(fs.readFileSync(existingGraph, "utf-8"));
          sameGraph =
            JSON.stringify(canonicalGraphForCompare(existingPayload)) ===
            JSON.stringify(canonicalGraphForCompare(candidateGraphData));
        } catch {
          sameGraph = false;
        }
      }
      if (!sameGraph) {
        if (!checkShrink(force, existingGraphData, candidateGraphData, undefined, {
          hadExplicitDeletions: !!deletedPaths.size,
        })) {
          return false;
        }
        fs.writeFileSync(existingGraph, candidateGraphText, "utf-8");
      }

      try { saveManifestFn(detected?.files, { kind: "ast", root: projectRoot }); } catch { /* ignore */ }

      const flag = path.join(outDir, "needs_update");
      try { fs.unlinkSync(flag); } catch { /* ignore */ }

      if (sameGraph) {
        console.log("[graphify watch] No code-graph changes detected (--no-cluster); outputs left untouched.");
      } else {
        console.log(
          `[graphify watch] Rebuilt (no clustering): ` +
          `${(candidateGraphData.nodes ?? []).length} nodes, ` +
          `${(candidateGraphData.links ?? []).length} edges`,
        );
        console.log(`[graphify watch] graph.json updated in ${outDir}`);
      }
      return true;
    }

    const detection = {
      files: { code: codeFiles, document: [], paper: [], image: [] },
      total_files: codeFiles.length,
      total_words: detected?.total_words ?? 0,
    };

    const G = buildFromJson(result);
    // Simplified topology comparison (no node_link_data in graphology)
    let sameTopology = false;
    if (existingGraphData && Object.keys(existingGraphData).length) {
      try {
        const candidateTopology = { nodes: result.nodes, edges: result.edges };
        sameTopology =
          JSON.stringify(canonicalTopologyForCompare(existingGraphData)) ===
          JSON.stringify(canonicalTopologyForCompare(candidateTopology));
      } catch {
        sameTopology = false;
      }
      if (sameTopology) {
        try { saveManifestFn(detected?.files, { kind: "ast", root: projectRoot }); } catch { /* ignore */ }
        const flag = path.join(outDir, "needs_update");
        try { fs.unlinkSync(flag); } catch { /* ignore */ }
        console.log("[graphify watch] No code-graph topology changes detected; outputs left untouched.");
        return true;
      }
    }

    const communities = clusterFn(G);
    const previousNodeCommunity = nodeCommunityMap(existingGraphData);
    const remappedCommunities = previousNodeCommunity && Object.keys(previousNodeCommunity).length
      ? remapCommunities(communities, previousNodeCommunity)
      : communities;
    const cohesion = scoreAllFn(G, remappedCommunities);
    const gods = godNodesFn(G);
    const surprises = surprisingConnectionsFn(G, remappedCommunities);

    const labelsFile = path.join(outDir, ".graphify_labels.json");
    let labels: Record<number, string> = {};
    try {
      if (fs.existsSync(labelsFile)) {
        const raw = JSON.parse(fs.readFileSync(labelsFile, "utf-8"));
        labels = Object.fromEntries(
          Object.entries(raw).filter(([k]) => Number(k) in remappedCommunities).map(([k, v]) => [Number(k), v as string]),
        );
      }
    } catch {
      labels = {};
    }
    for (const cid of Object.keys(remappedCommunities)) {
      const id = Number(cid);
      if (!(id in labels)) labels[id] = `Community ${id}`;
    }

    const questions = suggestQuestionsFn(G, remappedCommunities, labels);
    const report = generateFn(
      G, remappedCommunities, cohesion, labels, gods, surprises, detection,
      { input: 0, output: 0 }, reportRoot,
      { suggestedQuestions: questions, builtAtCommit: commit },
    );

    const reportPath = path.join(outDir, "GRAPH_REPORT.md");
    const labelsJson = JSON.stringify(
      Object.fromEntries(Object.entries(labels).sort(([a], [b]) => Number(a) - Number(b))),
      null, 2,
    ) + "\n";

    const graphTmp = path.join(outDir, ".graph.tmp.json");
    const jsonWritten = toJsonFn(G, remappedCommunities, graphTmp, true, commit);
    if (!jsonWritten) return false;

    let candidateGraphData: Record<string, any>;
    try {
      candidateGraphData = JSON.parse(fs.readFileSync(graphTmp, "utf-8"));
    } catch {
      return false;
    }

    let sameGraph = false;
    let sameReport = false;
    if (fs.existsSync(existingGraph)) {
      try {
        checkCapFn(existingGraph);
        const existingPayload = JSON.parse(fs.readFileSync(existingGraph, "utf-8"));
        sameGraph =
          JSON.stringify(canonicalGraphForCompare(existingPayload)) ===
          JSON.stringify(canonicalGraphForCompare(candidateGraphData));
      } catch {
        sameGraph = false;
      }
    }
    if (fs.existsSync(reportPath)) {
      const oldReport = fs.readFileSync(reportPath, "utf-8");
      sameReport = reportForCompare(oldReport) === reportForCompare(report);
    }

    const noChange = sameGraph && sameReport;
    if (noChange) {
      try { fs.unlinkSync(graphTmp); } catch { /* ignore */ }
      console.log("[graphify watch] No code-graph changes detected; graph.json/GRAPH_REPORT.md left untouched.");
    } else {
      if (!checkShrink(force, existingGraphData, candidateGraphData, graphTmp, {
        hadExplicitDeletions: !!deletedPaths.size,
      })) {
        return false;
      }
      backupFn(outDir);
      fs.renameSync(graphTmp, existingGraph);
      fs.writeFileSync(reportPath, report, "utf-8");
      fs.writeFileSync(labelsFile, labelsJson, "utf-8");
    }

    try { saveManifestFn(detected?.files, { kind: "ast", root: projectRoot }); } catch { /* ignore */ }

    if (!noChange) {
      try {
        toHtmlFn(G, remappedCommunities, path.join(outDir, "graph.html"), { communityLabels: labels });
      } catch (e: any) {
        console.log(`[graphify watch] Skipped graph.html: ${e.message || e}`);
        const stale = path.join(outDir, "graph.html");
        try { fs.unlinkSync(stale); } catch { /* ignore */ }
      }
    }

    const flag = path.join(outDir, "needs_update");
    try { fs.unlinkSync(flag); } catch { /* ignore */ }

    if (!noChange) {
      const nodeCount = typeof G.order === "number" ? G.order : (candidateGraphData.nodes ?? []).length;
      const edgeCount = typeof G.size === "number" ? G.size : (candidateGraphData.edges ?? candidateGraphData.links ?? []).length;
      console.log(
        `[graphify watch] Rebuilt: ${nodeCount} nodes, ` +
        `${edgeCount} edges, ${Object.keys(remappedCommunities).length} communities`,
      );
      console.log(`[graphify watch] graph.json and GRAPH_REPORT.md updated in ${outDir}`);
    }
    return true;
  } catch (exc: any) {
    console.log(`[graphify watch] Rebuild failed: ${exc}`);
    return false;
  }
}

// ── Check update ────────────────────────────────────────────────────────

export function checkUpdate(watchPath: string): boolean {
  const flag = path.join(watchPath, _GRAPHIFY_OUT, "needs_update");
  if (fs.existsSync(flag)) {
    console.log(`[graphify check-update] Pending non-code changes in ${watchPath}.`);
    console.log("[graphify check-update] Run `/graphify --update` to apply semantic re-extraction.");
  }
  return true;
}

// ── File watching ───────────────────────────────────────────────────────

export async function watchPath(
  watchPathStr: string,
  options: { debounce?: number } = {},
): Promise<void> {
  const { debounce: debounceSec = 3.0 } = options;
  let chokidarModule: any;
  try {
    chokidarModule = await import("chokidar");
  } catch {
    throw new Error("chokidar not installed. Run: pnpm add chokidar");
  }

  let lastTrigger = 0;
  let pending = false;
  const changed = new Set<string>();

  const watcher = chokidarModule.watch(watchPathStr, {
    persistent: true,
    ignoreInitial: true,
    ignored: [
      /(^|[/\\])\../,  // dotfiles
      _GRAPHIFY_OUT,   // output dir
      "node_modules",
    ],
  });

  watcher.on("all", (_event: string, filePath: string) => {
    lastTrigger = Date.now();
    pending = true;
    changed.add(filePath);
  });

  console.log(`[graphify watch] Watching ${path.resolve(watchPathStr)} - press Ctrl+C to stop`);
  console.log("[graphify watch] Code changes rebuild graph automatically. " +
    "Doc/image changes require /graphify --update.");
  console.log(`[graphify watch] Debounce: ${debounceSec}s`);

  // Debounce loop
  while (true) {
    await new Promise((r) => setTimeout(r, 500));
    if (pending && (Date.now() - lastTrigger) >= debounceSec * 1000) {
      pending = false;
      const batch = [...changed];
      changed.clear();
      console.log(`\n[graphify watch] ${batch.length} file(s) changed`);
      // Code vs non-code
      const codeExts = new Set([
        ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".cpp",
        ".h", ".hpp", ".rb", ".scala", ".kt", ".swift", ".cs", ".php", ".sh",
      ]);
      const hasCode = batch.some((p) => codeExts.has(path.extname(p).toLowerCase()));
      const hasNonCode = batch.some((p) => !codeExts.has(path.extname(p).toLowerCase()));

      if (hasCode) {
        await rebuildCode(watchPathStr);
      }
      if (hasNonCode) {
        // Write needs_update flag
        const outDir = path.join(watchPathStr, _GRAPHIFY_OUT);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "needs_update"), "1", "utf-8");
        console.log("\n[graphify watch] New or changed files detected in " + watchPathStr);
        console.log("[graphify watch] Non-code files changed - semantic re-extraction requires LLM.");
        console.log("[graphify watch] Run `/graphify --update` to update the graph.");
      }
    }
  }
}
