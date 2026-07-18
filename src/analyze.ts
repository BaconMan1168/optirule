import type { RunResult, Section } from "./types.js";
import type { VariantSpec } from "./variants.js";

export interface VariantSummary {
  variant: string;
  runs: number;
  passed: number;
  passRate: number;
  avgDurationMs: number;
  avgTokens?: number;
  avgFilesChanged: number;
}

/** Honest label for a section's measured ablation impact. */
export type ImpactSignal =
  | "earns-its-keep"
  | "no-measurable-impact"
  | "actively-hurts"
  | "too-small-to-measure"
  | "low-confidence";

/** One ablated section's measured effect versus the full `current` file. */
export interface SectionImpact {
  file: string;
  title: string;
  tokens: number;
  /** current pass rate minus this section's ablated pass rate, in points. */
  impactPct: number;
  ablatedRuns: number;
  ablatedPassRate: number;
  /** Section tokens as a fraction of the whole instruction file(s). */
  tokenShare: number;
  signal: ImpactSignal;
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
  /** Per-section impact, populated only for `--ablate` runs. */
  sectionImpacts?: SectionImpact[];
}

/** Minimum runs per variant before a pass-rate delta is worth trusting. */
const CONFIDENT_RUNS = 5;
/** Impact within ±this many points is treated as noise (no measurable effect). */
const NEUTRAL_BAND_PCT = 10;
/** A section below this share of total tokens is too small to attribute effects to. */
const SMALL_SECTION_SHARE = 0.05;

function summarize(variant: string, results: RunResult[]): VariantSummary {
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

/**
 * Map a section's measured impact to an honest label. A real, confident effect
 * (outside the neutral band) always wins — a load-bearing section reads as
 * "earns its keep" even when it is small. The size caveat only qualifies a null
 * result, where we can't tell "no effect" apart from "too small to have one".
 */
function classify(impactPct: number, lowConfidence: boolean, tooSmall: boolean): ImpactSignal {
  if (lowConfidence) return "low-confidence";
  if (impactPct >= NEUTRAL_BAND_PCT) return "earns-its-keep";
  if (impactPct <= -NEUTRAL_BAND_PCT) return "actively-hurts";
  return tooSmall ? "too-small-to-measure" : "no-measurable-impact";
}

function sectionImpacts(
  results: RunResult[],
  current: VariantSummary,
  ablated: VariantSpec[],
  totalTokens: number,
): SectionImpact[] {
  const impacts: SectionImpact[] = [];
  for (const variant of ablated) {
    if (variant.kind !== "ablate") continue;
    const summary = summarize(variant.id, results.filter((r) => r.variant === variant.id));
    const impactPct = (current.passRate - summary.passRate) * 100;
    const tokenShare = totalTokens ? variant.section.tokens / totalTokens : 0;
    const lowConfidence = Math.min(summary.runs, current.runs) < CONFIDENT_RUNS;
    const tooSmall = tokenShare < SMALL_SECTION_SHARE;
    impacts.push({
      file: variant.section.file,
      title: variant.section.title,
      tokens: variant.section.tokens,
      impactPct,
      ablatedRuns: summary.runs,
      ablatedPassRate: summary.passRate,
      tokenShare,
      signal: classify(impactPct, lowConfidence, tooSmall),
    });
  }
  return impacts;
}

/** Aggregate raw run results and section costs into report-ready data. */
export function analyze(
  results: RunResult[],
  sections: Section[],
  taskCount: number,
  ablated?: VariantSpec[],
): Analysis {
  const baseline = summarize("baseline", results.filter((r) => r.variant === "baseline"));
  const current = summarize("current", results.filter((r) => r.variant === "current"));
  const totalInstructionTokens = sections.reduce((sum, s) => sum + s.tokens, 0);
  return {
    variants: [baseline, current],
    passRateDeltaPct: (current.passRate - baseline.passRate) * 100,
    lowConfidence: Math.min(baseline.runs, current.runs) < CONFIDENT_RUNS,
    sections,
    totalInstructionTokens,
    taskCount,
    sectionImpacts: ablated?.length
      ? sectionImpacts(results, current, ablated, totalInstructionTokens)
      : undefined,
  };
}
