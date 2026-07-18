import { describe, it, expect } from "vitest";
import { renderReport } from "../src/report.js";
import type { Analysis, VariantSummary } from "../src/analyze.js";

function summary(variant: string, avgFilesRead?: number): VariantSummary {
  return {
    variant,
    runs: 5,
    passed: 3,
    passRate: 0.6,
    avgDurationMs: 1000,
    avgFilesChanged: 2,
    avgFilesRead,
  };
}

function analysis(variants: VariantSummary[]): Analysis {
  return {
    variants,
    passRateDeltaPct: 20,
    lowConfidence: false,
    sections: [],
    totalInstructionTokens: 0,
    taskCount: 1,
  };
}

describe("renderReport files-read column", () => {
  it("shows an Avg files read column with the value when reported", () => {
    const html = renderReport(analysis([summary("current", 3.5)]));
    expect(html).toContain("Avg files read");
    expect(html).toContain("3.5");
  });

  it("shows an em dash when files read are unavailable", () => {
    const html = renderReport(analysis([summary("baseline", undefined)]));
    expect(html).toContain("Avg files read");
    // The row cell for files read falls back to the same blank used for tokens.
    expect(html).toMatch(/<td>—<\/td>/);
  });
});
