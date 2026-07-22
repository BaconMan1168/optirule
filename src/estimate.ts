export interface RunPlan {
  taskCount: number;
  variants: number;
  reps: number;
  totalRuns: number;
  /** Tokens the instruction file adds to each `current` run. */
  instructionTokens: number;
  /** Deterministic tokens spent solely on the instruction file across the run. */
  instructionTokenSpend: number;
  /** Read-only scoring calls, one per run when the rubric contains judge rules. */
  judgeCalls: number;
}

/**
 * Compute the shape of a planned run for the confirmation prompt. `variants`
 * is 2 for a default run (baseline + current) and 2 + N under `--ablate`, where
 * every variant except baseline carries roughly the full instruction file.
 */
export function planRun(
  taskCount: number,
  reps: number,
  instructionTokens: number,
  variants = 2,
  hasJudgeRules = false,
): RunPlan {
  return {
    taskCount,
    variants,
    reps,
    totalRuns: taskCount * variants * reps,
    instructionTokens,
    instructionTokenSpend: (variants - 1) * taskCount * reps * instructionTokens,
    judgeCalls: hasJudgeRules ? taskCount * variants * reps : 0,
  };
}

/** Human-readable summary shown before spending money on agent runs. */
export function formatPlan(plan: RunPlan): string {
  const lines = [
    `Planned run: ${plan.taskCount} tasks x ${plan.variants} variants x ${plan.reps} reps = ${plan.totalRuns} agent invocations.`,
    `Each invocation is a full agent run (minutes of wall-clock and real token spend).`,
    `Instruction files add ~${plan.instructionTokens.toLocaleString()} tokens per run (~${plan.instructionTokenSpend.toLocaleString()} tokens total for the files alone).`,
  ];
  if (plan.variants > 2) {
    lines.push(
      `Ablation adds one variant per section, so cost scales with section count — this run is ${plan.variants - 2} sections beyond a default baseline-vs-current run.`,
    );
  }
  if (plan.judgeCalls > 0) {
    lines.push(
      `Rubric judge rules add ${plan.judgeCalls} read-only model call(s), one after each agent run.`,
    );
  }
  return lines.join("\n");
}

const MIN_HEALTHY_TASKS = 8;

export function powerWarning(taskCount: number): string | undefined {
  if (taskCount >= MIN_HEALTHY_TASKS) return undefined;
  return (
    `Only ${taskCount} task(s). The two-task rule that decides whether a section earns its ` +
    "keep needs a wider set to mean anything — add tasks to optirule.yml, or raise " +
    "max_tasks, before trusting any keep/drop verdict."
  );
}
