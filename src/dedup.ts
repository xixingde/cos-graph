/** Entity deduplication pipeline for graphify knowledge graphs.
 *
 * Pipeline: exact normalization → entropy gate → MinHash/LSH blocking →
 * Jaro-Winkler verification → same-community boost → union-find merge.
 *
 * Ported from graphify/dedup.py (550 lines, 18 functions).
 * LLM tiebreak is left as TODO (depends on phase-3 llm module).
 */
import { MinHash, MinHashLSH } from "./minhash.js";
import type { NodeAttributes, EdgeAttributes, CommunityMap } from "./types/graph.js";

// ── Jaro / Jaro-Winkler / Damerau-Levenshtein (pure JS) ────────────────────

function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const l1 = s1.length;
  const l2 = s2.length;
  if (l1 === 0 && l2 === 0) return 1.0;
  if (l1 === 0 || l2 === 0) return 0.0;

  const matchDistance = Math.floor(Math.max(l1, l2) / 2) - 1;
  const s1Matches = new Uint8Array(l1);
  const s2Matches = new Uint8Array(l2);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < l1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, l2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = 1;
      s2Matches[j] = 1;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < l1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  return (matches / l1 + matches / l2 + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinklerSimilarity(s1: string, s2: string, prefixWeight = 0.1): number {
  const jaro = jaroSimilarity(s1, s2);
  const minLen = Math.min(s1.length, s2.length);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, minLen); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * prefixWeight * (1 - jaro);
}

/** Optimal string alignment distance (restricted Damerau-Levenshtein). */
function osaDistance(s1: string, s2: string): number {
  const l1 = s1.length;
  const l2 = s2.length;
  const d: number[][] = Array.from({ length: l1 + 1 }, () => new Array(l2 + 1).fill(0));
  for (let i = 0; i <= l1; i++) d[i][0] = i;
  for (let j = 0; j <= l2; j++) d[0][j] = j;
  for (let i = 1; i <= l1; i++) {
    for (let j = 1; j <= l2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[l1][l2];
}

// ── helpers ──────────────────────────────────────────────────────────────────

const _NON_ALNUM_RUN = /[\W_]+/g;

/** Lowercase + collapse non-alphanumeric runs to space (Unicode-aware). */
export function norm(label: string | null | undefined): string {
  if (typeof label !== "string") label = label == null ? "" : String(label);
  label = label.normalize("NFKC");
  return label.toLocaleLowerCase().replace(_NON_ALNUM_RUN, " ").trim();
}

/** Shannon entropy in bits/char of the normalised label. */
export function entropy(label: string): number {
  const s = norm(label);
  if (!s) return 0.0;
  const freq: Map<string, number> = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  const n = s.length;
  let h = 0;
  for (const c of freq.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Return k-gram character shingles of text. */
export function shingles(text: string, k = 3): Set<string> {
  if (text.length < k) return new Set([text]);
  const result = new Set<string>();
  for (let i = 0; i <= text.length - k; i++) result.add(text.slice(i, i + k));
  return result;
}

export function makeMinhash(text: string, numPerm = 128): MinHash {
  const m = new MinHash(numPerm);
  for (const sh of shingles(text.replace(/ /g, ""))) {
    m.update(Buffer.from(sh, "utf-8") as unknown as Uint8Array);
  }
  return m;
}

// Matches labels whose trailing token is a version/variant suffix
const _VARIANT_SUFFIX = /^(.*[a-z])([0-9]+[a-z]*|[a-z]{2,})$/;

/** True if a and b are sibling model/SKU variants (same stem, different suffix). */
export function isVariantPair(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.max(a.length, b.length) >= 12) return false;
  const ma = _VARIANT_SUFFIX.exec(a);
  const mb = _VARIANT_SUFFIX.exec(b);
  if (!ma || !mb) return false;
  return ma[1] === mb[1] && ma[2] !== mb[2];
}

/** Block fuzzy merge for short labels unless it's a same-length single-char substitution. */
export function shortLabelBlocked(a: string, b: string, jwScore: number): boolean {
  if (Math.max(a.length, b.length) >= 12) return false;
  if (jwScore >= 97.0 && a.length === b.length && osaDistance(a, b) <= 1) return false;
  return true;
}

const _DIGIT_RUN = /\d+/g;

/** True when two labels carry different embedded numbers. */
export function numericTokensDiffer(a: string, b: string): boolean {
  if (a === b) return false;
  const stripZero = (t: string) => t.replace(/^0+/, "") || "0";
  const da = a.match(_DIGIT_RUN) ?? [];
  const db = b.match(_DIGIT_RUN) ?? [];
  const sa = da.map(stripZero).sort().join(",");
  const sb = db.map(stripZero).sort().join(",");
  return sa !== sb;
}

// file_type values whose identity is anchored to their source location
const _FILE_ANCHORED_NONCODE = new Set(["rationale", "document"]);

/** Block label-based merging of file-anchored non-code nodes across files. */
export function crossfileFileanchoredBlocked(
  node: Record<string, unknown>,
  neighbor: Record<string, unknown>,
): boolean {
  const aType = _nodeStr(node, "file_type");
  const bType = _nodeStr(neighbor, "file_type");
  if (!_FILE_ANCHORED_NONCODE.has(aType) && !_FILE_ANCHORED_NONCODE.has(bType)) {
    return false;
  }
  return _nodeStr(node, "source_file") !== _nodeStr(neighbor, "source_file");
}

// ── union-find ────────────────────────────────────────────────────────────────

class UnionFind {
  private _parent: Map<string, string> = new Map();

  find(x: string): string {
    if (!this._parent.has(x)) this._parent.set(x, x);
    let cur = x;
    while (this._parent.get(cur)! !== cur) {
      const p = this._parent.get(cur)!;
      this._parent.set(cur, this._parent.get(p)!); // path splitting
      cur = p;
    }
    return cur;
  }

  union(x: string, y: string): void {
    if (!this._parent.has(x)) this._parent.set(x, x);
    if (!this._parent.has(y)) this._parent.set(y, y);
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx !== ry) this._parent.set(ry, rx);
  }

  components(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const x of this._parent.keys()) {
      const root = this.find(x);
      let list = groups.get(root);
      if (!list) {
        list = [];
        groups.set(root, list);
      }
      list.push(x);
    }
    return groups;
  }
}

// ── constants ─────────────────────────────────────────────────────────────────

const _ENTROPY_THRESHOLD = 2.5;
const _LSH_THRESHOLD = 0.7;
const _MERGE_THRESHOLD = 92.0;
const _COMMUNITY_BOOST = 5.0;
const _NUM_PERM = 128;
const _CHUNK_SUFFIX = /_c\d+$/;

/** Read node field accepting both snake_case (raw) and camelCase (typed) keys. */
function _nodeStr(node: Record<string, unknown>, key: string): string {
  const v = node[key] ?? node[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
  return (v != null && v !== "") ? String(v) : "";
}

/** True for AST-extracted code symbols — their identity is the node ID, not the label. */
function isCode(node: Record<string, unknown>): boolean {
  return _nodeStr(node, "file_type") === "code";
}

// ── main entry point ─────────────────────────────────────────────────────────

export interface DeduplicateOptions {
  communities?: CommunityMap;
  dedupLlmBackend?: string;
}

export interface DeduplicateResult {
  nodes: NodeAttributes[];
  edges: EdgeAttributes[];
}

export function deduplicateEntities(
  nodes: NodeAttributes[],
  edges: EdgeAttributes[],
  options: DeduplicateOptions = {},
): DeduplicateResult {
  const communities = options.communities ?? {};
  const dedupLlmBackend = options.dedupLlmBackend;

  // Guard: cross-project dedup is not supported
  const reposSeen = new Set<string>();
  for (const n of nodes) {
    const repo = n.repo as string | undefined;
    if (repo) reposSeen.add(repo);
  }
  if (reposSeen.size > 1) {
    throw new Error(
      `deduplicateEntities: nodes span multiple repos [${[...reposSeen].sort().join(", ")}]. ` +
      `Cross-project dedup is disabled — run dedup per-repo before merging.`,
    );
  }

  if (nodes.length <= 1) return { nodes, edges };

  // Pre-deduplicate: keep first occurrence of each id
  const seenIds = new Map<string, NodeAttributes>();
  for (const node of nodes) {
    const nid = node.id ?? "";
    if (nid && !seenIds.has(nid)) seenIds.set(nid, node);
  }
  const uniqueNodes = [...seenIds.values()];

  if (uniqueNodes.length <= 1) return { nodes: uniqueNodes, edges };

  // ── pass 1: exact normalization ───────────────────────────────────────────
  const normToNodes = new Map<string, NodeAttributes[]>();
  for (const node of uniqueNodes) {
    if (isCode(node as Record<string, unknown>)) continue;
    const key = norm(node.label ?? node.id ?? "");
    if (key) {
      let list = normToNodes.get(key);
      if (!list) {
        list = [];
        normToNodes.set(key, list);
      }
      list.push(node);
    }
  }

  const uf = new UnionFind();
  let exactMerges = 0;

  for (const [, group] of normToNodes) {
    if (group.length <= 1) continue;
    // Partition by source_file
    const byFile = new Map<string, NodeAttributes[]>();
    for (const node of group) {
      const sf = _nodeStr(node as Record<string, unknown>, "source_file");
      let list = byFile.get(sf);
      if (!list) {
        list = [];
        byFile.set(sf, list);
      }
      list.push(node);
    }
    for (const [sf, fileGroup] of byFile) {
      if (!sf) continue; // no source_file — skip
      if (fileGroup.length > 1) {
        const winner = pickWinner(fileGroup);
        for (const node of fileGroup) {
          uf.union(winner.id, node.id);
        }
        exactMerges += fileGroup.length - 1;
      }
    }
  }

  // ── pass 2: MinHash/LSH + Jaro-Winkler (high-entropy nodes only) ─────────
  const candidates: NodeAttributes[] = [];
  const seenNorms = new Set<string>();
  for (const node of uniqueNodes) {
    if (isCode(node as Record<string, unknown>)) continue;
    const key = norm(node.label ?? node.id ?? "");
    if (key && !seenNorms.has(key)) {
      seenNorms.add(key);
      if (entropy(node.label ?? "") >= _ENTROPY_THRESHOLD) {
        candidates.push(node);
      }
    }
  }

  let fuzzyMerges = 0;
  if (candidates.length >= 2) {
    const candidatesById = new Map<string, NodeAttributes>();
    const normCache = new Map<string, string>();

    for (const node of candidates) {
      const nodeId = node.id;
      candidatesById.set(nodeId, node);
      const nl = norm(node.label ?? node.id ?? "");
      normCache.set(nodeId, nl);
    }

    // Build neighbor pairs: use LSH for large candidate sets, all-pairs for small
    const neighborPairs: [string, string][] = [];
    if (candidates.length <= 50) {
      // All-pairs comparison — avoids LSH recall gaps from PRNG differences
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          neighborPairs.push([candidates[i].id, candidates[j].id]);
        }
      }
    } else {
      const lsh = new MinHashLSH(_LSH_THRESHOLD, _NUM_PERM);
      const minhashes = new Map<string, MinHash>();
      for (const node of candidates) {
        const nodeId = node.id;
        const m = makeMinhash(normCache.get(nodeId)!);
        minhashes.set(nodeId, m);
        try {
          lsh.insert(nodeId, m);
        } catch {
          // duplicate key — already inserted
        }
      }
      for (const node of candidates) {
        const nodeId = node.id;
        for (const neighborId of lsh.query(minhashes.get(nodeId)!)) {
          if (neighborId !== nodeId) {
            neighborPairs.push([nodeId, neighborId]);
          }
        }
      }
    }

    const seenPairs = new Set<string>();
    for (const [nodeId, neighborId] of neighborPairs) {
      const pairKey = nodeId < neighborId ? `${nodeId}\0${neighborId}` : `${neighborId}\0${nodeId}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      {
        const node = candidatesById.get(nodeId)!;
        if (uf.find(nodeId) === uf.find(neighborId)) continue;

        const neighbor = candidatesById.get(neighborId);
        if (!neighbor) continue;

        const normLabel = normCache.get(nodeId)!;
        const neighborNorm = normCache.get(neighborId) ?? norm(neighbor.label ?? neighbor.id ?? "");
        const xfile = _nodeStr(node as Record<string, unknown>, "source_file") !==
                       _nodeStr(neighbor as Record<string, unknown>, "source_file");
        let score: number;
        if (xfile && Math.max(normLabel.length, neighborNorm.length) >= 12) {
          score = jaroSimilarity(normLabel, neighborNorm) * 100;
        } else {
          score = jaroWinklerSimilarity(normLabel, neighborNorm) * 100;
        }

        if (isVariantPair(normLabel, neighborNorm)) continue;
        if (shortLabelBlocked(normLabel, neighborNorm, score)) continue;
        // Prefix-extension guard
        const sorted = normLabel.length <= neighborNorm.length
          ? [normLabel, neighborNorm] as const
          : [neighborNorm, normLabel] as const;
        const lo = sorted[0];
        const hi = sorted[1];
        if (hi.startsWith(lo) && hi !== lo) continue;
        // Numbered/versioned siblings and cross-file file-anchored boilerplate
        if (numericTokensDiffer(normLabel, neighborNorm)) continue;
        if (crossfileFileanchoredBlocked(node as Record<string, unknown>, neighbor as Record<string, unknown>)) continue;

        const c1 = communities[nodeId];
        const c2 = communities[neighborId];
        if (c1 != null && c2 != null && c1 === c2 &&
            Math.min(normLabel.length, neighborNorm.length) >= 12) {
          score += _COMMUNITY_BOOST;
        }

        if (score >= _MERGE_THRESHOLD) {
          // Identical labels across different source files — block
          if (normLabel === neighborNorm) {
            const sfA = _nodeStr(node as Record<string, unknown>, "source_file");
            const sfB = _nodeStr(neighbor as Record<string, unknown>, "source_file");
            if (sfA !== sfB) continue;
          }
          // Pick winner from the verified pair only
          const winner = pickWinner([node, neighbor]);
          uf.union(winner.id, nodeId);
          uf.union(winner.id, neighborId);
          fuzzyMerges++;
        }
      }
    }
  }

  // ── pass 3: LLM tiebreaker — TODO (depends on phase-3 llm module) ────────
  if (dedupLlmBackend != null) {
    // TODO: implement LLM tiebreak when llm module is available
  }

  // ── build remap table from union-find components ──────────────────────────
  const components = uf.components();
  const remap = new Map<string, string>();

  for (const [, members] of components) {
    if (members.length === 1) continue;
    const groupNodes = uniqueNodes.filter((n) => members.includes(n.id));
    const winner = groupNodes.length > 0 ? pickWinner(groupNodes) : { id: members[0] };
    const winnerId = winner.id;
    for (const member of members) {
      if (member !== winnerId) remap.set(member, winnerId);
    }
  }

  // ── apply remap ───────────────────────────────────────────────────────────
  if (remap.size === 0) return { nodes: uniqueNodes, edges };

  const total = remap.size;
  let msg = `[graphify] Deduplicated ${total} node(s)`;
  if (exactMerges) {
    msg += ` (${exactMerges} exact`;
    if (fuzzyMerges) msg += `, ${fuzzyMerges} fuzzy`;
    msg += ")";
  }
  console.log(msg + ".");

  const dedupedNodes = uniqueNodes.filter((n) => !remap.has(n.id));
  const dedupedEdges: EdgeAttributes[] = [];
  for (const edge of edges) {
    const e: Record<string, unknown> = { ...edge };
    // Tolerate "from"/"to" keys from LLM backends
    let src = "source" in e ? e.source as string : e.from as string | undefined;
    let tgt = "target" in e ? e.target as string : e.to as string | undefined;
    if (src == null || tgt == null) continue;
    (e as Record<string, unknown>).source = remap.get(src) ?? src;
    (e as Record<string, unknown>).target = remap.get(tgt) ?? tgt;
    delete e.from;
    delete e.to;
    if (e.source !== e.target) {
      dedupedEdges.push(e as EdgeAttributes);
    }
  }

  return { nodes: dedupedNodes, edges: dedupedEdges };
}

// ── winner selection ─────────────────────────────────────────────────────────

/** Pick the canonical survivor: prefer no chunk suffix, then shorter ID. */
export function pickWinner(nodes: NodeAttributes[]): NodeAttributes {
  if (nodes.length === 0) throw new Error("Cannot pick winner from empty list");
  return nodes.reduce((best, n) => {
    const bestHasSuffix = _CHUNK_SUFFIX.test(best.id) ? 1 : 0;
    const nHasSuffix = _CHUNK_SUFFIX.test(n.id) ? 1 : 0;
    if (nHasSuffix < bestHasSuffix) return n;
    if (nHasSuffix === bestHasSuffix && n.id.length < best.id.length) return n;
    return best;
  });
}
