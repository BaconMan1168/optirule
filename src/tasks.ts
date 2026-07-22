import type { OptiruleConfig } from "./config.js";
import type { Task } from "./types.js";
import { findFixCommits, type FixCommit } from "./git.js";
import { buildTestPatch } from "./testfiles.js";

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
 * Turn candidate commits into tasks, stopping once `needed` are collected and
 * skipping any commit sha already in `seen` (marked whether or not it survives,
 * so a relaxed pass never re-runs `buildTestPatch` on a commit already tried).
 * Commits that touched no tests are dropped: without a test that fails at the
 * parent there is no way to tell whether the agent did the task, and the run
 * would score a no-op agent as a pass.
 */
async function commitsToTasks(
  commits: FixCommit[],
  needed: number,
  config: OptiruleConfig,
  repoDir: string,
  seen: Set<string>,
): Promise<Task[]> {
  const tasks: Task[] = [];
  for (const commit of commits) {
    if (tasks.length >= needed) break;
    if (seen.has(commit.sha)) continue;
    seen.add(commit.sha);
    const testFiles = await buildTestPatch(commit.parent, commit.sha, repoDir);
    if (testFiles.length === 0) continue;
    tasks.push({
      id: `commit-${commit.sha.slice(0, 7)}`,
      prompt: cleanSubject(commit.subject),
      startRef: commit.parent,
      successCommand: config.test_command,
      testFiles,
      source: "git-history",
    });
  }
  return tasks;
}

/**
 * Extract tasks from recent feat/fix commits. Each starts from the commit's
 * parent with the commit subject as its prompt, and carries the commit's test
 * files at their post-fix content. Falls back to a relaxed commit search when
 * the strict search doesn't yield enough *surviving* tasks — candidate count
 * alone is misleading, since candidates with no test changes are dropped.
 */
export async function autoExtractTasks(
  repoDir: string,
  config: OptiruleConfig,
  needed: number,
): Promise<Task[]> {
  if (needed <= 0) return [];
  // Over-fetch: commits without tests are dropped, so candidates exceed slots.
  const strict = await findFixCommits(repoDir, needed * 3);
  const seen = new Set<string>();
  const tasks = await commitsToTasks(strict, needed, config, repoDir, seen);
  if (tasks.length >= needed) return tasks;

  const relaxed = await findFixCommits(repoDir, needed * 3, true);
  const more = await commitsToTasks(relaxed, needed - tasks.length, config, repoDir, seen);
  return [...tasks, ...more];
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
      "No tasks found. Add tasks to optirule.yml, or ensure recent feat/fix commits changed test files — a commit with no test change cannot be scored.",
    );
  }
  return tasks;
}
