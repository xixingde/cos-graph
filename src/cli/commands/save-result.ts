import type { Command } from "commander";
import { saveQueryResult } from "../../ingest.js";

export function registerSaveResultCommand(program: Command): void {
  program
    .command("save-result")
    .description("Save a query result to memory")
    .requiredOption("--question <q>", "the question that was asked")
    .requiredOption("--answer <a>", "the answer to save")
    .option("--type <type>", "query type (default: query)", "query")
    .option("--nodes <nodes...>", "source node IDs")
    .option("--memory-dir <path>", "memory directory", "graphify-out/memory")
    .action((opts: { question: string; answer: string; type: string; nodes?: string[]; memoryDir: string }) => {
      const out = saveQueryResult(
        opts.question,
        opts.answer,
        opts.memoryDir,
        opts.type,
        opts.nodes?.length ? opts.nodes : undefined,
      );
      console.log(`Saved to ${out}`);
    });
}
