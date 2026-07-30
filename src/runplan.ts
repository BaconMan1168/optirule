import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { OptiruleConfig } from "./config.js";
import { RUN_PLAN_PATH } from "./constants.js";
import type { Task } from "./types.js";
import type { VariantSpec } from "./variants.js";

export interface SavedRunPlan {
  schemaVersion: 1;
  fingerprint: string;
  ablation: boolean;
  variantIds: string[];
  taskIds: string[];
  reps: number;
  maxTasks: number;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function instructionFileHashes(
  repoDir: string,
  files: string[],
): Record<string, string> {
  return Object.fromEntries(
    files.map((file) => {
      const path = join(repoDir, file);
      return [file, existsSync(path) ? sha256(readFileSync(path)) : sha256("")];
    }),
  );
}

/** Stable identity for the exact tasks, variants, repetitions, and inputs being approved. */
export function runPlanFingerprint(
  config: OptiruleConfig,
  tasks: Task[],
  variants: VariantSpec[],
  hashes: Record<string, string>,
): string {
  const value = {
    agent: config.agent,
    agentArgs: config.agent_args,
    instructionFiles: config.instruction_files,
    instructionFileHashes: hashes,
    maxTasks: config.max_tasks,
    reps: config.reps,
    tasks: tasks.map((task) => ({
      id: task.id,
      prompt: task.prompt,
      startRef: task.startRef,
      successCommand: task.successCommand,
      testFiles: task.testFiles.map((file) => ({
        path: file.path,
        hash: sha256(file.content),
      })),
    })),
    variants: variants.map((variant) => {
      if (variant.kind === "ablate") {
        return {
          id: variant.id,
          kind: variant.kind,
          file: variant.section.file,
          title: variant.section.title,
          tokens: variant.section.tokens,
          startLine: variant.section.startLine,
          endLine: variant.section.endLine,
        };
      }
      return variant;
    }),
  };
  return sha256(JSON.stringify(value)).slice(0, 16);
}

export function saveRunPlan(
  repoDir: string,
  fingerprint: string,
  config: OptiruleConfig,
  tasks: Task[],
  variants: VariantSpec[],
): string {
  const path = join(repoDir, RUN_PLAN_PATH);
  const plan: SavedRunPlan = {
    schemaVersion: 1,
    fingerprint,
    ablation: variants.some((variant) => variant.kind === "ablate"),
    variantIds: variants.map((variant) => variant.id),
    taskIds: tasks.map((task) => task.id),
    reps: config.reps,
    maxTasks: config.max_tasks,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(plan, null, 2));
  return path;
}

export function requireMatchingRunPlan(repoDir: string, fingerprint: string): SavedRunPlan {
  const path = join(repoDir, RUN_PLAN_PATH);
  if (!existsSync(path)) {
    throw new Error("No approved run plan found. Run the identical command with `--plan` first.");
  }
  const plan = JSON.parse(readFileSync(path, "utf8")) as SavedRunPlan;
  if (plan.schemaVersion !== 1 || plan.fingerprint !== fingerprint) {
    throw new Error(
      `The saved plan (${plan.fingerprint ?? "invalid"}) does not match this run (${fingerprint}). ` +
        "Inputs, tasks, variants, or configuration changed; run `--plan` again before approving.",
    );
  }
  return plan;
}
