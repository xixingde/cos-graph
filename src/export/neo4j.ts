import type Graph from "graphology";

/** Push graph directly to a running Neo4j instance via the JS driver — TODO stub.
 *
 * Requires: npm install neo4j-driver
 * Not yet implemented.
 */
export function pushToNeo4j(
  _graph: Graph,
  _uri: string,
  _user: string,
  _password: string,
  _communities?: Record<number, string[]>,
): Record<string, number> {
  throw new Error("Not implemented: pushToNeo4j requires neo4j-driver. Install with: npm install neo4j-driver");
}
