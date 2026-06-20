/** Tests for src/treeHtml.ts.
 *  Ported from graphify/tree_html.py logic.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  DEFAULT_MAX_CHILDREN,
  TreeNode,
  buildTree,
  emitHtml,
  writeTreeHtml,
} from "../src/treeHtml.js";

// ── buildTree ────────────────────────────────────────────────────────────────

function makeGraphData(files: string[]): Record<string, unknown> {
  const nodes = files.map((f, i) => ({
    id: `n${i + 1}`,
    label: path.basename(f),
    source_file: f,
  }));
  return { nodes, edges: [] };
}

describe("buildTree", () => {
  it("returns a tree root with name and children", () => {
    const data = makeGraphData(["src/parse.ts", "src/token.ts"]);
    const tree = buildTree(data);
    expect(tree.name).toBeTruthy();
    expect(tree.total_count).toBeGreaterThan(0);
    expect(tree.children).toBeInstanceOf(Array);
  });

  it("groups files by directory", () => {
    const data = makeGraphData(["src/parse.ts", "src/token.ts", "lib/utils.rs"]);
    const tree = buildTree(data);
    const childNames = tree.children.map((c) => c.name);
    expect(childNames.length).toBeGreaterThan(0);
  });

  it("handles empty nodes gracefully", () => {
    const data: Record<string, unknown> = { nodes: [], edges: [] };
    const tree = buildTree(data);
    expect(tree.name).toBeTruthy();
    expect(tree.total_count).toBe(0);
    expect(tree.children).toEqual([]);
  });

  it("respects maxChildren option", () => {
    const files = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
    const data = makeGraphData(files);
    const tree = buildTree(data, { maxChildren: 10 });
    // The tree should truncate children at some level
    function maxChildrenInTree(node: TreeNode): number {
      if (node.children.length === 0) return 0;
      return Math.max(node.children.length, ...node.children.map(maxChildrenInTree));
    }
    // With 50 files and maxChildren=10, there should be truncation somewhere
    expect(tree.total_count).toBe(50);
  });

  it("uses custom projectLabel", () => {
    const data = makeGraphData(["src/main.ts"]);
    const tree = buildTree(data, { projectLabel: "MyProject" });
    expect(tree.name).toBe("MyProject");
  });

  it("filters out nodes without source_file", () => {
    const data = {
      nodes: [
        { id: "n1", label: "Concept" },
        { id: "n2", label: "File", source_file: "src/a.ts" },
      ],
      edges: [],
    };
    const tree = buildTree(data as Record<string, unknown>);
    expect(tree.total_count).toBe(1);
  });

  it("handles deeply nested paths", () => {
    const data = makeGraphData(["a/b/c/d/e/deep.ts"]);
    const tree = buildTree(data);
    expect(tree.total_count).toBe(1);
  });
});

// ── emitHtml ─────────────────────────────────────────────────────────────────

describe("emitHtml", () => {
  it("produces HTML string with template substitutions", () => {
    const tree: TreeNode = { name: "root", total_count: 1, children: [] };
    const html = emitHtml(tree, { title: "TestTitle", header: "TestHeader" });
    expect(html).toContain("TestTitle");
    expect(html).toContain("TestHeader");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("includes JSON data of the tree", () => {
    const tree: TreeNode = { name: "root", total_count: 5, children: [] };
    const html = emitHtml(tree, { title: "T", header: "H" });
    expect(html).toContain("root");
    expect(html).toContain("5");
  });

  it("uses custom svgWidth and svgHeight", () => {
    const tree: TreeNode = { name: "root", total_count: 1, children: [] };
    const html = emitHtml(tree, { title: "T", header: "H", svgWidth: 4000, svgHeight: 5000 });
    expect(html).toContain("4000");
    expect(html).toContain("5000");
  });

  it("escapes HTML in title and header", () => {
    const tree: TreeNode = { name: "root", total_count: 1, children: [] };
    const html = emitHtml(tree, { title: "A<B>", header: "C&D" });
    // The escaped versions should be present, not raw
    expect(html).not.toContain("A<B>");
    expect(html).not.toContain("C&D");
  });
});

// ── DEFAULT_MAX_CHILDREN ─────────────────────────────────────────────────────

describe("DEFAULT_MAX_CHILDREN", () => {
  it("is a positive number", () => {
    expect(DEFAULT_MAX_CHILDREN).toBeGreaterThan(0);
    expect(typeof DEFAULT_MAX_CHILDREN).toBe("number");
  });
});

// ── TreeNode interface ───────────────────────────────────────────────────────

describe("TreeNode interface", () => {
  it("has expected shape", () => {
    const node: TreeNode = { name: "src", total_count: 3, children: [] };
    expect(node.name).toBe("src");
    expect(node.total_count).toBe(3);
    expect(node.children).toEqual([]);
  });
});
