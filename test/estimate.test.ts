import { describe, it, expect } from "vitest";
import { planRun } from "../src/estimate.js";

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
});
