import { describe, it, expect } from "vitest";
import { analyze, analyzeCompliance } from "../src/analyze.js";
import type { Rule } from "../src/rubric.js";
import type { RunResult } from "../src/types.js";
import type { VariantSpec } from "../src/variants.js";
import type { ParsedSection } from "../src/sections.js";

function runs(
  variant: string,
  n: number,
  opts: { passed?: boolean; tokens?: number; filesRead?: string[] } = {},
): RunResult[] {
  return Array.from({ length: n }, (_, rep) => ({
    taskId: "t",
    variant,
    rep,
    passed: opts.passed ?? true,
    durationMs: 1000,
    tokens: opts.tokens,
    filesChanged: ["a.ts"],
    filesRead: opts.filesRead,
    verdicts: [],
    churn: 0,
  }));
}

function ablateVariant(id: string, title: string, tokens: number): VariantSpec {
  const section: ParsedSection = { file: "CLAUDE.md", title, tokens, startLine: 0, endLine: 1 };
  return { id, kind: "ablate", section };
}

const ablationMetadata = {
  planFingerprint: "abc123",
  instructionFileHashes: { "CLAUDE.md": "hash" },
};

describe("analyze", () => {
  it("versions the machine-readable analysis shape", () => {
    const a = analyze([...runs("baseline", 1), ...runs("current", 1)], [], 1);
    expect(a.schemaVersion).toBe(2);
  });

  it("computes pass-rate delta in percentage points (kept as a demoted metric)", () => {
    const results = [
      ...runs("baseline", 1, { passed: false }),
      ...runs("baseline", 1, { passed: true }),
      ...runs("current", 2, { passed: true }),
    ];
    const a = analyze(results, [], 2);
    expect(a.passRateDeltaPct).toBe(50);
  });

  it("computes the current-vs-baseline token delta as a percentage", () => {
    const results = [...runs("baseline", 5, { tokens: 1000 }), ...runs("current", 5, { tokens: 800 })];
    const a = analyze(results, [], 1);
    expect(a.tokenDeltaPct).toBe(-20);
  });

  it("leaves the token delta undefined when the adapter reports no tokens", () => {
    const a = analyze([...runs("baseline", 5), ...runs("current", 5)], [], 1);
    expect(a.tokenDeltaPct).toBeUndefined();
  });

  it("averages files read when the adapter reports them", () => {
    const results = [
      ...runs("current", 1, { filesRead: ["a.ts", "b.ts"] }),
      ...runs("current", 1, { filesRead: ["a.ts"] }),
    ];
    const a = analyze(results, [], 1);
    expect(a.variants[1]!.avgFilesRead).toBe(1.5);
  });

  it("omits section ablations without ablation data", () => {
    const a = analyze(runs("current", 1), [], 1);
    expect(a.ablation).toBeUndefined();
  });

  it("classifies a token-saving section as helpful", () => {
    // Removing the section makes the agent burn far more tokens: it was helping.
    const results = [
      ...runs("current", 6, { tokens: 1000 }),
      ...runs("ablate-fix", 6, { tokens: 2000 }),
    ];
    const a = analyze(results, [{ title: "Fix", tokens: 300 }], 6, [ablateVariant("ablate-fix", "Fix", 300)], [], ablationMetadata);
    const section = a.ablation!.sections[0]!;
    expect(section.tokens.change).toBe(-1000);
    expect(section.classification).toBe("helpful");
  });

  it("classifies sufficiently measured practical equivalence as neutral", () => {
    const results = [
      ...runs("current", 6, { tokens: 1000 }),
      ...runs("ablate-style", 6, { tokens: 1050 }), // within the ±20% band (200)
    ];
    const a = analyze(results, [{ title: "Style", tokens: 500 }], 6, [
      ablateVariant("ablate-style", "Style", 500),
    ], [], ablationMetadata);
    expect(a.ablation!.sections[0]).toMatchObject({
      confidence: "sufficient",
      classification: "neutral",
    });
  });

  it("classifies a token-hungry section as harmful", () => {
    const results = [
      ...runs("current", 6, { tokens: 1000 }),
      ...runs("ablate-verbose", 6, { tokens: 600 }), // removing it saved 400 (> band)
    ];
    const a = analyze(results, [{ title: "Verbose", tokens: 500 }], 6, [
      ablateVariant("ablate-verbose", "Verbose", 500),
    ], [], ablationMetadata);
    expect(a.ablation!.sections[0]!.classification).toBe("harmful");
  });

  it("keeps too-few-run sections inconclusive rather than neutral", () => {
    const results = [...runs("current", 1, { tokens: 1000 }), ...runs("ablate-x", 1, { tokens: 5000 })];
    const a = analyze(results, [{ title: "X", tokens: 500 }], 1, [ablateVariant("ablate-x", "X", 500)], [], ablationMetadata);
    expect(a.ablation!.sections[0]).toMatchObject({
      confidence: "low",
      classification: "inconclusive",
    });
  });

  it("can classify a section from required outcome metrics without token data", () => {
    const results = [...runs("current", 6), ...runs("ablate-y", 6)];
    const a = analyze(results, [{ title: "Y", tokens: 500 }], 6, [ablateVariant("ablate-y", "Y", 500)], [], ablationMetadata);
    const section = a.ablation!.sections[0]!;
    expect(section.tokens.change).toBeUndefined();
    expect(section.classification).toBe("neutral");
  });

  it("reports every metric as current minus ablated with confidence and run counts", () => {
    const result = (
      variant: string,
      rep: number,
      values: {
        passed: boolean;
        durationMs: number;
        tokens: number;
        churn: number;
        toolCalls: number;
        filesRead: string[];
        verdict: "followed" | "violated";
      },
    ): RunResult => ({
      taskId: "task",
      variant,
      rep,
      passed: values.passed,
      durationMs: values.durationMs,
      tokens: values.tokens,
      filesChanged: [],
      filesRead: values.filesRead,
      verdicts: [{ ruleId: "rule", verdict: values.verdict }],
      churn: values.churn,
      toolCalls: values.toolCalls,
    });
    const results = Array.from({ length: 5 }, (_, rep) => [
      result("current", rep, {
        passed: true,
        durationMs: 800,
        tokens: 900,
        churn: 8,
        toolCalls: 4,
        filesRead: ["a"],
        verdict: "followed",
      }),
      result("ablate-rules", rep, {
        passed: false,
        durationMs: 1000,
        tokens: 1200,
        churn: 10,
        toolCalls: 6,
        filesRead: ["a", "b"],
        verdict: "violated",
      }),
    ]).flat();
    const a = analyze(
      results,
      [{ title: "Rules", tokens: 40 }],
      1,
      [ablateVariant("ablate-rules", "Rules", 40)],
      [],
      ablationMetadata,
    );
    expect(a.ablation!.valid).toBe(true);
    expect(a.ablation!.sections[0]).toMatchObject({
      currentRuns: 5,
      ablatedRuns: 5,
      pairedRuns: 5,
      confidence: "sufficient",
      classification: "helpful",
      passRate: { current: 1, ablated: 0, change: 1, confidenceInterval: [1, 1] },
      mistakes: { current: 0, ablated: 1, change: -1, confidenceInterval: [-1, -1] },
      compliance: { current: 1, ablated: 0, change: 1, confidenceInterval: [1, 1] },
      tokens: { change: -300 },
      runtimeMs: { change: -200 },
      churn: { change: -2 },
      toolCalls: { change: -2 },
      filesRead: { change: -1 },
      staticTokensRemoved: 40,
    });
  });
});

describe("analyzeCompliance", () => {
  const rules: Rule[] = [
    { id: "no-dist", file: "CLAUDE.md", section: "Layout", text: "never edit dist", check: { kind: "files-touched", forbid: ["dist/**"] } },
    { id: "guardrail", file: "CLAUDE.md", section: "Secrets", text: "never commit secrets", check: { kind: "judge", question: "secrets?" } },
  ];
  const run = (taskId: string, variant: string, ruleId: string, verdict: "followed" | "violated" | "not-applicable"): RunResult => ({
    taskId, variant, rep: 0, passed: true, durationMs: 1, filesChanged: ["a.ts"],
    verdicts: [{ ruleId, verdict }], churn: 1,
  });

  it("counts mistakes avoided and requires improvement on two tasks", () => {
    const results = [
      run("t1", "baseline", "no-dist", "violated"), run("t1", "current", "no-dist", "followed"),
      run("t2", "baseline", "no-dist", "violated"), run("t2", "current", "no-dist", "followed"),
    ];
    const analysis = analyzeCompliance(results, rules);
    expect(analysis.mistakesAvoided).toBe(2);
    expect(analysis.sections.find((section) => section.title === "Layout")).toMatchObject({ tasksImproved: 2, signal: "earns-its-keep" });
  });

  it("distinguishes one-task, redundant, never-exercised, and harmful signals", () => {
    const single = analyzeCompliance([
      run("t1", "baseline", "no-dist", "violated"), run("t1", "current", "no-dist", "followed"),
    ], rules).sections.find((section) => section.title === "Layout")!;
    expect(single.signal).toBe("single-task-signal");
    const redundant = analyzeCompliance([
      run("t1", "baseline", "no-dist", "followed"), run("t1", "current", "no-dist", "followed"),
    ], rules).sections.find((section) => section.title === "Layout")!;
    expect(redundant.signal).toBe("redundant");
    const never = analyzeCompliance([
      run("t1", "baseline", "guardrail", "not-applicable"), run("t1", "current", "guardrail", "not-applicable"),
    ], rules).sections.find((section) => section.title === "Secrets")!;
    expect(never.signal).toBe("never-exercised");
    const harmful = analyzeCompliance([
      run("t1", "baseline", "no-dist", "followed"), run("t1", "current", "no-dist", "violated"),
    ], rules).sections.find((section) => section.title === "Layout")!;
    expect(harmful.signal).toBe("harmful");
  });

  it("summarizes failure categories per condition", () => {
    const results = [
      { ...run("t1", "baseline", "no-dist", "followed"), passed: false, failure: "no-op" as const },
      { ...run("t1", "current", "no-dist", "followed"), passed: false, failure: "wrong-code" as const },
    ];
    const analysis = analyzeCompliance(results, rules);
    expect(analysis.failures.baseline["no-op"]).toBe(1);
    expect(analysis.failures.current["wrong-code"]).toBe(1);
  });
});

describe("recommendation", () => {
  it("says the file pays off when it cuts tokens with no regression", () => {
    const results = [...runs("baseline", 5, { tokens: 1000 }), ...runs("current", 5, { tokens: 700 })];
    const a = analyze(results, [], 1);
    expect(a.recommendation.join(" ")).toMatch(/30% fewer|pays|worth keeping/i);
  });

  it("flags a file that adds tokens without measurable benefit", () => {
    const results = [...runs("baseline", 5, { tokens: 1000 }), ...runs("current", 5, { tokens: 1000 })];
    const a = analyze(results, [{ title: "S", tokens: 500 }], 1);
    expect(a.recommendation.join(" ")).toMatch(/no measurable|consider trimming/i);
  });

  it("lists sections to keep and to drop from ablation", () => {
    const results = [
      ...runs("current", 6, { tokens: 1000 }),
      ...runs("ablate-fix", 6, { tokens: 2000 }), // earns its keep
      ...runs("ablate-style", 6, { tokens: 1000 }), // dead weight
    ];
    const a = analyze(results, [{ title: "Fix", tokens: 300 }, { title: "Style", tokens: 300 }], 6, [
      ablateVariant("ablate-fix", "Fix", 300),
      ablateVariant("ablate-style", "Style", 300),
    ], [], ablationMetadata);
    const text = a.recommendation.join(" ");
    expect(text).toMatch(/Keep.*Fix/);
    expect(text).toMatch(/Drop.*Style/);
  });
});
