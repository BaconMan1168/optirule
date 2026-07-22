import type { OptiruleConfig } from "./config.js";
import type { Task } from "./types.js";
import { findFixCommits } from "./git.js";

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
    testFiles: [],
    source: "manual",
  }));
}

/**
 * Extract tasks from recent feat/fix commits: each becomes a task that starts
 * from the commit's parent with the commit subject as its prompt. We no longer
 * gate on "tests fail at the parent" — the run measures efficiency metrics
 * (tokens, time, files) regardless of pass/fail, so any real unit of work is a
 * valid task. Falls back to a relaxed commit search when strict matches are few.
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

  return commits.slice(0, needed).map((commit) => ({
    id: `commit-${commit.sha.slice(0, 7)}`,
    prompt: cleanSubject(commit.subject),
    startRef: commit.parent,
    successCommand: config.test_command,
    testFiles: [],
    source: "git-history",
  }));
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
