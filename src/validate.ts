import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Task } from "./types.js";
import { createSnapshot, destroySnapshot, stageDependencies } from "./snapshot.js";
import { applyTestPatch } from "./runner.js";
import { runShell } from "./exec.js";
import { SNAPSHOT_PREFIX, SUCCESS_TIMEOUT_MS } from "./constants.js";

/** Why a probed task was kept or dropped. */
export type ProbeOutcome = "measurable" | "already-passing" | "timed-out" | "error";

/** Called for each task as it is probed, so callers can show progress. */
export type ProbeFn = (task: Task, outcome: ProbeOutcome) => void;

/**
 * Keep only auto-extracted tasks whose target tests actually fail at the start
 * ref. A task whose tests already pass there measures nothing: any agent, doing
 * anything at all — including nothing — scores a pass. Manual tasks are trusted
 * as written and never probed.
 *
 * `timeoutMs` defaults to `SUCCESS_TIMEOUT_MS`; tests override it to keep a
 * timed-out-probe case fast.
 */
export async function keepMeasurableTasks(
  repoDir: string,
  tasks: Task[],
  onProbe?: ProbeFn,
  timeoutMs = SUCCESS_TIMEOUT_MS,
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
        const check = await runShell(task.successCommand, path, timeoutMs);
        if (check.timedOut) {
          // A hung success command exits nonzero when killed, indistinguishable
          // from a genuine failure — but it can't score anything either way.
          onProbe?.(task, "timed-out");
        } else if (check.exitCode !== 0) {
          onProbe?.(task, "measurable");
          kept.push(task);
        } else {
          onProbe?.(task, "already-passing");
        }
      } catch {
        // A candidate optirule can't even snapshot or probe isn't one it can score.
        onProbe?.(task, "error");
      } finally {
        destroySnapshot(path);
      }
    }
  } finally {
    rmSync(session, { recursive: true, force: true });
  }
  return kept;
}
