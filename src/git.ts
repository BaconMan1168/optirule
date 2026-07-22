import { execa } from "execa";

/** A commit whose message matches a fix pattern, with its parent. */
export interface FixCommit {
  sha: string;
  parent: string;
  subject: string;
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execa("git", args, { cwd });
  return stdout.trim();
}

/** Resolve a ref (branch, tag, HEAD, sha) to a full commit sha. */
export function revParse(ref: string, cwd: string): Promise<string> {
  return git(["rev-parse", ref], cwd);
}

/** Files changed in the working tree, from `git diff --name-only`. */
export async function changedFiles(cwd: string): Promise<string[]> {
  const out = await git(["diff", "--name-only"], cwd);
  return out ? out.split("\n") : [];
}

/** Run a git command without trimming, for content that must survive verbatim. */
async function gitRaw(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execa("git", args, { cwd, stripFinalNewline: false });
  return stdout;
}

/** Files changed between two commits, oldest ref first. */
export async function filesChangedBetween(
  from: string,
  to: string,
  cwd: string,
): Promise<string[]> {
  const out = await git(["diff", "--name-only", from, to], cwd);
  return out ? out.split("\n") : [];
}

/** A file's content at `ref`, or undefined when it does not exist there. */
export async function fileAtRef(
  ref: string,
  path: string,
  cwd: string,
): Promise<string | undefined> {
  try {
    return await gitRaw(["show", `${ref}:${path}`], cwd);
  } catch {
    return undefined;
  }
}

const COMMIT_PATTERN = "^feat|^fix|\\bbug\\b|closes #|resolves #";

/**
 * Recent commits, newest first, with their first parent. Merge commits are
 * skipped since their "broken state" is unclear. By default only commits whose
 * subject matches a feat/fix pattern are returned; `relaxed` drops that filter
 * so more candidates surface when strict matches are scarce.
 */
export async function findFixCommits(
  cwd: string,
  limit: number,
  relaxed = false,
): Promise<FixCommit[]> {
  const grep = relaxed ? [] : ["--extended-regexp", `--grep=${COMMIT_PATTERN}`, "-i"];
  const out = await git(
    ["log", `--max-count=${limit * 4}`, "--no-merges", ...grep, "--format=%H%x00%P%x00%s"],
    cwd,
  );
  if (!out) return [];
  const commits: FixCommit[] = [];
  for (const line of out.split("\n")) {
    const [sha, parents, subject] = line.split("\0");
    const parent = parents?.split(" ")[0];
    if (sha && parent && subject) commits.push({ sha, parent, subject });
  }
  return commits;
}
