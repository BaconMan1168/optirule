import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  modulesDir?: string,
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
  mkdirSync(join(path, ".git", "info"), { recursive: true });
  // Never let a symlinked node_modules show up as an agent edit.
  writeFileSync(join(path, ".git", "info", "exclude"), "node_modules\n");
  await execa("git", ["add", "-A"], { cwd: path });
  await execa("git", [...IDENTITY, "commit", "-q", "-m", "optirule snapshot"], { cwd: path });

  linkDependencies(path, modulesDir);
}

/**
 * Copy the repo's installed dependencies into the session directory, once per
 * run. Snapshots symlink to this copy rather than to `<repoDir>/node_modules`:
 * because `..` resolves physically through a symlink, linking straight at the
 * repo would let an agent reach the parent's full history — and the commit that
 * solves its own task — with a single `ls node_modules/..`. Returns the staged
 * path, or undefined when the repo has no dependencies to stage.
 */
export function stageDependencies(repoDir: string, sessionDir: string): string | undefined {
  const source = join(repoDir, "node_modules");
  if (!existsSync(source)) return undefined;
  const dest = join(sessionDir, "node_modules");
  if (existsSync(dest)) return dest;
  try {
    cpSync(source, dest, { recursive: true });
    return dest;
  } catch {
    // Non-fatal: dependencies are a convenience, not a run requirement.
    return undefined;
  }
}

/**
 * Symlink the snapshot's `node_modules` to the session's staged copy, so
 * tests can run without a per-run install. A fresh snapshot carries no
 * `node_modules` (it is gitignored). No `modulesDir` means no symlink — never
 * fall back to the repo's own `node_modules`, which is exactly the traversal
 * this staging step exists to close.
 */
function linkDependencies(path: string, modulesDir: string | undefined): void {
  if (!modulesDir) return;
  const dest = join(path, "node_modules");
  try {
    symlinkSync(modulesDir, dest, "dir");
  } catch {
    // Non-fatal: the success command may not need dependencies.
  }
}

/** Remove a snapshot directory, ignoring errors so cleanup never masks a failure. */
export function destroySnapshot(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
