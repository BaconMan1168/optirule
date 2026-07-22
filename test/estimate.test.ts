import { describe, it, expect } from "vitest";
import { planRun, powerWarning } from "../src/estimate.js";

describe("planRun", () => {
  it("counts tasks across both variants and all reps", () => {
    const plan = planRun(4, 3, 500);
    expect(plan.totalRuns).toBe(24);
    expect(plan.variants).toBe(2);
  });

  it("charges instruction tokens only to current runs", () => {
    const plan = planRun(4, 3, 500);
    expect(plan.instructionTokenSpend).toBe(4 * 3 * 500);
  });

  it("scales invocations and token spend with the variant count under ablation", () => {
    const plan = planRun(2, 3, 500, 5);
    expect(plan.totalRuns).toBe(2 * 5 * 3);
    expect(plan.instructionTokenSpend).toBe((5 - 1) * 2 * 3 * 500);
  });
});

describe("powerWarning", () => {
  it("warns when there are too few tasks for the two-task keep rule", () => {
    expect(powerWarning(3)).toMatch(/two-task/i);
  });
  it("stays quiet with a healthy task count", () => {
    expect(powerWarning(15)).toBeUndefined();
  });
});
