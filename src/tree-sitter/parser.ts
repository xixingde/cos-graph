import { Parser, Language, Tree } from "web-tree-sitter";

let parserInstance: Parser | null = null;
let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  await initPromise;
}

export async function getParser(): Promise<Parser> {
  await ensureInit();
  if (!parserInstance) {
    parserInstance = new Parser();
  }
  return parserInstance;
}

export async function parseFile(
  language: Language,
  source: string,
): Promise<Tree> {
  const parser = await getParser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error("Parsing failed: parser returned null");
  }
  return tree;
}

export type { Language, Tree };
