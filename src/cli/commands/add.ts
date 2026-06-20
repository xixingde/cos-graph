import type { Command } from "commander";
import { ingest } from "../../ingest.js";

export function registerAddCommand(program: Command): void {
  program
    .command("add")
    .description("Add a URL to the raw directory")
    .argument("<url>", "URL to ingest")
    .option("--author <name>", "author name")
    .option("--contributor <name>", "contributor name")
    .option("--dir <path>", "target directory", "raw")
    .action(async (url: string, opts: { author?: string; contributor?: string; dir?: string }) => {
      try {
        const saved = await ingest(url, opts.dir || "raw", opts.author, opts.contributor);
        console.log(`Saved to ${saved}`);
        console.log("Run /graphify --update in your AI assistant to update the graph.");
      } catch (exc: any) {
        console.error(`error: ${exc.message}`);
        process.exit(1);
      }
    });
}
