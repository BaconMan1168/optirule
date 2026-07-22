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

/** Run git untrimmed, for NUL-delimited output whose exact bytes (incl. trailing separators) matter. */
async function gitRawText(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execa("git", args, { cwd, stripFinalNewline: false });
  return stdout;
}

/** Run git returning raw bytes, so file content that isn't valid UTF-8 survives untouched. */
async function gitRaw(args: string[], cwd: string): Promise<Buffer> {
  const { stdout } = await execa("git", args, {
    cwd,
    stripFinalNewline: false,
    encoding: "buffer",
    // Pinned so isMissingPathError's English substring match works regardless
    // of the caller's LANG/LC_ALL — do not remove this to "respect the user's
    // locale", it would make error classification silently stop working.
    env: { LC_ALL: "C" },
  });
  return Buffer.from(stdout);
}

/**
 * Files changed between two commits, oldest ref first. Uses `-z` (NUL-terminated,
 * unquoted paths) instead of newline splitting: git's default `core.quotePath`
 * mangles non-ASCII paths into escaped octal strings otherwise.
 */
export async function filesChangedBetween(
  from: string,
  to: string,
  cwd: string,
): Promise<string[]> {
  const out = await gitRawText(["diff", "--name-only", "-z", from, to], cwd);
  return out.split("\0").filter((path) => path !== "");
}

/** True when git's stderr says the path is absent at this ref, not that the ref itself is bad. */
function isMissingPathError(error: unknown): boolean {
  const stderr = (error as { stderr?: Uint8Array }).stderr;
  if (!stderr) return false;
  const text = Buffer.from(stderr).toString();
  return /does not exist in |exists on disk, but not in /.test(text);
}

/** A file's content at `ref`, or undefined when it does not exist there. */
export async function fileAtRef(
  ref: string,
  path: string,
  cwd: string,
): Promise<Buffer | undefined> {
  try {
    return await gitRaw(["show", `${ref}:${path}`], cwd);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
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
