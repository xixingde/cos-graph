import { Command } from "commander";
import { registerInstallCommand } from "./commands/install.js";
import { registerUninstallCommand } from "./commands/uninstall.js";
import { registerPathCommand } from "./commands/path.js";
import { registerExplainCommand } from "./commands/explain.js";
import { registerDiagnoseCommand } from "./commands/diagnose.js";
import { registerCloneCommand } from "./commands/clone.js";
import { registerExtractCommand } from "./commands/extract.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerClusterOnlyCommand } from "./commands/cluster-only.js";
import { registerLabelCommand } from "./commands/label.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerAffectedCommand } from "./commands/affected.js";
import { registerExportCommand } from "./commands/export.js";
import { registerTreeCommand } from "./commands/tree.js";
import { registerWatchCommand } from "./commands/watch.js";
import { registerHookCommand } from "./commands/hook.js";
import { registerBenchmarkCommand } from "./commands/benchmark.js";
import { registerMergeDriverCommand } from "./commands/merge-driver.js";
import { registerMergeGraphsCommand } from "./commands/merge-graphs.js";
import { registerGlobalCommand } from "./commands/global.js";
import { registerAddCommand } from "./commands/add.js";
import { registerSaveResultCommand } from "./commands/save-result.js";
import { registerCheckUpdateCommand } from "./commands/check-update.js";

export function createProgram(): Command {
  const program = new Command();
  program.name("graphify").version("0.8.41");

  registerInstallCommand(program);
  registerUninstallCommand(program);
  registerPathCommand(program);
  registerExplainCommand(program);
  registerDiagnoseCommand(program);
  registerCloneCommand(program);
  registerExtractCommand(program);
  registerUpdateCommand(program);
  registerClusterOnlyCommand(program);
  registerLabelCommand(program);
  registerQueryCommand(program);
  registerAffectedCommand(program);
  registerExportCommand(program);
  registerTreeCommand(program);
  registerWatchCommand(program);
  registerHookCommand(program);
  registerBenchmarkCommand(program);
  registerMergeDriverCommand(program);
  registerMergeGraphsCommand(program);
  registerGlobalCommand(program);
  registerAddCommand(program);
  registerSaveResultCommand(program);
  registerCheckUpdateCommand(program);

  return program;
}
