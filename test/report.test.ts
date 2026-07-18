import { describe, it, expect } from "vitest";
import { renderReport } from "../src/report.js";
import type { Analysis, VariantSummary, SectionImpact } from "../src/analyze.js";

function summary(variant: string, over: Partial<VariantSummary> = {}): VariantSummary {
  return {
    variant,
    runs: 5,
    passed: 3,
    passRate: 0.6,
    avgDurationMs: 1000,
    avgTokens: 1000,
    avgFilesChanged: 2,
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
    recommendation: [],
    ...over,
  };
}

describe("renderReport", () => {
  it("headlines the token-usage change", () => {
    const html = renderReport(analysis({ tokenDeltaPct: -18 }));
    expect(html).toMatch(/token use/i);
    expect(html).toContain("18%");
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
