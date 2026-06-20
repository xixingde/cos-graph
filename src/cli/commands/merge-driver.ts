import type { Command } from "commander";
import { loadGraph, communitiesFromGraph } from "../../serve/query-engine.js";
import { graphFromJSON, graphToJSON } from "../../graph/factory.js";
import { buildMerge } from "../../build.js";
import * as fs from "fs";

export function registerMergeDriverCommand(program: Command): void {
  program
    .command("merge-driver")
    .description("Git merge driver for graph.json files")
    .argument("<base>", "base version of the file")
    .argument("<current>", "current version of the file")
    .argument("<other>", "other version of the file")
    .action((base: string, current: string, other: string) => {
      try {
        const baseData = fs.existsSync(base) ? JSON.parse(fs.readFileSync(base, "utf-8")) : { nodes: [], edges: [] };
        const currentData = fs.existsSync(current) ? JSON.parse(fs.readFileSync(current, "utf-8")) : { nodes: [], edges: [] };
        const otherData = fs.existsSync(other) ? JSON.parse(fs.readFileSync(other, "utf-8")) : { nodes: [], edges: [] };

        const baseNodes = (baseData.nodes ?? []) as Record<string, unknown>[];
        const currentNodes = (currentData.nodes ?? []) as Record<string, unknown>[];
        const otherNodes = (otherData.nodes ?? []) as Record<string, unknown>[];

        const allNodes = [...baseNodes, ...currentNodes, ...otherNodes];
        const seen = new Map<string, Record<string, unknown>>();
        for (const n of allNodes) {
          const id = n["id"] as string;
          if (!id) continue;
          if (!seen.has(id)) seen.set(id, n);
        }

        const mergedNodes = [...seen.values()];
        const currentEdges = (currentData.links ?? currentData.edges ?? []) as Record<string, unknown>[];
        const otherEdges = (otherData.links ?? otherData.edges ?? []) as Record<string, unknown>[];
        const edgeSeen = new Set<string>();
        const mergedEdges: Record<string, unknown>[] = [];
        for (const e of [...currentEdges, ...otherEdges]) {
          const key = `${e.source}|${e.target}|${e.relation ?? ""}`;
          if (!edgeSeen.has(key)) {
            edgeSeen.add(key);
            mergedEdges.push(e);
          }
        }

        const result = { ...currentData, nodes: mergedNodes, links: mergedEdges, directed: true };
        fs.writeFileSync(current, JSON.stringify(result, null, 2), "utf-8");
        console.log("Merge completed successfully.");
      } catch (exc: any) {
        console.error(`Merge failed: ${exc.message}`);
        process.exit(1);
      }
    });
}
