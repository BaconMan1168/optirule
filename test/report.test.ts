import { describe, it, expect } from "vitest";
import { renderReport, renderCompliance, costPerSuccess } from "../src/report.js";
import type { Analysis, VariantSummary, SectionImpact, ComplianceAnalysis } from "../src/analyze.js";

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

  it("renders a section-impact row with token impact and signal", () => {
    const impact: SectionImpact = {
      file: "CLAUDE.md",
      title: "Fixing",
      staticTokens: 300,
      tokenImpact: 1000,
      ablatedRuns: 6,
      tokenShare: 0.3,
      signal: "earns-its-keep",
    };
    const html = renderReport(analysis({ sectionImpacts: [impact] }));
    expect(html).toContain("Fixing");
    expect(html).toContain("300"); // static cost
    expect(html).toMatch(/\+1,000/); // token impact
    expect(html).toContain("Earns its keep");
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
