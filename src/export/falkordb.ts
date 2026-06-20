import type Graph from "graphology";

/** Push graph directly to a running FalkorDB instance via the JS SDK — TODO stub.
 *
 * Requires: npm install falkordb
 * Not yet implemented.
 */
export function pushToFalkorDB(
  _graph: Graph,
  _uri: string,
  _user?: string,
  _password?: string,
  _communities?: Record<number, string[]>,
  _graphName?: string,
): Record<string, number> {
  throw new Error("Not implemented: pushToFalkorDB requires falkordb SDK. Install with: npm install falkordb");
}
