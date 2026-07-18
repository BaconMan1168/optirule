export interface RunPlan {
  taskCount: number;
  variants: number;
  reps: number;
  totalRuns: number;
  /** Tokens the instruction file adds to each `current` run. */
  instructionTokens: number;
  /** Deterministic tokens spent solely on the instruction file across the run. */
  instructionTokenSpend: number;
}

/** Compute the shape of a planned run for the confirmation prompt. */
export function planRun(taskCount: number, reps: number, instructionTokens: number): RunPlan {
  const variants = 2;
  const currentRuns = taskCount * reps;
  return {
    taskCount,
    variants,
    reps,
    totalRuns: taskCount * variants * reps,
    instructionTokens,
    instructionTokenSpend: currentRuns * instructionTokens,
  };
}

/** Human-readable summary shown before spending money on agent runs. */
export function formatPlan(plan: RunPlan): string {
  return [
    `Planned run: ${plan.taskCount} tasks x ${plan.variants} variants x ${plan.reps} reps = ${plan.totalRuns} agent invocations.`,
    `Each invocation is a full agent run (minutes of wall-clock and real token spend).`,
    `Your instruction file adds ~${plan.instructionTokens.toLocaleString()} tokens per current run (~${plan.instructionTokenSpend.toLocaleString()} tokens total for the file alone).`,
  ].join("\n");
}
