import { describe, it, expect } from "vitest";
import { analyze } from "../src/analyze.js";
import type { RunResult, Variant } from "../src/types.js";

function result(variant: Variant, passed: boolean, tokens?: number): RunResult {
  return { taskId: "t", variant, rep: 0, passed, durationMs: 1000, tokens, filesChanged: ["a.ts"] };
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
});
