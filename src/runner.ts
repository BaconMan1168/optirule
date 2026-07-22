import { readFileSync, writeFileSync, rmSync, mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { OptiruleConfig } from "./config.js";
import type { AgentAdapter } from "./adapters.js";
import type { Task, RunResult, TestFile } from "./types.js";
import type { VariantSpec } from "./variants.js";
import type { Rule } from "./rubric.js";
import type { RunContext } from "./checks.js";
import { removeSection } from "./sections.js";
import { createSnapshot, destroySnapshot, stageDependencies } from "./snapshot.js";
import { changedFiles, unifiedDiff, churnLines } from "./git.js";
import { runSpec, runShell } from "./exec.js";
import { SNAPSHOT_PREFIX, AGENT_TIMEOUT_MS, SUCCESS_TIMEOUT_MS } from "./constants.js";
import { evaluateDeterministic, classifyFailure } from "./evaluate.js";
import { judgeRun } from "./judge.js";

/** Called after each completed run so callers can report live progress. */
export type ProgressFn = (result: RunResult) => void;

/**
 * Put the snapshot into the state a variant requires. `current` writes each
 * instruction file's present-day content (not the version at the task's start
 * ref); `baseline` removes them all; `ablate` writes them but with one section
 * removed from its source file.
 */
function applyVariant(
  snapshot: string,
  instructionFiles: string[],
  contents: Map<string, string>,
  variant: VariantSpec,
): void {
  for (const file of instructionFiles) {
    const dest = `${snapshot}/${file}`;
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

/**
 * Restore the task's test files at their post-fix content. Called only after
 * the agent's diff has been measured, so these files are never counted as the
 * agent's own changes.
 */
export function applyTestPatch(dir: string, testFiles: TestFile[]): void {
  for (const file of testFiles) {
    const dest = join(dir, file.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.content);
  }
}

/** Run every repetition of every variant for one task, sequentially. */
async function runTask(
  repoDir: string,
  sessionDir: string,
  modulesDir: string | undefined,
  adapter: AgentAdapter,
  task: Task,
  contents: Map<string, string>,
  variants: VariantSpec[],
  rules: Rule[],
  reps: number,
  onProgress?: ProgressFn,
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const variant of variants) {
    for (let rep = 0; rep < reps; rep++) {
      const path = join(sessionDir, task.id, variant.id, `rep-${rep}`);
      try {
        await createSnapshot(repoDir, task.startRef, path, modulesDir);
        applyVariant(path, adapter.instructionFiles, contents, variant);
        const agent = await runSpec(adapter.buildCommand(task.prompt), path, AGENT_TIMEOUT_MS);
        // Measure the agent's diff before restoring tests, or the test files
        // we write would be attributed to the agent.
        const changed = (await changedFiles(path)).filter(
          (f) => !adapter.instructionFiles.includes(f),
        );
        const ctx: RunContext = {
          filesChanged: changed,
          diff: await unifiedDiff(path),
          commands: adapter.parseCommands?.(agent.stdout) ?? [],
          timedOut: agent.timedOut,
        };
        const churn = await churnLines(path);
        const deterministic = evaluateDeterministic(rules, ctx);
        const judged = await judgeRun(
          adapter,
          task.prompt,
          rules.filter((rule) => rule.check.kind === "judge"),
          ctx,
        );
        const verdicts = [...deterministic, ...judged];
        applyTestPatch(path, task.testFiles);
        const check = await runShell(task.successCommand, path, SUCCESS_TIMEOUT_MS);
        const passed = check.exitCode === 0;
        const result: RunResult = {
          taskId: task.id,
          variant: variant.id,
          rep,
          passed,
          durationMs: agent.durationMs,
          tokens: adapter.parseTokenUsage(agent.stdout),
          filesChanged: changed,
          filesRead: adapter.parseFilesRead?.(agent.stdout),
          verdicts,
          churn,
          toolCalls: adapter.parseToolCalls?.(agent.stdout),
          failure: classifyFailure(passed, ctx, verdicts),
        };
        results.push(result);
        onProgress?.(result);
      } finally {
        destroySnapshot(path);
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
  rules: Rule[] = [],
  onProgress?: ProgressFn,
): Promise<RunResult[]> {
  const contents = loadInstructionContents(repoDir, adapter.instructionFiles);
  const sessionDir = mkdtempSync(join(tmpdir(), SNAPSHOT_PREFIX));
  const modulesDir = stageDependencies(repoDir, sessionDir);
  const all: RunResult[] = [];
  try {
    for (const task of tasks) {
      all.push(
        ...(await runTask(
          repoDir,
          sessionDir,
          modulesDir,
          adapter,
          task,
          contents,
          variants,
          rules,
          config.reps,
          onProgress,
        )),
      );
    }
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
  return all;
}
