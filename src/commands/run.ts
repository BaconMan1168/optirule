import { readFileSync, existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { resolveAdapter } from "../adapters.js";
import { detectAgent } from "../detect.js";
import { parseSections } from "../sections.js";
import { collectTasks } from "../tasks.js";
import { runAll } from "../runner.js";
import { analyze } from "../analyze.js";
import { writeReport } from "../report.js";
import { planRun, formatPlan } from "../estimate.js";
import { confirm } from "../prompt.js";
import type { Section } from "../types.js";

export interface RunOptions {
  yes?: boolean;
  agent?: string;
}

/** Parse and merge sections across every instruction file being tested. */
function loadSections(repoDir: string, files: string[]): Section[] {
  const sections: Section[] = [];
  for (const file of files) {
    const path = `${repoDir}/${file}`;
    if (existsSync(path)) sections.push(...parseSections(readFileSync(path, "utf8")));
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
  const adapter = resolveAdapter(agentSpec, config.instruction_files);
  const sections = loadSections(repoDir, config.instruction_files);
  const totalTokens = sections.reduce((sum, s) => sum + s.tokens, 0);

  console.log("Collecting tasks...");
  const tasks = await collectTasks(repoDir, config);
  console.log(`Found ${tasks.length} task(s).`);

  const plan = planRun(tasks.length, config.reps, totalTokens);
  console.log(`\n${formatPlan(plan)}\n`);
  if (!options.yes && !(await confirm("Proceed?"))) {
    console.log("Aborted.");
    return;
  }

  const results = await runAll(repoDir, config, adapter, tasks, (r) => {
    const secs = (r.durationMs / 1000).toFixed(0);
    console.log(`  ${r.taskId} · ${r.variant} · rep ${r.rep} → ${r.passed ? "pass" : "fail"} (${secs}s)`);
  });

  const analysis = analyze(results, sections, tasks.length);
  const path = writeReport(repoDir, analysis);
  console.log(`\nReport written to ${path}`);
}
