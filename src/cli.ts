import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runBenchmark } from "./commands/run.js";

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
  .command("run")
  .description("Run the benchmark: baseline vs current instructions")
  .option("-y, --yes", "skip the cost confirmation prompt")
  .option("--agent <name>", "override the configured agent")
  .action(async (options) => {
    try {
      await runBenchmark(process.cwd(), options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  });

program.parseAsync();
