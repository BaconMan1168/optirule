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
  /** Average files read, when the adapter reports them; undefined otherwise. */
  avgFilesRead?: number;
}

/** Honest label for a section's measured token impact. */
export type ImpactSignal =
  | "earns-its-keep"
  | "no-measurable-impact"
  | "actively-hurts"
  | "too-small-to-measure"
  | "low-confidence";

/** One ablated section's measured effect on agent token usage versus `current`. */
export interface SectionImpact {
  file: string;
  title: string;
  /** The section's deterministic static token cost (paid on every run). */
  staticTokens: number;
  /** avg tokens(ablated) − avg tokens(current); positive = the section saved tokens. */
  tokenImpact?: number;
  ablatedRuns: number;
  /** Static token cost as a fraction of the whole instruction file(s). */
  tokenShare: number;
  signal: ImpactSignal;
}

export interface Analysis {
  variants: VariantSummary[];
  /** current pass rate minus baseline pass rate, in points (kept as a demoted metric). */
  passRateDeltaPct: number;
  /** current avg tokens vs baseline, as a percentage; undefined without token data. */
  tokenDeltaPct?: number;
  /** True when too few runs to trust the deltas as signal over noise. */
  lowConfidence: boolean;
  sections: Section[];
  totalInstructionTokens: number;
  taskCount: number;
  /** Per-section token impact, populated only for `--ablate` runs. */
  sectionImpacts?: SectionImpact[];
  /** Plain-language guidance generated from the deltas. */
  recommendation: string[];
}

/** Minimum runs per variant before a delta is worth trusting over agent noise. */
const CONFIDENT_RUNS = 5;
/** A token impact within ±(this × current avg tokens) is treated as noise. */
const NEUTRAL_BAND_FRACTION = 0.2;
/** A section below this share of total tokens is too small to attribute effects to. */
const SMALL_SECTION_SHARE = 0.05;

function summarize(variant: string, results: RunResult[]): VariantSummary {
  const runs = results.length;
  const passed = results.filter((r) => r.passed).length;
  const tokenValues = results.map((r) => r.tokens).filter((t): t is number => t !== undefined);
  const filesReadCounts = results
    .filter((r) => r.filesRead !== undefined)
    .map((r) => r.filesRead!.length);
  const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
  return {
    variant,
    runs,
    passed,
    passRate: runs ? passed / runs : 0,
    avgDurationMs: avg(results.map((r) => r.durationMs)),
    avgTokens: tokenValues.length ? avg(tokenValues) : undefined,
    avgFilesChanged: avg(results.map((r) => r.filesChanged.length)),
    avgFilesRead: filesReadCounts.length ? avg(filesReadCounts) : undefined,
  };
}

/** Round to one decimal place, dodging float noise like -20.0000004. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Map a section's measured token impact to an honest label. A confident effect
 * (outside the neutral band) always wins — a load-bearing section reads as
 * "earns its keep" even when small. The size caveat only qualifies a null
 * result, where we can't tell "no effect" apart from "too small to have one".
 */
function classify(
  tokenImpact: number | undefined,
  band: number,
  lowConfidence: boolean,
  tooSmall: boolean,
): ImpactSignal {
  if (lowConfidence || tokenImpact === undefined) return "low-confidence";
  if (tokenImpact >= band) return "earns-its-keep";
  if (tokenImpact <= -band) return "actively-hurts";
  return tooSmall ? "too-small-to-measure" : "no-measurable-impact";
}

function sectionImpacts(
  results: RunResult[],
  current: VariantSummary,
  ablated: VariantSpec[],
  totalTokens: number,
): SectionImpact[] {
  const band = NEUTRAL_BAND_FRACTION * (current.avgTokens ?? 0);
  const impacts: SectionImpact[] = [];
  for (const variant of ablated) {
    if (variant.kind !== "ablate") continue;
    const summary = summarize(variant.id, results.filter((r) => r.variant === variant.id));
    const tokenImpact =
      current.avgTokens !== undefined && summary.avgTokens !== undefined
        ? summary.avgTokens - current.avgTokens
        : undefined;
    const tokenShare = totalTokens ? variant.section.tokens / totalTokens : 0;
    const lowConfidence = Math.min(summary.runs, current.runs) < CONFIDENT_RUNS;
    const tooSmall = tokenShare < SMALL_SECTION_SHARE;
    impacts.push({
      file: variant.section.file,
      title: variant.section.title,
      staticTokens: variant.section.tokens,
      tokenImpact,
      ablatedRuns: summary.runs,
      tokenShare,
      signal: classify(tokenImpact, band, lowConfidence, tooSmall),
    });
  }
  return impacts;
}

/** Overall token-efficiency threshold for the whole-file verdict, in percent. */
const OVERALL_BAND_PCT = 20;

/** Build the plain-language guidance shown at the top of the report. */
function recommend(
  baseline: VariantSummary,
  current: VariantSummary,
  tokenDeltaPct: number | undefined,
  totalInstructionTokens: number,
  impacts: SectionImpact[] | undefined,
): string[] {
  const lines: string[] = [];
  const passNote = `Pass rate ${current.passed}/${current.runs} (current) vs ${baseline.passed}/${baseline.runs} (baseline).`;

  if (tokenDeltaPct === undefined) {
    lines.push(`Token usage unavailable for this agent — judging on pass rate. ${passNote}`);
  } else if (tokenDeltaPct <= -OVERALL_BAND_PCT) {
    lines.push(
      `Your instructions cut agent token use ~${Math.abs(tokenDeltaPct)}% vs no instructions — worth keeping, the file pays for its static cost. ${passNote}`,
    );
  } else if (tokenDeltaPct >= OVERALL_BAND_PCT) {
    lines.push(
      `Your instructions raise agent token use ~${tokenDeltaPct}% and add ~${totalInstructionTokens.toLocaleString()} static tokens/run — consider trimming unless pass rate justifies it. ${passNote}`,
    );
  } else {
    lines.push(
      `Your instructions show no measurable change in agent token use but add ~${totalInstructionTokens.toLocaleString()} static tokens/run — consider trimming. ${passNote}`,
    );
  }

  if (impacts?.length) {
    const label = (i: SectionImpact) => i.title;
    const keep = impacts.filter((i) => i.signal === "earns-its-keep").map(label);
    const drop = impacts
      .filter((i) => i.signal === "no-measurable-impact" || i.signal === "actively-hurts")
      .map((i) => `${i.title} (${i.signal === "actively-hurts" ? "actively hurts" : "dead weight"}, ~${i.staticTokens.toLocaleString()} static tokens)`);
    const unmeasured = impacts
      .filter((i) => i.signal === "too-small-to-measure" || i.signal === "low-confidence")
      .map(label);
    if (keep.length) lines.push(`Keep: ${keep.join(", ")}.`);
    if (drop.length) lines.push(`Drop: ${drop.join(", ")}.`);
    if (unmeasured.length) lines.push(`Unmeasured (raise reps): ${unmeasured.join(", ")}.`);
  }

  return lines;
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
  const tokenDeltaPct =
    baseline.avgTokens !== undefined && current.avgTokens !== undefined && baseline.avgTokens > 0
      ? round1(((current.avgTokens - baseline.avgTokens) / baseline.avgTokens) * 100)
      : undefined;
  const impacts = ablated?.length
    ? sectionImpacts(results, current, ablated, totalInstructionTokens)
    : undefined;
  return {
    variants: [baseline, current],
    passRateDeltaPct: (current.passRate - baseline.passRate) * 100,
    tokenDeltaPct,
    lowConfidence: Math.min(baseline.runs, current.runs) < CONFIDENT_RUNS,
    sections,
    totalInstructionTokens,
    taskCount,
    sectionImpacts: impacts,
    recommendation: recommend(baseline, current, tokenDeltaPct, totalInstructionTokens, impacts),
  };
}
