import { describe, it, expect } from "vitest";
import { applyRunOverrides } from "../src/config.js";
import type { OptiruleConfig } from "../src/config.js";

const base: OptiruleConfig = {
  agent: "claude",
  agent_args: [],
  instruction_files: ["CLAUDE.md"],
  test_command: "npm test",
  max_tasks: 15,
  reps: 3,
  tasks: [],
};

describe("applyRunOverrides", () => {
  it("keeps the configured values when no flags are given", () => {
    const config = applyRunOverrides(base, {});
    expect(config.reps).toBe(3);
    expect(config.max_tasks).toBe(15);
  });

  it("shrinks a run to the cheap trial shape", () => {
    const config = applyRunOverrides(base, { reps: "1", maxTasks: "2" });
    expect(config.reps).toBe(1);
    expect(config.max_tasks).toBe(2);
  });

  it("leaves the rest of the config untouched", () => {
    const config = applyRunOverrides(base, { reps: "1" });
    expect(config.instruction_files).toEqual(["CLAUDE.md"]);
    expect(config.max_tasks).toBe(15);
  });

  it("rejects values that would make a run meaningless", () => {
    expect(() => applyRunOverrides(base, { reps: "0" })).toThrow(/--reps/);
    expect(() => applyRunOverrides(base, { maxTasks: "-1" })).toThrow(/--max-tasks/);
    expect(() => applyRunOverrides(base, { reps: "two" })).toThrow(/--reps/);
    expect(() => applyRunOverrides(base, { reps: "1.5" })).toThrow(/--reps/);
  });
});
