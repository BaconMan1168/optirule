import { describe, it, expect } from "vitest";
import { renderReport, renderCompliance, costPerSuccess } from "../src/report.js";
import type { Analysis, VariantSummary, SectionAblation, ComplianceAnalysis } from "../src/analyze.js";

function summary(variant: string, over: Partial<VariantSummary> = {}): VariantSummary {
  return {
    variant,
    runs: 5,
    passed: 3,
    passRate: 0.6,
    avgDurationMs: 1000,
    avgTokens: 1000,
    avgFilesChanged: 2,
    avgChurn: 10,
    ...over,
  };
}

function analysis(over: Partial<Analysis> = {}): Analysis {
  return {
    schemaVersion: 2,
    variants: [summary("baseline"), summary("current")],
    passRateDeltaPct: 0,
    tokenDeltaPct: -18,
    lowConfidence: false,
    sections: [],
    totalInstructionTokens: 0,
    taskCount: 1,
    compliance: { mistakesAvoided: 0, mistakesAvoidedCI: [0, 0], sections: [], failures: {} },
    recommendation: [],
    ...over,
  };
}

describe("renderReport", () => {
  it("headlines mistakes avoided and treats tokens as cost", () => {
    const compliance: ComplianceAnalysis = { mistakesAvoided: 4, mistakesAvoidedCI: [1.2, 3.4], sections: [], failures: {} };
    const html = renderReport(analysis({ compliance }));
    expect(html).toContain("Mistakes avoided");
    expect(html).toContain("Cost and outcome");
  });

  it("renders the recommendation lines", () => {
    const html = renderReport(analysis({ recommendation: ["Keep: Fixing.", "Drop: Style."] }));
    expect(html).toContain("Keep: Fixing.");
    expect(html).toContain("Drop: Style.");
  });

  it("shows an Avg files read column with the value when reported", () => {
    const html = renderReport(analysis({ variants: [summary("current", { avgFilesRead: 3.5 })] }));
    expect(html).toContain("Avg files read");
    expect(html).toContain("3.5");
  });

  it("shows an em dash when files read are unavailable", () => {
    const html = renderReport(analysis({ variants: [summary("baseline", { avgFilesRead: undefined })] }));
    expect(html).toMatch(/<td>—<\/td>/);
  });

  it("renders the complete per-section ablation row", () => {
    const section: SectionAblation = {
      variant: "ablate-fixing",
      file: "CLAUDE.md",
      title: "Fixing",
      startLine: 2,
      endLine: 4,
      passRate: { current: 1, ablated: 0.8, change: 0.2, confidenceInterval: [0.1, 0.3] },
      mistakes: { current: 0, ablated: 1, change: -1, confidenceInterval: [-1, -1] },
      compliance: { current: 1, ablated: 0.5, change: 0.5, confidenceInterval: [0.3, 0.7] },
      tokens: { current: 1000, ablated: 2000, change: -1000, confidenceInterval: [-1200, -800] },
      runtimeMs: { current: 1000, ablated: 1500, change: -500, confidenceInterval: [-700, -300] },
      churn: { current: 10, ablated: 12, change: -2, confidenceInterval: [-3, -1] },
      toolCalls: { current: 4, ablated: 6, change: -2, confidenceInterval: [-3, -1] },
      filesRead: { current: 2, ablated: 3, change: -1, confidenceInterval: [-2, -1] },
      staticTokensRemoved: 300,
      currentRuns: 6,
      ablatedRuns: 6,
      pairedRuns: 6,
      confidence: "sufficient",
      classification: "helpful",
    };
    const html = renderReport(analysis({
      ablation: {
        valid: true,
        planFingerprint: "abc",
        instructionFileHashes: { "CLAUDE.md": "hash" },
        sections: [section],
      },
    }));
    expect(html).toContain("Fixing");
    expect(html).toContain("Helpful");
    expect(html).toContain("6 pairs");
    expect(html).toContain("+20.0pp");
    expect(html).toContain("-1.0");
    expect(html).toContain("300");
    expect(html).toContain("current − ablated");
  });

  it("distinguishes neutral from insufficient evidence", () => {
    const base = {
      variant: "ablate-x",
      file: "CLAUDE.md",
      title: "X",
      startLine: 0,
      endLine: 1,
      passRate: { current: 1, ablated: 1, change: 0, confidenceInterval: [0, 0] },
      mistakes: { current: 0, ablated: 0, change: 0, confidenceInterval: [0, 0] },
      compliance: {},
      tokens: {},
      runtimeMs: { current: 1, ablated: 1, change: 0, confidenceInterval: [0, 0] },
      churn: { current: 0, ablated: 0, change: 0, confidenceInterval: [0, 0] },
      toolCalls: {},
      filesRead: {},
      staticTokensRemoved: 10,
      currentRuns: 5,
      ablatedRuns: 5,
      pairedRuns: 5,
    };
    const html = renderReport(analysis({
      ablation: {
        valid: true,
        planFingerprint: "abc",
        instructionFileHashes: { "CLAUDE.md": "hash" },
        sections: [
          { ...base, confidence: "sufficient", classification: "neutral" },
          { ...base, variant: "ablate-y", title: "Y", confidence: "low", classification: "inconclusive" },
        ],
      },
    }));
    expect(html).toContain("Neutral");
    expect(html).toContain("Inconclusive — insufficient or conflicting evidence");
  });
});

describe("renderCompliance", () => {
  const compliance: ComplianceAnalysis = {
    mistakesAvoided: 4,
    mistakesAvoidedCI: [1.2, 3.4],
    sections: [
      { file: "CLAUDE.md", title: "Layout", mistakesAvoided: 4, tasksImproved: 3, applicableRuns: 12, signal: "earns-its-keep" },
      { file: "CLAUDE.md", title: "Secrets", mistakesAvoided: 0, tasksImproved: 0, applicableRuns: 0, signal: "never-exercised" },
    ],
    failures: { baseline: { "no-op": 2 }, current: { "wrong-code": 1 } },
  };

  it("shows the headline interval, section evidence, and failure categories", () => {
    const html = renderCompliance(compliance);
    expect(html).toContain("4");
    expect(html).toContain("1.2");
    expect(html).toContain("3.4");
    expect(html.toLowerCase()).toContain("never exercised");
    expect(html).toContain("no-op");
    expect(html).toContain("wrong-code");
  });
});

describe("costPerSuccess", () => {
  it("divides total tokens by passes without producing Infinity", () => {
    expect(costPerSuccess(10_000, 4)).toBe(2500);
    expect(costPerSuccess(10_000, 0)).toBeUndefined();
  });
});
