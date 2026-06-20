// Global graph management -- add/remove/list project graphs in a shared global graph

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

import Graph from "graphology";
import { prefixGraphForGlobal, pruneRepoFromGraph } from "./build.js";
import { checkGraphFileSizeCap } from "./security.js";
import { graphFromJSON, graphToJSON } from "./graph/index.js";

const _GLOBAL_DIR = path.join(os.homedir(), ".graphify");
const _GLOBAL_GRAPH = path.join(_GLOBAL_DIR, "global-graph.json");
const _GLOBAL_MANIFEST = path.join(_GLOBAL_DIR, "global-manifest.json");

export interface GlobalAddResult {
  repo_tag: string;
  nodes_added: number;
  nodes_removed: number;
  skipped: boolean;
}

function _loadManifest(): Record<string, any> {
  if (fs.existsSync(_GLOBAL_MANIFEST)) {
    try {
      return JSON.parse(fs.readFileSync(_GLOBAL_MANIFEST, "utf-8"));
    } catch (exc: any) {
      const backup = _GLOBAL_MANIFEST + `.corrupt.${Math.floor(Date.now() / 1000)}`;
      try {
        fs.renameSync(_GLOBAL_MANIFEST, backup);
        console.error(
          `[graphify global] manifest at ${_GLOBAL_MANIFEST} failed to parse (${exc}); ` +
            `moved to ${backup} and starting fresh. Restore from the backup if this was ` +
            `unexpected.`
        );
      } catch (renameExc: any) {
        console.error(
          `[graphify global] manifest at ${_GLOBAL_MANIFEST} failed to parse (${exc}) ` +
            `and could not be backed up (${renameExc}). Starting fresh.`
        );
      }
    }
  }
  return { version: 1, repos: {} };
}

function _saveManifest(manifest: Record<string, any>): void {
  fs.mkdirSync(_GLOBAL_DIR, { recursive: true });
  fs.writeFileSync(_GLOBAL_MANIFEST, JSON.stringify(manifest, null, 2), "utf-8");
}

function _loadGlobalGraph(): Graph {
  if (fs.existsSync(_GLOBAL_GRAPH)) {
    checkGraphFileSizeCap(_GLOBAL_GRAPH);
    const data = JSON.parse(fs.readFileSync(_GLOBAL_GRAPH, "utf-8"));
    if (!("links" in data) && "edges" in data) {
      (data as any).links = (data as any).edges;
    }
    return graphFromJSON(data as any);
  }
  return new Graph({ type: "undirected" });
}

function _saveGlobalGraph(G: Graph): void {
  fs.mkdirSync(_GLOBAL_DIR, { recursive: true });
  const data = graphToJSON(G);
  fs.writeFileSync(_GLOBAL_GRAPH, JSON.stringify(data, null, 2), "utf-8");
}

function _fileHash(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

export function globalAdd(sourcePath: string, repoTag: string): GlobalAddResult {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`graph not found: ${sourcePath}`);
  }

  const manifest = _loadManifest();
  const srcHash = _fileHash(sourcePath);

  const existing = manifest.repos[repoTag] || {};
  const existingPath = existing.source_path || "";
  const resolvedPath = path.resolve(sourcePath);
  if (existingPath && existingPath !== resolvedPath) {
    console.error(
      `[graphify global] warning: repo tag '${repoTag}' previously pointed to ` +
        `'${existingPath}', now updating to '${resolvedPath}'. ` +
        `Use --as <tag> to give it a different name.`
    );
  }
  if (existing.source_hash === srcHash) {
    return { repo_tag: repoTag, nodes_added: 0, nodes_removed: 0, skipped: true };
  }

  // Load source graph
  checkGraphFileSizeCap(sourcePath);
  let data = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
  if (!("links" in data) && "edges" in data) {
    data.links = data.edges;
  }
  const srcG = graphFromJSON(data);

  // Prefix IDs for cross-project isolation
  const prefixed = prefixGraphForGlobal(srcG, repoTag);

  // Load global graph and prune stale nodes for this repo
  const G = _loadGlobalGraph();
  const removed = pruneRepoFromGraph(G, repoTag);

  // Merge external-library nodes (no source_file) by label to avoid duplication
  const externalLabels: Record<string, string> = {};
  G.forEachNode((node: string, attrs: Record<string, unknown>) => {
    if (!attrs.source_file && attrs.label) {
      externalLabels[String(attrs.label)] = node;
    }
  });

  // Map each deduplicated external onto the existing global node
  const remap: Record<string, string> = {};
  prefixed.forEachNode((node: string, attrs: Record<string, unknown>) => {
    if (!attrs.source_file && attrs.label && String(attrs.label) in externalLabels) {
      remap[node] = externalLabels[String(attrs.label)];
    }
  });

  // Compose: add prefixed nodes (except deduplicated externals) into global graph
  prefixed.forEachNode((node: string, attrs: Record<string, unknown>) => {
    if (!(node in remap)) {
      G.addNode(node, attrs);
    }
  });
  prefixed.forEachEdge(
    (_edge: string, attrs: Record<string, unknown>, source: string, target: string) => {
      const u = remap[source] || source;
      const v = remap[target] || target;
      if (u !== v) {
        G.addEdge(u, v, attrs);
      }
    }
  );

  const added = prefixed.order - Object.keys(remap).length;
  _saveGlobalGraph(G);

  manifest.repos[repoTag] = {
    added_at: new Date().toISOString(),
    source_path: resolvedPath,
    node_count: added,
    edge_count: prefixed.size,
    source_hash: srcHash,
  };
  _saveManifest(manifest);

  return { repo_tag: repoTag, nodes_added: added, nodes_removed: removed, skipped: false };
}

export function globalRemove(repoTag: string): number {
  const manifest = _loadManifest();
  if (!(repoTag in manifest.repos)) {
    throw new Error(`repo '${repoTag}' not in global graph`);
  }

  const G = _loadGlobalGraph();
  const removed = pruneRepoFromGraph(G, repoTag);
  _saveGlobalGraph(G);

  delete manifest.repos[repoTag];
  _saveManifest(manifest);
  return removed;
}

export function globalList(): Record<string, any> {
  return _loadManifest().repos || {};
}

export function globalPath(): string {
  return _GLOBAL_GRAPH;
}
