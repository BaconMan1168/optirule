import type { OptiruleConfig } from "./config.js";
import type { Task } from "./types.js";
import { findFixCommits } from "./git.js";
import { setupWorktree, teardownWorktree } from "./worktree.js";
import { runShell } from "./exec.js";
import { PROBE_DIR, PROBE_TIMEOUT_MS } from "./constants.js";

/** Strip a conventional-commit prefix so the subject reads as a task prompt. */
function cleanSubject(subject: string): string {
  return subject.replace(/^\w+(\([^)]*\))?!?:\s*/, "").trim();
}

/** Tasks explicitly listed in optirule.yml. These always take priority. */
export function manualTasks(config: OptiruleConfig): Task[] {
  return config.tasks.map((t) => ({
    id: t.id,
    prompt: t.prompt,
    startRef: t.start_ref ?? "HEAD",
    successCommand: t.success ?? config.test_command,
    source: "manual",
  }));
}

/**
 * Extract tasks from fix commits. For each candidate the parent commit is
 * checked out and the test command run; only commits whose tests fail at the
 * parent become tasks, since a commit that fixed nothing measurable is noise.
 * Falls back to a relaxed commit search when strict matches are too few.
 */
export async function autoExtractTasks(
  repoDir: string,
  config: OptiruleConfig,
  needed: number,
): Promise<Task[]> {
  if (needed <= 0) return [];
  const strict = await findFixCommits(repoDir, needed);
  const commits =
    strict.length >= needed ? strict : await findFixCommits(repoDir, needed, true);

  const tasks: Task[] = [];
  for (const commit of commits) {
    if (tasks.length >= needed) break;
    const path = `${repoDir}/${PROBE_DIR}/${commit.sha.slice(0, 10)}`;
    try {
      await setupWorktree(repoDir, commit.parent, path);
      const result = await runShell(config.test_command, path, PROBE_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        tasks.push({
          id: `fix-${commit.sha.slice(0, 7)}`,
          prompt: cleanSubject(commit.subject),
          startRef: commit.parent,
          successCommand: config.test_command,
          source: "git-history",
        });
      }
    } finally {
      await teardownWorktree(repoDir, path);
    }
  }
  return tasks;
}

/**
 * Merge task sources: manual entries first, then auto-extracted tasks up to
 * `max_tasks`. Throws with guidance when nothing usable is found.
 */
export async function collectTasks(repoDir: string, config: OptiruleConfig): Promise<Task[]> {
  const manual = manualTasks(config);
  const remaining = config.max_tasks - manual.length;
  const auto = await autoExtractTasks(repoDir, config, remaining);
  const tasks = [...manual, ...auto];
  if (tasks.length === 0) {
    throw new Error(
      "No tasks found. Add tasks to optirule.yml, or ensure recent fix commits have failing tests at their parent commit.",
    );
  }
  return tasks;
}
