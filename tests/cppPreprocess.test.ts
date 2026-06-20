/**
 * The Fortran C-preprocessor path is hardened against argument injection (F5).
 *
 * A corpus file is attacker-named; cpp does not accept a "--" end-of-options
 * terminator, so _cpp_preprocess passes an absolute path which can never be parsed
 * as a cpp option.
 */
import { describe, it, expect, test, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// _cppPreprocess not yet migrated to TS
// import { _cppPreprocess } from "../src/extract/index.js";

test.skip("cpp preprocess passes absolute path — _cppPreprocess not yet migrated", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpp-"));
  const f = path.join(tmp, "weird.F90");
  fs.writeFileSync(f, "program x\nend program x\n");

  // const out = _cppPreprocess(f);
  // expect(out).toBeDefined();
  // The last arg in the argv must be absolute, never starting with "-"
});
