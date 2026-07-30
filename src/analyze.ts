import type { RunResult, Section } from "./types.js";
import type { FailureCategory } from "./types.js";
import type { VariantSpec } from "./variants.js";
import type { Rule } from "./rubric.js";
import { bootstrapCI, mean } from "./stats.js";

export type SectionSignal =
  | "earns-its-keep"
  | "single-task-signal"
  | "redundant"
  | "never-exercised"
  | "harmful";

export interface SectionCompliance {
  file: string;
  title: string;
  mistakesAvoided: number;
  tasksImproved: number;
  applicableRuns: number;
  signal: SectionSignal;
}

export interface ComplianceAnalysis {
  mistakesAvoided: number;
  mistakesAvoidedCI: [number, number];
  sections: SectionCompliance[];
  failures: Record<string, Partial<Record<FailureCategory, number>>>;
}

export interface VariantSummary {
  variant: string;
  runs: number;
  passed: number;
  passRate: number;
  avgDurationMs: number;
  avgTokens?: number;
  avgFilesChanged: number;
  avgChurn: number;
  avgToolCalls?: number;
  /** Average files read, when the adapter reports them; undefined otherwise. */
  avgFilesRead?: number;
}

export type AblationClassification = "helpful" | "harmful" | "neutral" | "inconclusive";
export type AblationConfidence = "sufficient" | "low";

/** Current minus leave-one-section-out for one measured outcome. */
export interface MetricComparison {
  current?: number;
  ablated?: number;
  change?: number;
  confidenceInterval?: [number, number];
}

/** One section's complete leave-one-out comparison against `current`. */
export interface SectionAblation {
  variant: string;
  file: string;
  title: string;
  startLine: number;
  endLine: number;
  passRate: MetricComparison;
  mistakes: MetricComparison;
  compliance: MetricComparison;
  tokens: MetricComparison;
  runtimeMs: MetricComparison;
  churn: MetricComparison;
  toolCalls: MetricComparison;
  filesRead: MetricComparison;
  staticTokensRemoved: number;
  currentRuns: number;
  ablatedRuns: number;
  pairedRuns: number;
  confidence: AblationConfidence;
  classification: AblationClassification;
}

export interface AblationAnalysis {
  valid: boolean;
  planFingerprint: string;
  instructionFileHashes: Record<string, string>;
  sections: SectionAblation[];
}

export interface Analysis {
  /** Version of the machine-readable `.optirule/analysis.json` shape. */
  schemaVersion: 2;
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
  /** Rule-following comparison between baseline and current. */
  compliance: ComplianceAnalysis;
  /** Complete leave-one-section-out results, populated only for `--ablate` runs. */
  ablation?: AblationAnalysis;
  /** Plain-language guidance generated from the deltas. */
  recommendation: string[];
}

/** Minimum runs per variant before a delta is worth trusting over agent noise. */
const CONFIDENT_RUNS = 5;
/** Cost changes within ±20% are treated as practically neutral. */
const COST_BAND_FRACTION = 0.2;
const RATE_BAND = 0.05;
const MISTAKE_BAND = 0.1;

function summarize(variant: string, results: RunResult[]): VariantSummary {
  const runs = results.length;
  const passed = results.filter((r) => r.passed).length;
  const tokenValues = results.map((r) => r.tokens).filter((t): t is number => t !== undefined);
  const filesReadCounts = results
    .filter((r) => r.filesRead !== undefined)
    .map((r) => r.filesRead!.length);
  const toolCallCounts = results
    .map((result) => result.toolCalls)
    .filter((count): count is number => count !== undefined);
  const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
  return {
    variant,
    runs,
    passed,
    passRate: runs ? passed / runs : 0,
    avgDurationMs: avg(results.map((r) => r.durationMs)),
    avgTokens: tokenValues.length ? avg(tokenValues) : undefined,
    avgFilesChanged: avg(results.map((r) => r.filesChanged.length)),
    avgChurn: avg(results.map((result) => result.churn ?? 0)),
    avgToolCalls: toolCallCounts.length ? avg(toolCallCounts) : undefined,
    avgFilesRead: filesReadCounts.length ? avg(filesReadCounts) : undefined,
  };
}

/** Round to one decimal place, dodging float noise like -20.0000004. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type RunMetric = (result: RunResult) => number | undefined;

function violations(result: RunResult): number {
  return result.verdicts.filter((verdict) => verdict.verdict === "violated").length;
}

function complianceRate(result: RunResult): number | undefined {
  const applicable = result.verdicts.filter((verdict) => verdict.verdict !== "not-applicable");
  if (applicable.length === 0) return undefined;
  return applicable.filter((verdict) => verdict.verdict === "followed").length / applicable.length;
}

function compareMetric(
  current: RunResult[],
  ablated: RunResult[],
  metric: RunMetric,
): MetricComparison {
  const without = new Map(ablated.map((result) => [`${result.taskId}:${result.rep}`, result]));
  const pairs = current.flatMap((withSection) => {
    const withoutSection = without.get(`${withSection.taskId}:${withSection.rep}`);
    if (!withoutSection) return [];
    const withValue = metric(withSection);
    const withoutValue = metric(withoutSection);
    return withValue === undefined || withoutValue === undefined
      ? []
      : [{ current: withValue, ablated: withoutValue }];
  });
  if (pairs.length === 0) return {};
  const changes = pairs.map((pair) => pair.current - pair.ablated);
  return {
    current: mean(pairs.map((pair) => pair.current)),
    ablated: mean(pairs.map((pair) => pair.ablated)),
    change: mean(changes),
    confidenceInterval: bootstrapCI(changes),
  };
}

function confidentDirection(
  metric: MetricComparison,
  band: number,
  helpfulWhenPositive: boolean,
): "helpful" | "harmful" | undefined {
  if (metric.change === undefined || !metric.confidenceInterval) return undefined;
  const [low, high] = metric.confidenceInterval;
  if (Math.abs(metric.change) < band || (low <= 0 && high >= 0)) return undefined;
  const positive = metric.change > 0;
  return positive === helpfulWhenPositive ? "helpful" : "harmful";
}

function relativeBand(metric: MetricComparison): number {
  return COST_BAND_FRACTION * Math.max(Math.abs(metric.ablated ?? 0), 1);
}

function classifyAblation(
  confidence: AblationConfidence,
  comparisons: {
    passRate: MetricComparison;
    mistakes: MetricComparison;
    compliance: MetricComparison;
    tokens: MetricComparison;
    runtimeMs: MetricComparison;
    churn: MetricComparison;
    toolCalls: MetricComparison;
    filesRead: MetricComparison;
  },
): AblationClassification {
  if (confidence === "low") return "inconclusive";
  const directions = [
    confidentDirection(comparisons.passRate, RATE_BAND, true),
    confidentDirection(comparisons.mistakes, MISTAKE_BAND, false),
    confidentDirection(comparisons.compliance, RATE_BAND, true),
    confidentDirection(comparisons.tokens, relativeBand(comparisons.tokens), false),
    confidentDirection(comparisons.runtimeMs, relativeBand(comparisons.runtimeMs), false),
    confidentDirection(comparisons.churn, relativeBand(comparisons.churn), false),
    confidentDirection(comparisons.toolCalls, relativeBand(comparisons.toolCalls), false),
    confidentDirection(comparisons.filesRead, relativeBand(comparisons.filesRead), false),
  ].filter((direction): direction is "helpful" | "harmful" => direction !== undefined);
  const helpful = directions.includes("helpful");
  const harmful = directions.includes("harmful");
  if (helpful && harmful) return "inconclusive";
  if (helpful) return "helpful";
  if (harmful) return "harmful";
  return "neutral";
}

function sectionAblations(
  results: RunResult[],
  ablated: VariantSpec[],
): SectionAblation[] {
  const current = results.filter((result) => result.variant === "current");
  const comparisons: SectionAblation[] = [];
  for (const variant of ablated) {
    if (variant.kind !== "ablate") continue;
    const withoutSection = results.filter((result) => result.variant === variant.id);
    const passRate = compareMetric(current, withoutSection, (result) => Number(result.passed));
    const mistakes = compareMetric(current, withoutSection, violations);
    const compliance = compareMetric(current, withoutSection, complianceRate);
    const tokens = compareMetric(current, withoutSection, (result) => result.tokens);
    const runtimeMs = compareMetric(current, withoutSection, (result) => result.durationMs);
    const churn = compareMetric(current, withoutSection, (result) => result.churn);
    const toolCalls = compareMetric(current, withoutSection, (result) => result.toolCalls);
    const filesRead = compareMetric(current, withoutSection, (result) => result.filesRead?.length);
    const pairedRuns = Math.min(current.length, withoutSection.length);
    const confidence =
      Math.min(current.length, withoutSection.length, pairedRuns) >= CONFIDENT_RUNS
        ? "sufficient"
        : "low";
    const metrics = {
      passRate,
      mistakes,
      compliance,
      tokens,
      runtimeMs,
      churn,
      toolCalls,
      filesRead,
    };
    comparisons.push({
      variant: variant.id,
      file: variant.section.file,
      title: variant.section.title,
      startLine: variant.section.startLine,
      endLine: variant.section.endLine,
      ...metrics,
      staticTokensRemoved: variant.section.tokens,
      currentRuns: current.length,
      ablatedRuns: withoutSection.length,
      pairedRuns,
      confidence,
      classification: classifyAblation(confidence, metrics),
    });
  }
  return comparisons;
}

/** Overall token-efficiency threshold for the whole-file verdict, in percent. */
const OVERALL_BAND_PCT = 20;

/** Build the plain-language guidance shown at the top of the report. */
function recommend(
  baseline: VariantSummary,
  current: VariantSummary,
  tokenDeltaPct: number | undefined,
  totalInstructionTokens: number,
  ablations: SectionAblation[] | undefined,
  compliance: ComplianceAnalysis,
): string[] {
  const lines: string[] = [];
  const passNote = `Pass rate ${current.passed}/${current.runs} (current) vs ${baseline.passed}/${baseline.runs} (baseline).`;

  if (compliance.sections.length === 0) {
    lines.push("No rubric — nothing measured about rule-following. Run `optirule lint`.");
  } else if (compliance.mistakesAvoidedCI[0] > 0) {
    lines.push(
      `Your instructions prevented ${compliance.mistakesAvoided} rule violation(s) that the agent made without them ` +
        `(95% CI ${compliance.mistakesAvoidedCI[0].toFixed(1)} to ${compliance.mistakesAvoidedCI[1].toFixed(1)} per task).`,
    );
  } else {
    lines.push(
      `No measurable reduction in rule violations (95% CI ${compliance.mistakesAvoidedCI[0].toFixed(1)} to ` +
        `${compliance.mistakesAvoidedCI[1].toFixed(1)} per task spans zero). Add tasks before trimming anything.`,
    );
  }

  if (tokenDeltaPct === undefined) {
    lines.push(`Token cost unavailable for this agent. ${passNote}`);
  } else if (tokenDeltaPct <= -OVERALL_BAND_PCT) {
    lines.push(
      `Token cost: ${Math.abs(tokenDeltaPct)}% fewer agent tokens vs no instructions. ${passNote}`,
    );
  } else if (tokenDeltaPct >= OVERALL_BAND_PCT) {
    lines.push(
      `Token cost: ${tokenDeltaPct}% more agent tokens plus ~${totalInstructionTokens.toLocaleString()} static tokens/run. ${passNote}`,
    );
  } else {
    lines.push(
      `Token cost: no measurable agent-token change, plus ~${totalInstructionTokens.toLocaleString()} static tokens/run. ${passNote}`,
    );
  }

  if (ablations?.length) {
    const label = (section: SectionAblation) => section.title;
    const keep = ablations.filter((section) => section.classification === "helpful").map(label);
    const drop = ablations
      .filter(
        (section) =>
          section.classification === "neutral" || section.classification === "harmful",
      )
      .map(
        (section) =>
          `${section.title} (${section.classification}, ~${section.staticTokensRemoved.toLocaleString()} static tokens)`,
      );
    const unmeasured = ablations
      .filter((section) => section.classification === "inconclusive")
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
  rules: Rule[] = [],
  ablationMetadata?: { planFingerprint: string; instructionFileHashes: Record<string, string> },
): Analysis {
  const baseline = summarize("baseline", results.filter((r) => r.variant === "baseline"));
  const current = summarize("current", results.filter((r) => r.variant === "current"));
  const totalInstructionTokens = sections.reduce((sum, s) => sum + s.tokens, 0);
  const tokenDeltaPct =
    baseline.avgTokens !== undefined && current.avgTokens !== undefined && baseline.avgTokens > 0
      ? round1(((current.avgTokens - baseline.avgTokens) / baseline.avgTokens) * 100)
      : undefined;
  const ablations = ablated?.length
    ? sectionAblations(results, ablated)
    : undefined;
  const compliance = analyzeCompliance(results, rules);
  return {
    schemaVersion: 2,
    variants: [baseline, current],
    passRateDeltaPct: (current.passRate - baseline.passRate) * 100,
    tokenDeltaPct,
    lowConfidence: Math.min(baseline.runs, current.runs) < CONFIDENT_RUNS,
    sections,
    totalInstructionTokens,
    taskCount,
    compliance,
    ablation:
      ablations && ablationMetadata
        ? {
            valid:
              ablations.length === ablated?.length &&
              ablations.every(
                (section) =>
                  section.currentRuns > 0 && section.ablatedRuns === section.currentRuns,
              ),
            ...ablationMetadata,
            sections: ablations,
          }
        : undefined,
    recommendation: recommend(
      baseline,
      current,
      tokenDeltaPct,
      totalInstructionTokens,
      ablations,
      compliance,
    ),
  };
}

const MIN_TASKS_IMPROVED = 2;

function violationsIn(result: RunResult, ruleIds: Set<string>): number {
  return (result.verdicts ?? []).filter(
    (verdict) => ruleIds.has(verdict.ruleId) && verdict.verdict === "violated",
  ).length;
}

function applicableIn(result: RunResult, ruleIds: Set<string>): boolean {
  return (result.verdicts ?? []).some(
    (verdict) => ruleIds.has(verdict.ruleId) && verdict.verdict !== "not-applicable",
  );
}

function classifySection(
  mistakesAvoided: number,
  tasksImproved: number,
  applicableRuns: number,
): SectionSignal {
  if (applicableRuns === 0) return "never-exercised";
  if (mistakesAvoided < 0) return "harmful";
  if (mistakesAvoided === 0) return "redundant";
  return tasksImproved >= MIN_TASKS_IMPROVED ? "earns-its-keep" : "single-task-signal";
}

export function analyzeCompliance(results: RunResult[], rules: Rule[]): ComplianceAnalysis {
  const allIds = new Set(rules.map((rule) => rule.id));
  const tasks = [...new Set(results.map((result) => result.taskId))];
  const forVariant = (variant: string) => results.filter((result) => result.variant === variant);
  const sectionRules = new Map<string, { file: string; title: string; ids: Set<string> }>();
  for (const rule of rules) {
    const key = `${rule.file}::${rule.section}`;
    if (!sectionRules.has(key)) {
      sectionRules.set(key, { file: rule.file, title: rule.section, ids: new Set() });
    }
    sectionRules.get(key)!.ids.add(rule.id);
  }

  const perTaskDelta = tasks.map((taskId) => {
    const baseline = forVariant("baseline").filter((result) => result.taskId === taskId);
    const current = forVariant("current").filter((result) => result.taskId === taskId);
    return (
      mean(baseline.map((result) => violationsIn(result, allIds))) -
      mean(current.map((result) => violationsIn(result, allIds)))
    );
  });

  const sections: SectionCompliance[] = [];
  for (const { file, title, ids } of sectionRules.values()) {
    let mistakesAvoided = 0;
    let tasksImproved = 0;
    let applicableRuns = 0;
    for (const taskId of tasks) {
      const baseline = forVariant("baseline").filter((result) => result.taskId === taskId);
      const current = forVariant("current").filter((result) => result.taskId === taskId);
      const baselineViolations = baseline.reduce(
        (sum, result) => sum + violationsIn(result, ids),
        0,
      );
      const currentViolations = current.reduce(
        (sum, result) => sum + violationsIn(result, ids),
        0,
      );
      mistakesAvoided += baselineViolations - currentViolations;
      if (baselineViolations > currentViolations) tasksImproved++;
      applicableRuns += [...baseline, ...current].filter((result) =>
        applicableIn(result, ids),
      ).length;
    }
    sections.push({
      file,
      title,
      mistakesAvoided,
      tasksImproved,
      applicableRuns,
      signal: classifySection(mistakesAvoided, tasksImproved, applicableRuns),
    });
  }

  const failures: ComplianceAnalysis["failures"] = {};
  for (const result of results) {
    if (!result.failure) continue;
    failures[result.variant] ??= {};
    failures[result.variant]![result.failure] =
      (failures[result.variant]![result.failure] ?? 0) + 1;
  }

  return {
    mistakesAvoided: sections.reduce((sum, section) => sum + section.mistakesAvoided, 0),
    mistakesAvoidedCI: bootstrapCI(perTaskDelta),
    sections,
    failures,
  };
}
