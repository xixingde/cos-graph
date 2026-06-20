import type { Command } from "commander";
import { extract, collectFiles } from "../../extract/index.js";
import { cluster, scoreAll } from "../../cluster.js";
import { toJson } from "../../export/index.js";
import { build, buildMerge } from "../../build.js";
import { graphFromJSON } from "../../graph/factory.js";
import { globalAdd } from "../../globalGraph.js";
import * as fs from "fs";
import * as path from "path";

export function registerExtractCommand(program: Command): void {
  program
    .command("extract")
    .description("Extract a knowledge graph from source code")
    .argument("[path]", "directory to extract (default: current directory)", ".")
    .option("--out <dir>", "output directory", "graphify-out")
    .option("--no-cluster", "skip community clustering step")
    .option("--backend <backend>", "LLM backend for semantic extraction", "openai")
    .option("--model <model>", "LLM model for semantic extraction")
    .option("--mode <mode>", "extraction mode", "auto")
    .option("--dedup-llm", "use LLM for fuzzy dedup")
    .option("--google-workspace", "include Google Workspace files")
    .option("--global", "also add to global graph")
    .option("--as <tag>", "repo tag for global add")
    .option("--max-workers <n>", "max parallel workers", "1")
    .option("--token-budget <n>", "token budget for LLM", "8000")
    .option("--max-concurrency <n>", "max concurrent LLM calls", "4")
    .option("--api-timeout <n>", "API timeout in seconds", "120")
    .option("--resolution <n>", "Louvain resolution parameter", "1.0")
    .option("--exclude-hubs", "exclude hub nodes from community detection")
    .option("--exclude <patterns...>", "file patterns to exclude")
    .option("--postgres <conn>", "PostgreSQL connection string for introspection")
    .option("--cargo <dir>", "Cargo project directory for introspection")
    .action((dirPath: string, opts: {
      out?: string; cluster?: boolean; backend?: string; model?: string;
      mode?: string; dedupLlm?: boolean; googleWorkspace?: boolean;
      global?: boolean; as?: string; maxWorkers?: string;
      tokenBudget?: string; maxConcurrency?: string; apiTimeout?: string;
      resolution?: string; excludeHubs?: boolean; exclude?: string[];
      postgres?: string; cargo?: string;
    }) => {
      const targetDir = path.resolve(dirPath || ".");
      const outDir = opts.out || "graphify-out";
      const graphPath = path.join(outDir, "graph.json");

      // Ensure output directory exists
      fs.mkdirSync(outDir, { recursive: true });

      // Step 1: Collect files
      console.log(`[graphify extract] collecting files from ${targetDir}...`);
      const files = collectFiles(targetDir);
      if (files.length === 0) {
        console.error("No extractable files found.");
        process.exit(1);
      }
      console.log(`[graphify extract] found ${files.length} extractable files`);

      // Step 2: AST extraction
      console.log(`[graphify extract] extracting AST from ${files.length} files...`);
      const extractionResult = extract(files);

      // Step 3: Build graph
      console.log(`[graphify extract] building graph...`);
      const existingGraphData = fs.existsSync(graphPath)
        ? JSON.parse(fs.readFileSync(graphPath, "utf-8"))
        : null;

      let graph;
      if (existingGraphData) {
        const merged = buildMerge(
          [extractionResult as unknown as Record<string, unknown>],
          graphPath,
          { root: targetDir },
        );
        // Write merged graph
        const graphData = {
          nodes: Array.from({ length: merged.order }, (_, i) => {
            const nodeId = merged.nodes()[i];
            return { id: nodeId, ...merged.getNodeAttributes(nodeId) };
          }),
          links: [] as Record<string, unknown>[],
          directed: true,
        };
        merged.forEachEdge((_key, attrs, source, target) => {
          graphData.links.push({ source, target, ...attrs });
        });
        fs.writeFileSync(graphPath, JSON.stringify(graphData, null, 2), "utf-8");
        graph = merged;
      } else {
        const built = build([extractionResult as unknown as Record<string, unknown>], {
          root: targetDir,
          directed: true,
        });
        const graphData = {
          nodes: Array.from({ length: built.order }, (_, i) => {
            const nodeId = built.nodes()[i];
            return { id: nodeId, ...built.getNodeAttributes(nodeId) };
          }),
          links: [] as Record<string, unknown>[],
          directed: true,
        };
        built.forEachEdge((_key, attrs, source, target) => {
          graphData.links.push({ source, target, ...attrs });
        });
        fs.writeFileSync(graphPath, JSON.stringify(graphData, null, 2), "utf-8");
        graph = built;
      }

      // Step 4: Cluster (unless --no-cluster)
      if (opts.cluster !== false) {
        console.log(`[graphify extract] clustering communities...`);
        const resolution = parseFloat(opts.resolution || "1.0");
        const communities = cluster(graph, { resolution });
        const cohesion = scoreAll(graph, communities);

        const communityGroups: Record<number, string[]> = {};
        for (const [nodeId, cid] of Object.entries(communities)) {
          if (!communityGroups[cid]) communityGroups[cid] = [];
          communityGroups[cid].push(nodeId);
        }

        // Read/write labels
        const labelsPath = path.join(outDir, ".graphify_labels.json");
        let communityLabels: Record<number, string> = {};
        if (fs.existsSync(labelsPath)) {
          try {
            communityLabels = JSON.parse(fs.readFileSync(labelsPath, "utf-8"));
          } catch { /* ignore */ }
        }

        // Re-write graph with communities
        const reloaded = graphFromJSON(JSON.parse(fs.readFileSync(graphPath, "utf-8")));
        toJson(reloaded, communityGroups, graphPath, {
          force: true,
          communityLabels,
        });

        // Write analysis
        const analysisPath = path.join(outDir, ".graphify_analysis.json");
        fs.writeFileSync(analysisPath, JSON.stringify({ cohesion }, null, 2), "utf-8");

        console.log(
          `Clustered ${graph.order} nodes into ${Object.keys(communityGroups).length} communities`
        );
      }

      // Step 5: Global add if requested
      if (opts.global) {
        const tag = opts.as || path.basename(targetDir);
        try {
          globalAdd(graphPath, tag);
          console.log(`Added to global graph as '${tag}'`);
        } catch (exc: any) {
          console.error(`global add failed: ${exc.message}`);
        }
      }

      console.log(`Extraction complete. Graph written to ${graphPath}`);
    });
}
