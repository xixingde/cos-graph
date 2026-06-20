/**
 * Tests for Dart extraction — universal/generic syntax.
 */
import { describe, it, expect, test } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { makeId } from "../src/extract/framework.js";

// extractDart not yet migrated to TS
// import { extractDart } from "../src/extract/index.js";

function _write(dir: string, rel: string, body: string): string {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf-8");
  return p;
}

describe.skip("Dart extraction — extractDart not yet migrated", () => {
  it("universal generic syntax extraction", () => {
    // Complex test covering class declarations with generics, inheritance,
    // implements, annotations, extensions, top-level variables, generic method
    // invocations (GetIt, Provider, BlocProvider, InheritedWidget)
  });

  it("extracts file node", () => {});
  it("extracts class and enum nodes", () => {});
  it("extracts inherits and generics edges", () => {});
  it("extracts generic class annotations", () => {});
  it("extracts mixin edges (mixes_in)", () => {});
  it("extracts implements edges", () => {});
  it("extracts extensions", () => {});
  it("extracts top-level variables with generic calls", () => {});
  it("extracts export directives", () => {});
  it("advanced dart features", () => {});
  it("namespace and spaced generics", () => {});
  it("dart and flutter specifics", () => {});
  it("roadmap bug fixes", () => {});
});
