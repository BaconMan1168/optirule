import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execa } from "execa";
import { join } from "node:path";

/** Identity used for the snapshot's single commit, so no global git config is needed. */
const IDENTITY = ["-c", "user.email=optirule@local", "-c", "user.name=optirule"];

/**
 * Materialise `ref` as a standalone git repository containing exactly one
 * commit. A `git worktree` shares the parent's object database, which lets the
 * agent run `git log --all` and read the very commit that solves its task — the
 * prompt is that commit's subject. Archiving the tree and re-initialising means
 * the future simply does not exist inside the snapshot.
 */
export async function createSnapshot(
  repoDir: string,
  ref: string,
  path: string,
): Promise<void> {
  mkdirSync(path, { recursive: true });
  const tarball = `${path}.tar`;
  await execa("git", ["archive", "--format=tar", `--output=${tarball}`, ref], { cwd: repoDir });
  try {
    await execa("tar", ["-xf", tarball, "-C", path]);
  } finally {
    rmSync(tarball, { force: true });
  }

  await execa("git", ["init", "-q"], { cwd: path });
  // Never let a symlinked node_modules show up as an agent edit.
  writeFileSync(join(path, ".git", "info", "exclude"), "node_modules/\n");
  await execa("git", ["add", "-A"], { cwd: path });
  await execa("git", [...IDENTITY, "commit", "-q", "-m", "optirule snapshot"], { cwd: path });

  linkDependencies(repoDir, path);
}

/**
 * Make the repo's installed dependencies available inside the snapshot. A fresh
 * snapshot carries no `node_modules` (it is gitignored), so tests would fail
 * spuriously; symlinking avoids a per-run install.
 */
function linkDependencies(repoDir: string, path: string): void {
  const source = join(repoDir, "node_modules");
  const dest = join(path, "node_modules");
  if (!existsSync(source) || existsSync(dest)) return;
  try {
    symlinkSync(source, dest, "dir");
  } catch {
    // Non-fatal: the success command may not need dependencies.
  }
}

/** Remove a snapshot directory, ignoring errors so cleanup never masks a failure. */
export function destroySnapshot(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
