import { describe, it, expect } from "vitest";
import { evaluateDeterministic, classifyFailure } from "../src/evaluate.js";
import type { Rule } from "../src/rubric.js";
import type { RunContext } from "../src/checks.js";

function ctx(overrides: Partial<RunContext> = {}): RunContext {
  return { filesChanged: [], diff: "", commands: [], timedOut: false, ...overrides };
}

const rules: Rule[] = [
  { id: "no-dist", file: "f", section: "Layout", text: "never edit dist", check: { kind: "files-touched", forbid: ["dist/**"] } },
  { id: "npm-test", file: "f", section: "Testing", text: "use npm test", check: { kind: "command-used", require: "npm test" } },
  { id: "thinky", file: "f", section: "Style", text: "be idiomatic", check: { kind: "judge", question: "idiomatic?" } },
];

describe("evaluateDeterministic", () => {
  it("scores non-judge rules only", () => {
    expect(evaluateDeterministic(rules, ctx({ filesChanged: ["dist/x.js"], commands: ["npm test"] }))).toEqual([
      { ruleId: "no-dist", verdict: "violated" },
      { ruleId: "npm-test", verdict: "followed" },
    ]);
  });
  it("returns nothing for an empty rubric", () => {
    expect(evaluateDeterministic([], ctx())).toEqual([]);
  });
});

describe("classifyFailure", () => {
  it("returns undefined for a pass", () => {
    expect(classifyFailure(true, ctx({ filesChanged: ["a.ts"] }), [])).toBeUndefined();
  });
  it("prioritizes timeouts then no-ops", () => {
    expect(classifyFailure(false, ctx({ timedOut: true }), [{ ruleId: "x", verdict: "violated" }])).toBe("timed-out");
    expect(classifyFailure(false, ctx(), [])).toBe("no-op");
  });
  it("distinguishes ignored instructions from wrong code", () => {
    const changed = ctx({ filesChanged: ["a.ts"] });
    expect(classifyFailure(false, changed, [{ ruleId: "x", verdict: "violated" }])).toBe("ignored-instructions");
    expect(classifyFailure(false, changed, [{ ruleId: "x", verdict: "followed" }])).toBe("wrong-code");
  });
});
