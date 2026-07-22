import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Task } from "./types.js";
import { createSnapshot, destroySnapshot, stageDependencies } from "./snapshot.js";
import { applyTestPatch } from "./runner.js";
import { runShell } from "./exec.js";
import { SNAPSHOT_PREFIX, SUCCESS_TIMEOUT_MS } from "./constants.js";

/** Called for each task as it is probed, so callers can show progress. */
export type ProbeFn = (task: Task, measurable: boolean) => void;

/**
 * Keep only auto-extracted tasks whose target tests actually fail at the start
 * ref. A task whose tests already pass there measures nothing: any agent, doing
 * anything at all — including nothing — scores a pass. Manual tasks are trusted
 * as written and never probed.
 */
export async function keepMeasurableTasks(
  repoDir: string,
  tasks: Task[],
  onProbe?: ProbeFn,
): Promise<Task[]> {
  const session = mkdtempSync(join(tmpdir(), SNAPSHOT_PREFIX));
  const modulesDir = stageDependencies(repoDir, session);
  const kept: Task[] = [];
  try {
    for (const task of tasks) {
      if (task.source === "manual") {
        kept.push(task);
        continue;
      }
      const path = join(session, `probe-${task.id}`);
      try {
        await createSnapshot(repoDir, task.startRef, path, modulesDir);
        applyTestPatch(path, task.testFiles);
        const check = await runShell(task.successCommand, path, SUCCESS_TIMEOUT_MS);
        const measurable = check.exitCode !== 0;
        onProbe?.(task, measurable);
        if (measurable) kept.push(task);
      } finally {
        destroySnapshot(path);
      }
    }
  } finally {
    rmSync(session, { recursive: true, force: true });
  }
  return kept;
}
