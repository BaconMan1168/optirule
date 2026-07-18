import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { OptiruleConfig } from "./config.js";
import type { AgentAdapter } from "./adapters.js";
import type { Task, RunResult } from "./types.js";
import type { VariantSpec } from "./variants.js";
import { removeSection } from "./sections.js";
import { setupWorktree, teardownWorktree } from "./worktree.js";
import { changedFiles } from "./git.js";
import { runSpec, runShell } from "./exec.js";
import { RUNS_DIR, AGENT_TIMEOUT_MS, SUCCESS_TIMEOUT_MS } from "./constants.js";

/** Called after each completed run so callers can report live progress. */
export type ProgressFn = (result: RunResult) => void;

/**
 * Put the worktree into the state a variant requires. `current` writes each
 * instruction file's present-day content (not the version at the task's start
 * ref); `baseline` removes them all; `ablate` writes them but with one section
 * removed from its source file.
 */
function applyVariant(
  worktree: string,
  instructionFiles: string[],
  contents: Map<string, string>,
  variant: VariantSpec,
): void {
  for (const file of instructionFiles) {
    const dest = `${worktree}/${file}`;
    if (variant.kind === "baseline") {
      if (existsSync(dest)) rmSync(dest);
      continue;
    }
    const content = contents.get(file);
    if (content === undefined) continue;
    const toWrite =
      variant.kind === "ablate" && variant.section.file === file
        ? removeSection(content, variant.section)
        : content;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, toWrite);
  }
}

/** Run every repetition of every variant for one task, sequentially. */
async function runTask(
  repoDir: string,
  adapter: AgentAdapter,
  task: Task,
  contents: Map<string, string>,
  variants: VariantSpec[],
  reps: number,
  onProgress?: ProgressFn,
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const variant of variants) {
    for (let rep = 0; rep < reps; rep++) {
      const path = `${repoDir}/${RUNS_DIR}/${task.id}/${variant.id}/rep-${rep}`;
      try {
        await setupWorktree(repoDir, task.startRef, path);
        applyVariant(path, adapter.instructionFiles, contents, variant);
        const agent = await runSpec(adapter.buildCommand(task.prompt), path, AGENT_TIMEOUT_MS);
        const check = await runShell(task.successCommand, path, SUCCESS_TIMEOUT_MS);
        const changed = (await changedFiles(path)).filter(
          (f) => !adapter.instructionFiles.includes(f),
        );
        const result: RunResult = {
          taskId: task.id,
          variant: variant.id,
          rep,
          passed: check.exitCode === 0,
          durationMs: agent.durationMs,
          tokens: adapter.parseTokenUsage(agent.stdout),
          filesChanged: changed,
        };
        results.push(result);
        onProgress?.(result);
      } finally {
        await teardownWorktree(repoDir, path);
      }
    }
  }
  return results;
}

/** Read the present-day content of each instruction file being tested. */
function loadInstructionContents(repoDir: string, files: string[]): Map<string, string> {
  const contents = new Map<string, string>();
  for (const file of files) {
    const path = `${repoDir}/${file}`;
    if (existsSync(path)) contents.set(file, readFileSync(path, "utf8"));
  }
  return contents;
}

/** Run all tasks across every variant and return every collected result. */
export async function runAll(
  repoDir: string,
  config: OptiruleConfig,
  adapter: AgentAdapter,
  tasks: Task[],
  variants: VariantSpec[],
  onProgress?: ProgressFn,
): Promise<RunResult[]> {
  const contents = loadInstructionContents(repoDir, adapter.instructionFiles);
  const all: RunResult[] = [];
  for (const task of tasks) {
    all.push(...(await runTask(repoDir, adapter, task, contents, variants, config.reps, onProgress)));
  }
  return all;
}
