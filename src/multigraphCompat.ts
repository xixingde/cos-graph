// Runtime compatibility probe for Graphify multigraph mode

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import Graph, { DirectedGraph, UndirectedGraph } from "graphology";

const _require = createRequire(import.meta.url);

export interface CapabilityCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface MultigraphCapabilityResult {
  nodeVersion: string;
  graphologyVersion: string;
  checks: CapabilityCheck[];
  ok: boolean;
  failed: CapabilityCheck[];
  errorMessage: string;
}

let _cached: MultigraphCapabilityResult | null = null;

function _check(name: string, func: () => boolean | string): CapabilityCheck {
  try {
    const detail = func();
    if (detail === true) {
      return { name, ok: true, detail: "ok" };
    }
    if (typeof detail === "string") {
      return { name, ok: false, detail };
    }
    return { name, ok: false, detail: `unexpected result ${JSON.stringify(detail)}` };
  } catch (exc: any) {
    return { name, ok: false, detail: `${exc.constructor?.name || "Error"}: ${exc}` };
  }
}

function _buildProbeGraph(): DirectedGraph {
  const graph = new DirectedGraph({ multi: true });
  graph.addNode("a", { label: "A" });
  graph.addNode("b", { label: "B" });
  graph.addEdgeWithKey("calls:a.py:L1", "a", "b", { relation: "calls", source_file: "a.py" });
  graph.addEdgeWithKey("imports:a.py:L2", "a", "b", { relation: "imports", source_file: "a.py" });
  return graph;
}

function _probeKeyedParallelEdges(): boolean | string {
  const graph = _buildProbeGraph();
  if (!graph.multi) {
    return `probe graph multi flag was ${graph.multi}`;
  }
  const edgeCount = graph.edges("a", "b").length;
  if (edgeCount !== 2) {
    return `expected 2 keyed parallel edges, got ${edgeCount}`;
  }
  const keys = new Set(graph.edges("a", "b"));
  const expected = new Set(["calls:a.py:L1", "imports:a.py:L2"]);
  const match = keys.size === expected.size && [...keys].every((k) => expected.has(k));
  if (!match) {
    return `expected keys ${[...expected].sort()}, got ${[...keys].sort()}`;
  }
  return true;
}

function _probeNodeLinkRoundTrip(): boolean | string {
  const graph = _buildProbeGraph();
  // Serialize using graphToJSON-like logic
  const nodes: any[] = [];
  const links: any[] = [];
  graph.forEachNode((node: string, attrs: Record<string, unknown>) => {
    nodes.push({ id: node, ...attrs });
  });
  graph.forEachEdge(
    (edge: string, attrs: Record<string, unknown>, source: string, target: string) => {
      links.push({ key: edge, source, target, ...attrs });
    }
  );
  const data = { directed: true, multigraph: true, nodes, links };
  if (data.multigraph !== true) {
    return `serialized multigraph flag was ${JSON.stringify(data.multigraph)}`;
  }
  if (data.directed !== true) {
    return `serialized directed flag was ${JSON.stringify(data.directed)}`;
  }
  if (!Array.isArray(links) || links.length !== 2) {
    return `serialized links length was ${Array.isArray(links) ? links.length : 0}`;
  }
  const serializedKeys: Set<string> = new Set();
  for (const edge of links) {
    if (typeof edge === "object" && edge !== null && typeof edge.key === "string") {
      serializedKeys.add(edge.key);
    }
  }
  const expected = new Set(["calls:a.py:L1", "imports:a.py:L2"]);
  const match = serializedKeys.size === expected.size && [...serializedKeys].every((k) => expected.has(k));
  if (!match) {
    return `serialized keys ${[...serializedKeys].sort()} did not match ${[...expected].sort()}`;
  }
  // Deserialize: recreate graph from the data
  const loaded = new DirectedGraph({ multi: true });
  for (const node of data.nodes) {
    const { id, ...rest } = node;
    loaded.addNode(id, rest);
  }
  for (const link of data.links) {
    const { source, target, key, ...rest } = link;
    if (loaded.hasNode(source) && loaded.hasNode(target)) {
      loaded.addEdgeWithKey(key, source, target, rest);
    }
  }
  if (!loaded.multi) {
    return `round-trip graph multi flag was ${loaded.multi}`;
  }
  const loadedEdgeCount = loaded.edges("a", "b").length;
  if (loadedEdgeCount !== 2) {
    return `round-trip edge count was ${loadedEdgeCount}`;
  }
  const loadedKeys = new Set(loaded.edges("a", "b"));
  const loadedMatch = loadedKeys.size === expected.size && [...loadedKeys].every((k) => expected.has(k));
  if (!loadedMatch) {
    return `round-trip keys ${[...loadedKeys].sort()} did not match ${[...expected].sort()}`;
  }
  return true;
}

function _probeDuplicateKeyOverwriteSemantics(): boolean | string {
  const graph = new DirectedGraph({ multi: true });
  graph.addEdgeWithKey("same", "x", "y", { marker: "first" });
  graph.addEdgeWithKey("same", "x", "y", { marker: "second" });
  // Graphology with duplicate key: the second addEdgeWithKey should update attributes
  const edgeAttrs = graph.getEdgeAttributes("same");
  if (edgeAttrs.marker !== "second") {
    return `expected second attr overwrite, got ${JSON.stringify(edgeAttrs.marker)}`;
  }
  const edgeCount = graph.edges("x", "y").length;
  if (edgeCount !== 1) {
    return `expected one edge after duplicate-key add, got ${edgeCount}`;
  }
  return true;
}

function _probeRemoveEdgesFromTwoTupleSemantics(): boolean | string {
  const graph = new DirectedGraph({ multi: true });
  graph.addNode("a");
  graph.addNode("b");
  graph.addEdgeWithKey("one", "a", "b", {});
  graph.addEdgeWithKey("two", "a", "b", {});
  // In Graphology, we can remove by edge key
  graph.dropEdge("one");
  const remaining = graph.edges("a", "b").length;
  if (remaining !== 1) {
    return `expected one remaining edge after removal, got ${remaining}`;
  }
  return true;
}

function _probeToUndirectedPreservesMultigraphType(): boolean | string {
  const directed = _buildProbeGraph();
  // Graphology does not have to_undirected() like NetworkX
  // We verify that copying nodes/edges to an undirected multi graph preserves data
  const undirected = new UndirectedGraph({ multi: true });
  directed.forEachNode((node: string, attrs: Record<string, unknown>) => {
    undirected.addNode(node, attrs);
  });
  directed.forEachEdge(
    (edge: string, attrs: Record<string, unknown>, source: string, target: string) => {
      undirected.addEdgeWithKey(edge, source, target, attrs);
    }
  );
  if (!undirected.multi) {
    return `undirected graph multi flag was ${undirected.multi}`;
  }
  const edgeCount = undirected.edges("a", "b").length;
  if (edgeCount !== 2) {
    return `undirected edge count was ${edgeCount}, expected 2`;
  }
  return true;
}
function _getGraphologyVersion(): string {
  try {
    const pkgPath = path.join(path.dirname(_require.resolve("graphology")), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}

export function probeMultigraphCapabilities(): MultigraphCapabilityResult {
  if (_cached) return _cached;

  const checks: CapabilityCheck[] = [
    _check("keyed_parallel_edges", _probeKeyedParallelEdges),
    _check("node_link_edges_links_round_trip", _probeNodeLinkRoundTrip),
    _check("duplicate_key_overwrite_semantics", _probeDuplicateKeyOverwriteSemantics),
    _check("remove_edges_from_two_tuple_semantics", _probeRemoveEdgesFromTwoTupleSemantics),
    _check("to_undirected_preserves_multigraph_type", _probeToUndirectedPreservesMultigraphType),
  ];

  const ok = checks.every((c) => c.ok);
  const failed = checks.filter((c) => !c.ok);

  let errorMessage: string;
  if (ok) {
    errorMessage =
      `Graphify MultiDiGraph capability probe passed ` +
      `(Node ${process.version}, Graphology ${_getGraphologyVersion()}).`;
  } else {
    const failedStr = failed.map((c) => `${c.name}: ${c.detail}`).join("; ");
    errorMessage =
      `error: --multigraph requires Graphology keyed MultiDiGraph node-link ` +
      `round-trip support. ` +
      `Detected Node ${process.version}, Graphology ${_getGraphologyVersion()}. ` +
      `Failed capability check(s): ${failedStr}. ` +
      `Default simple graph mode remains available.`;
  }

  _cached = {
    nodeVersion: process.version,
    graphologyVersion: _getGraphologyVersion(),
    checks,
    ok,
    failed,
    errorMessage,
  };

  return _cached;
}

export function requireMultigraphCapabilities(): MultigraphCapabilityResult {
  const result = probeMultigraphCapabilities();
  if (!result.ok) {
    throw new Error(result.errorMessage);
  }
  return result;
}
