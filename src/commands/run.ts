import { readFileSync, existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { resolveAdapter } from "../adapters.js";
import { detectAgent } from "../detect.js";
import { parseSections } from "../sections.js";
import type { ParsedSection } from "../sections.js";
import { planVariants } from "../variants.js";
import { collectTasks } from "../tasks.js";
import { runAll } from "../runner.js";
import { analyze } from "../analyze.js";
import { writeReport, writeAnalysis } from "../report.js";
import { planRun, formatPlan } from "../estimate.js";
import { confirm } from "../prompt.js";

export interface RunOptions {
  yes?: boolean;
  agent?: string;
  ablate?: boolean;
}

/** Parse and merge sections across every instruction file being tested. */
function loadSections(repoDir: string, files: string[]): ParsedSection[] {
  const sections: ParsedSection[] = [];
  for (const file of files) {
    const path = `${repoDir}/${file}`;
    if (existsSync(path)) sections.push(...parseSections(readFileSync(path, "utf8"), file));
  }
  return sections;
}

/** Full benchmark: collect tasks, confirm cost, run variants, write report. */
export async function runBenchmark(repoDir: string, options: RunOptions): Promise<void> {
  const config = loadConfig(repoDir);
  const agentSpec = options.agent ?? config.agent;
  const detected = detectAgent();
  if (detected && typeof agentSpec === "string" && detected === agentSpec) {
    console.log(`Detected agent runner: ${detected}.`);
  }
  const adapter = resolveAdapter(agentSpec, config.instruction_files, config.agent_args);
  const sections = loadSections(repoDir, config.instruction_files);
  const totalTokens = sections.reduce((sum, s) => sum + s.tokens, 0);
  const ablate = options.ablate ?? false;
  const variants = planVariants(sections, ablate);

  console.log("Collecting tasks...");
  const tasks = await collectTasks(repoDir, config);
  console.log(`Found ${tasks.length} task(s).`);

  const plan = planRun(tasks.length, config.reps, totalTokens, variants.length);
  console.log(`\n${formatPlan(plan)}\n`);
  if (!options.yes && !(await confirm("Proceed?"))) {
    console.log("Aborted.");
    return;
  }

  const results = await runAll(repoDir, config, adapter, tasks, variants, (r) => {
    const secs = (r.durationMs / 1000).toFixed(0);
    console.log(`  ${r.taskId} · ${r.variant} · rep ${r.rep} → ${r.passed ? "pass" : "fail"} (${secs}s)`);
  });

  const analysis = analyze(
    results,
    sections,
    tasks.length,
    ablate ? variants.filter((v) => v.kind === "ablate") : undefined,
  );
  const path = writeReport(repoDir, analysis);
  writeAnalysis(repoDir, analysis);
  console.log(`\nReport written to ${path}`);
}
