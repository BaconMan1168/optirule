import { existsSync, symlinkSync } from "node:fs";
import { addWorktree, removeWorktree } from "./git.js";

/**
 * Create a worktree at `ref` and make the repo's installed dependencies
 * available inside it. A fresh worktree does not carry over `node_modules`
 * (it is gitignored), so tests would fail spuriously; symlinking the repo's
 * existing `node_modules` lets `npm test` run without a per-worktree install.
 */
export async function setupWorktree(repoDir: string, ref: string, path: string): Promise<void> {
  await addWorktree(path, ref, repoDir);
  const repoModules = `${repoDir}/node_modules`;
  const worktreeModules = `${path}/node_modules`;
  if (existsSync(repoModules) && !existsSync(worktreeModules)) {
    try {
      symlinkSync(repoModules, worktreeModules, "dir");
    } catch {
      // Non-fatal: the success command may not need dependencies.
    }
  }
}

/** Remove a worktree, ignoring errors so cleanup never masks a real failure. */
export function teardownWorktree(repoDir: string, path: string): Promise<void> {
  return removeWorktree(path, repoDir).catch(() => {});
}
