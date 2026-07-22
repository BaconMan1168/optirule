import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runBenchmark } from "./commands/run.js";
import { runExport } from "./commands/export.js";
import { runLint } from "./commands/lint.js";

const program = new Command();

program
  .name("optirule")
  .description("A/B test your coding-agent instruction files against real tasks from your repo.")
  .version("0.1.0");

program
  .command("init")
  .description("Detect instruction files and scaffold optirule.yml")
  .action(() => {
    runInit(process.cwd());
  });

program
  .command("lint")
  .description("audit instruction files and write an editable rubric before benchmarking")
  .action(async () => {
    try {
      await runLint(process.cwd());
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  });

program
  .command("run")
  .description("Run the benchmark: baseline vs current instructions")
  .option("-y, --yes", "skip the cost confirmation prompt")
  .option("--agent <name>", "override the configured agent")
  .option("--ablate", "also measure each section's impact via leave-one-out ablation")
  .option("--ablate-files", "also measure each whole instruction file's impact")
  .action(async (options) => {
    try {
      await runBenchmark(process.cwd(), options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  });

program
  .command("export")
  .description("Emit a trimmed instruction file from the last compliance run")
  .option("--minimal", "drop sections proven redundant or harmful")
  .option("--out <path>", "output path (single instruction file only)")
  .action((options) => {
    try {
      runExport(process.cwd(), options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  });

program.parseAsync();
