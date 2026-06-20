import type { Command } from "commander";
import { loadGraph, communitiesFromGraph } from "../../serve/query-engine.js";
import {
  toHtml,
  toObsidian,
  toCanvas,
  toCypher,
  toGraphml,
  toSvg,
  toJson,
  pushToNeo4j,
  pushToFalkorDB,
} from "../../export/index.js";
import { toWiki } from "../../wiki.js";
import { writeCallflowHtml } from "../../callflowHtml.js";
import * as fs from "fs";
import * as path from "path";

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Export graph in various formats")
    .argument("<format>", "export format: html, callflow-html, obsidian, canvas, wiki, svg, graphml, cypher, neo4j, falkordb")
    .option("--graph <path>", "path to graph.json", "graphify-out/graph.json")
    .option("--output <path>", "output path (default depends on format)")
    .option("--node-limit <n>", "max nodes for HTML viz")
    .option("--uri <uri>", "database URI (for neo4j/falkordb)")
    .option("--user <user>", "database user (for neo4j)")
    .option("--password <password>", "database password (for neo4j/falkordb)")
    .option("--graph-name <name>", "graph name (for falkordb)")
    .action((format: string, opts: {
      graph?: string; output?: string; nodeLimit?: string;
      uri?: string; user?: string; password?: string; graphName?: string;
    }) => {
      const graphPath = opts.graph || "graphify-out/graph.json";
      if (!fs.existsSync(graphPath)) {
        console.error(`Graph file not found: ${graphPath}`);
        process.exit(1);
      }
      const graph = loadGraph(graphPath);
      const communities = communitiesFromGraph(graph);

      // Read community labels if available
      const labelsPath = path.join(path.dirname(graphPath), ".graphify_labels.json");
      let communityLabels: Record<number, string> = {};
      if (fs.existsSync(labelsPath)) {
        try {
          communityLabels = JSON.parse(fs.readFileSync(labelsPath, "utf-8"));
        } catch { /* ignore */ }
      }

      const outDir = path.dirname(graphPath);

      try {
        switch (format) {
          case "html": {
            const outputPath = opts.output || path.join(outDir, "graph.html");
            toHtml(graph, communities, outputPath, {
              communityLabels,
              nodeLimit: opts.nodeLimit ? parseInt(opts.nodeLimit, 10) : undefined,
            });
            console.log(`HTML exported to ${outputPath}`);
            break;
          }
          case "callflow-html": {
            const outputPath = opts.output || path.join(outDir, "callflow.html");
            const result = writeCallflowHtml(undefined, {
              graph: graphPath,
              output: outputPath,
            });
            console.log(`Callflow HTML exported to ${result}`);
            break;
          }
          case "obsidian": {
            const outputPath = opts.output || path.join(outDir, "obsidian");
            const count = toObsidian(graph, communities, outputPath, { communityLabels });
            console.log(`Obsidian vault exported to ${outputPath} (${count} files)`);
            break;
          }
          case "canvas": {
            const outputPath = opts.output || path.join(outDir, "graph.canvas");
            toCanvas(graph, communities, outputPath, { communityLabels });
            console.log(`Canvas exported to ${outputPath}`);
            break;
          }
          case "wiki": {
            const outputPath = opts.output || path.join(outDir, "wiki");
            toWiki(graph, communities, outputPath, communityLabels);
            console.log(`Wiki exported to ${outputPath}`);
            break;
          }
          case "svg": {
            const outputPath = opts.output || path.join(outDir, "graph.svg");
            toSvg(graph, communities, outputPath, { communityLabels });
            console.log(`SVG exported to ${outputPath}`);
            break;
          }
          case "graphml": {
            const outputPath = opts.output || path.join(outDir, "graph.graphml");
            toGraphml(graph, communities, outputPath);
            console.log(`GraphML exported to ${outputPath}`);
            break;
          }
          case "cypher": {
            const outputPath = opts.output || path.join(outDir, "graph.cypher");
            toCypher(graph, outputPath);
            console.log(`Cypher exported to ${outputPath}`);
            break;
          }
          case "neo4j": {
            const uri = opts.uri;
            const user = opts.user;
            const password = opts.password;
            if (!uri || !user || !password) {
              console.error("Neo4j export requires --uri, --user, and --password options");
              process.exit(1);
            }
            pushToNeo4j(graph, uri, user, password, communities);
            break;
          }
          case "falkordb": {
            const uri = opts.uri;
            const password = opts.password;
            if (!uri) {
              console.error("FalkorDB export requires --uri option");
              process.exit(1);
            }
            pushToFalkorDB(graph, uri, opts.user, password, communities, opts.graphName);
            break;
          }
          default:
            console.error(
              `Unknown format: ${format}. Supported: html, callflow-html, obsidian, canvas, wiki, svg, graphml, cypher, neo4j, falkordb`
            );
            process.exit(1);
        }
      } catch (exc: any) {
        console.error(`Export failed: ${exc.message}`);
        process.exit(1);
      }
    });
}
