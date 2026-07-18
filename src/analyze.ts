import type { RunResult, Section, Variant } from "./types.js";

export interface VariantSummary {
  variant: Variant;
  runs: number;
  passed: number;
  passRate: number;
  avgDurationMs: number;
  avgTokens?: number;
  avgFilesChanged: number;
}

export interface Analysis {
  variants: VariantSummary[];
  /** current pass rate minus baseline pass rate, in percentage points. */
  passRateDeltaPct: number;
  /** True when too few runs to trust the delta as signal over noise. */
  lowConfidence: boolean;
  sections: Section[];
  totalInstructionTokens: number;
  taskCount: number;
}

/** Minimum runs per variant before a pass-rate delta is worth trusting. */
const CONFIDENT_RUNS = 5;

function summarize(variant: Variant, results: RunResult[]): VariantSummary {
  const runs = results.length;
  const passed = results.filter((r) => r.passed).length;
  const tokenValues = results.map((r) => r.tokens).filter((t): t is number => t !== undefined);
  const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
  return {
    variant,
    runs,
    passed,
    passRate: runs ? passed / runs : 0,
    avgDurationMs: avg(results.map((r) => r.durationMs)),
    avgTokens: tokenValues.length ? avg(tokenValues) : undefined,
    avgFilesChanged: avg(results.map((r) => r.filesChanged.length)),
  };
}

/** Aggregate raw run results and section costs into report-ready data. */
export function analyze(results: RunResult[], sections: Section[], taskCount: number): Analysis {
  const baseline = summarize("baseline", results.filter((r) => r.variant === "baseline"));
  const current = summarize("current", results.filter((r) => r.variant === "current"));
  return {
    variants: [baseline, current],
    passRateDeltaPct: (current.passRate - baseline.passRate) * 100,
    lowConfidence: Math.min(baseline.runs, current.runs) < CONFIDENT_RUNS,
    sections,
    totalInstructionTokens: sections.reduce((sum, s) => sum + s.tokens, 0),
    taskCount,
  };
}
