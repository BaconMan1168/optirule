import { describe, it, expect } from "vitest";
import { analyze } from "../src/analyze.js";
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
  }));
}

function ablateVariant(id: string, title: string, tokens: number): VariantSpec {
  const section: ParsedSection = { file: "CLAUDE.md", title, tokens, startLine: 0, endLine: 1 };
  return { id, kind: "ablate", section };
}

describe("analyze", () => {
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

  it("omits section impacts without ablation data", () => {
    const a = analyze(runs("current", 1), [], 1);
    expect(a.sectionImpacts).toBeUndefined();
  });

  it("labels a token-saving section as earning its keep", () => {
    // Removing the section makes the agent burn far more tokens: it was helping.
    const results = [
      ...runs("current", 6, { tokens: 1000 }),
      ...runs("ablate-fix", 6, { tokens: 2000 }),
    ];
    const a = analyze(results, [{ title: "Fix", tokens: 300 }], 6, [ablateVariant("ablate-fix", "Fix", 300)]);
    const impact = a.sectionImpacts![0]!;
    expect(impact.tokenImpact).toBe(1000);
    expect(impact.signal).toBe("earns-its-keep");
  });

  it("labels an inert, non-tiny section as no measurable impact", () => {
    const results = [
      ...runs("current", 6, { tokens: 1000 }),
      ...runs("ablate-style", 6, { tokens: 1050 }), // within the ±20% band (200)
    ];
    const a = analyze(results, [{ title: "Style", tokens: 500 }], 6, [
      ablateVariant("ablate-style", "Style", 500),
    ]);
    expect(a.sectionImpacts![0]!.signal).toBe("no-measurable-impact");
  });

  it("labels a token-hungry section as actively hurting", () => {
    const results = [
      ...runs("current", 6, { tokens: 1000 }),
      ...runs("ablate-verbose", 6, { tokens: 600 }), // removing it saved 400 (> band)
    ];
    const a = analyze(results, [{ title: "Verbose", tokens: 500 }], 6, [
      ablateVariant("ablate-verbose", "Verbose", 500),
    ]);
    expect(a.sectionImpacts![0]!.signal).toBe("actively-hurts");
  });

  it("labels a tiny inert section as too small to measure", () => {
    const results = [
      ...runs("current", 6, { tokens: 1000 }),
      ...runs("ablate-tiny", 6, { tokens: 1010 }),
    ];
    const a = analyze(results, [{ title: "Tiny", tokens: 10 }, { title: "Rest", tokens: 990 }], 6, [
      ablateVariant("ablate-tiny", "Tiny", 10),
    ]);
    expect(a.sectionImpacts![0]!.signal).toBe("too-small-to-measure");
  });

  it("flags too-few-runs sections as low confidence", () => {
    const results = [...runs("current", 1, { tokens: 1000 }), ...runs("ablate-x", 1, { tokens: 5000 })];
    const a = analyze(results, [{ title: "X", tokens: 500 }], 1, [ablateVariant("ablate-x", "X", 500)]);
    expect(a.sectionImpacts![0]!.signal).toBe("low-confidence");
  });

  it("cannot classify a section without token data", () => {
    const results = [...runs("current", 6), ...runs("ablate-y", 6)];
    const a = analyze(results, [{ title: "Y", tokens: 500 }], 6, [ablateVariant("ablate-y", "Y", 500)]);
    const impact = a.sectionImpacts![0]!;
    expect(impact.tokenImpact).toBeUndefined();
    expect(impact.signal).toBe("low-confidence");
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
    ]);
    const text = a.recommendation.join(" ");
    expect(text).toMatch(/Keep.*Fix/);
    expect(text).toMatch(/Drop.*Style/);
  });
});
