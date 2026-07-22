import { describe, it, expect } from "vitest";
import { mean, bootstrapCI } from "../src/stats.js";

describe("mean", () => {
  it("averages values and handles an empty sample", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBe(0);
  });
});

describe("bootstrapCI", () => {
  it("brackets the sample mean", () => {
    const values = [2, 3, 4, 3, 2, 4, 3, 3];
    const [low, high] = bootstrapCI(values);
    expect(low).toBeLessThanOrEqual(mean(values));
    expect(high).toBeGreaterThanOrEqual(mean(values));
  });
  it("is deterministic", () => {
    expect(bootstrapCI([1, 5, 2, 8, 3])).toEqual(bootstrapCI([1, 5, 2, 8, 3]));
  });
  it("returns a zero-width interval for a constant sample", () => {
    expect(bootstrapCI([4, 4, 4, 4])).toEqual([4, 4]);
  });
  it("spans zero for a sample centered on zero", () => {
    const [low, high] = bootstrapCI([-3, 3, -2, 2, -1, 1, 0, 0]);
    expect(low).toBeLessThan(0);
    expect(high).toBeGreaterThan(0);
  });
  it("returns [0, 0] for an empty sample", () => {
    expect(bootstrapCI([])).toEqual([0, 0]);
  });
});
