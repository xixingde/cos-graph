/**
 * Tests for `.astro` extraction (#850).
 *
 * Astro files have a TypeScript frontmatter block (`---...---`) at the top where
 * nearly all imports live, followed by an HTML-with-expressions template and
 * optionally `<script>` blocks. Tree-sitter-javascript fed the whole file produces
 * a top-level ERROR node because the template is not valid JS, so the JS AST pass
 * recovers nothing. The `extractAstro` regex pass salvages imports from the
 * frontmatter and any `<script>` blocks — same strategy as `extractSvelte`.
 */
import { describe, it, expect, test } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { CODE_EXTENSIONS } from "../src/detect.js";
import { makeId } from "../src/extract/framework.js";

// TODO: extractAstro not yet migrated — import when available
// import { extractAstro } from "../src/extract/index.js";

function _write(dir: string, rel: string, body: string): string {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf-8");
  return p;
}

function _importTargets(result: Record<string, unknown>, relation?: string): Set<string> {
  const edges = (result.edges ?? []) as Array<Record<string, unknown>>;
  return new Set(
    edges
      .filter((e) => relation === undefined || e.relation === relation)
      .map((e) => String(e.target ?? "")),
  );
}

test("astro is in code extensions", () => {
  expect(CODE_EXTENSIONS.has(".astro")).toBe(true);
});

test.skip("extract astro picks up frontmatter static imports — extractor not yet migrated", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "astro-"));
  const page = _write(tmp, "src/pages/index.astro", `---
import Layout from '../layouts/Layout.astro';
import Hero from '../components/Hero.astro';
const { title } = Astro.props;
---

<Layout title={title}>
  <Hero />
</Layout>
`);
  const layout = _write(tmp, "src/layouts/Layout.astro", "---\n---\n<slot />\n");
  const hero = _write(tmp, "src/components/Hero.astro", "---\n---\n<h1>hi</h1>\n");

  // const result = extractAstro(page);
  // const targets = _importTargets(result, "imports_from");
  // expect(targets.has(makeId(layout))).toBe(true);
  // expect(targets.has(makeId(hero))).toBe(true);
});

test.skip("extract astro handles dynamic import in frontmatter — extractor not yet migrated", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "astro-"));
  const page = _write(tmp, "src/pages/lazy.astro", `---
const Mod = await import('./Other.astro');
---

<div>{Mod.default}</div>
`);
  const other = _write(tmp, "src/pages/Other.astro", "---\n---\n<p>o</p>\n");

  // const result = extractAstro(page);
  // const targets = _importTargets(result, "dynamic_import");
  // expect(targets.has(makeId(other))).toBe(true);
});

test.skip("extract astro picks up client-side script imports — extractor not yet migrated", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "astro-"));
  const page = _write(tmp, "src/pages/with-script.astro", `---
import Layout from '../layouts/Layout.astro';
---

<Layout>
  <button id="b">click</button>
</Layout>

<script>
  import { hydrate } from '../client/hydrate.ts';
  hydrate(document.getElementById('b'));
</script>
`);
  const layout = _write(tmp, "src/layouts/Layout.astro", "---\n---\n<slot />\n");
  const hydrate = _write(tmp, "src/client/hydrate.ts", "export function hydrate(){}\n");

  // const result = extractAstro(page);
  // const targets = _importTargets(result, "imports_from");
  // expect(targets.has(makeId(layout))).toBe(true);
  // expect(targets.has(makeId(hydrate))).toBe(true);
});

test.skip("extract astro no frontmatter does not crash — extractor not yet migrated", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "astro-"));
  const page = _write(tmp, "src/pages/plain.astro", "<h1>no frontmatter here</h1>\n");

  // const result = extractAstro(page);
  // expect(typeof result).toBe("object");
  // expect(_importTargets(result, "imports_from").size).toBe(0);
});

test.skip("extract astro handles tsconfig path alias — extractor not yet migrated", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "astro-"));
  _write(tmp, "tsconfig.json", `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@components/*": ["src/components/*"] }
  }
}
`);
  const page = _write(tmp, "src/pages/alias.astro", `---
import Hero from '@components/Hero.astro';
---

<Hero />
`);
  const hero = _write(tmp, "src/components/Hero.astro", "---\n---\n<h1>h</h1>\n");

  // const result = extractAstro(page);
  // const targets = _importTargets(result, "imports_from");
  // expect(targets.has(makeId(hero))).toBe(true);
});
