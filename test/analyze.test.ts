import { describe, it, expect } from "vitest";
import { analyze } from "../src/analyze.js";
import type { RunResult } from "../src/types.js";
import type { VariantSpec } from "../src/variants.js";
import type { ParsedSection } from "../src/sections.js";

function result(variant: string, passed: boolean, tokens?: number): RunResult {
  return { taskId: "t", variant, rep: 0, passed, durationMs: 1000, tokens, filesChanged: ["a.ts"] };
}

function ablateVariant(id: string, title: string, tokens: number): VariantSpec {
  const section: ParsedSection = { file: "CLAUDE.md", title, tokens, startLine: 0, endLine: 1 };
  return { id, kind: "ablate", section };
}

describe("analyze", () => {
  it("computes pass-rate delta in percentage points", () => {
    const results = [
      result("baseline", false),
      result("baseline", true),
      result("current", true),
      result("current", true),
    ];
    const a = analyze(results, [], 2);
    expect(a.passRateDeltaPct).toBe(50);
  });

  it("flags low confidence when runs per variant are few", () => {
    const a = analyze([result("baseline", true), result("current", true)], [], 1);
    expect(a.lowConfidence).toBe(true);
  });

  it("clears low confidence with enough runs and averages tokens", () => {
    const results: RunResult[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(result("baseline", true, 100));
      results.push(result("current", true, 200));
    }
    const a = analyze(results, [], 5);
    expect(a.lowConfidence).toBe(false);
    expect(a.variants[1]!.avgTokens).toBe(200);
  });

  it("omits section impacts without ablation data", () => {
    const a = analyze([result("current", true)], [], 1);
    expect(a.sectionImpacts).toBeUndefined();
  });

  it("labels a load-bearing section as earning its keep, even when small", () => {
    const results: RunResult[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(result("current", true));
      results.push(result("ablate-fix", false)); // removing it flips the pass rate
    }
    // 5-token section against a 1000-token file (0.5% share) is "small".
    const sections = [{ title: "Fix", tokens: 5 } as { title: string; tokens: number }];
    const a = analyze(results, [...sections, { title: "Rest", tokens: 995 }], 6, [
      ablateVariant("ablate-fix", "Fix", 5),
    ]);
    const impact = a.sectionImpacts![0]!;
    expect(impact.impactPct).toBe(100);
    expect(impact.signal).toBe("earns-its-keep");
  });

  it("labels an inert, non-tiny section as no measurable impact", () => {
    const results: RunResult[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(result("current", true));
      results.push(result("ablate-style", true)); // removing it changes nothing
    }
    const a = analyze(results, [{ title: "Style", tokens: 500 }], 6, [
      ablateVariant("ablate-style", "Style", 500),
    ]);
    expect(a.sectionImpacts![0]!.signal).toBe("no-measurable-impact");
  });

  it("flags too-few-runs sections as low confidence", () => {
    const results = [result("current", true), result("ablate-x", false)];
    const a = analyze(results, [{ title: "X", tokens: 500 }], 1, [
      ablateVariant("ablate-x", "X", 500),
    ]);
    expect(a.sectionImpacts![0]!.signal).toBe("low-confidence");
  });

  it("labels a tiny inert section as too small to measure", () => {
    const results: RunResult[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(result("current", true));
      results.push(result("ablate-tiny", true));
    }
    const a = analyze(results, [{ title: "Tiny", tokens: 5 }, { title: "Rest", tokens: 995 }], 6, [
      ablateVariant("ablate-tiny", "Tiny", 5),
    ]);
    expect(a.sectionImpacts![0]!.signal).toBe("too-small-to-measure");
  });
});
