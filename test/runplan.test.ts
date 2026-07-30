import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  instructionFileHashes,
  requireMatchingRunPlan,
  runPlanFingerprint,
  saveRunPlan,
} from "../src/runplan.js";
import type { OptiruleConfig } from "../src/config.js";
import type { Task } from "../src/types.js";
import type { VariantSpec } from "../src/variants.js";

const config: OptiruleConfig = {
  agent: "claude",
  agent_args: [],
  instruction_files: ["CLAUDE.md"],
  test_command: "npm test",
  max_tasks: 1,
  reps: 2,
  tasks: [],
};
const tasks: Task[] = [
  {
    id: "fix",
    prompt: "Fix it",
    startRef: "HEAD",
    successCommand: "npm test",
    testFiles: [],
    source: "manual",
  },
];
const variants: VariantSpec[] = [
  { id: "baseline", kind: "baseline" },
  { id: "current", kind: "current" },
  {
    id: "ablate-rules",
    kind: "ablate",
    section: {
      file: "CLAUDE.md",
      title: "Rules",
      tokens: 10,
      startLine: 0,
      endLine: 1,
    },
  },
];

describe("approved run plans", () => {
  it("accepts only the identical planned tasks and variants", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-plan-id-"));
    try {
      writeFileSync(join(dir, "CLAUDE.md"), "## Rules\nTest.");
      const hashes = instructionFileHashes(dir, config.instruction_files);
      const fingerprint = runPlanFingerprint(config, tasks, variants, hashes);
      saveRunPlan(dir, fingerprint, config, tasks, variants);

      expect(requireMatchingRunPlan(dir, fingerprint).variantIds).toEqual([
        "baseline",
        "current",
        "ablate-rules",
      ]);

      const changedVariants = variants.slice(0, 2);
      const changed = runPlanFingerprint(config, tasks, changedVariants, hashes);
      expect(() => requireMatchingRunPlan(dir, changed)).toThrow(/does not match/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("changes when instruction content or configured repetitions change", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-plan-id-"));
    try {
      writeFileSync(join(dir, "CLAUDE.md"), "one");
      const first = runPlanFingerprint(
        config,
        tasks,
        variants,
        instructionFileHashes(dir, config.instruction_files),
      );
      writeFileSync(join(dir, "CLAUDE.md"), "two");
      const contentChanged = runPlanFingerprint(
        config,
        tasks,
        variants,
        instructionFileHashes(dir, config.instruction_files),
      );
      const repsChanged = runPlanFingerprint(
        { ...config, reps: 3 },
        tasks,
        variants,
        instructionFileHashes(dir, config.instruction_files),
      );
      expect(contentChanged).not.toBe(first);
      expect(repsChanged).not.toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
