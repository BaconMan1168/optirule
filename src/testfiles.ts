import type { TestFile } from "./types.js";
import { filesChangedBetween, fileAtRef } from "./git.js";

/** Directory segments that mark a path as test code. */
const TEST_DIR = /(^|\/)(test|tests|__tests__|spec|specs)\//i;
/** Filename shapes that mark a file as test code across common ecosystems. */
const TEST_FILENAME = /(^|\/)(test_[^/]+|[^/]+[._-](test|spec))\.[A-Za-z]+$|_test\.go$/i;

/** Whether a repo-relative path looks like test code rather than production code. */
export function isTestFile(path: string): boolean {
  return TEST_DIR.test(path) || TEST_FILENAME.test(path);
}

/**
 * The test files a commit touched, at their post-fix content. Files the commit
 * deleted are skipped: they cannot be restored, and their absence is not a
 * success criterion.
 */
export async function buildTestPatch(
  parent: string,
  commit: string,
  repoDir: string,
): Promise<TestFile[]> {
  const changed = await filesChangedBetween(parent, commit, repoDir);
  const patch: TestFile[] = [];
  for (const path of changed.filter(isTestFile)) {
    const content = await fileAtRef(commit, path, repoDir);
    if (content !== undefined) patch.push({ path, content });
  }
  return patch;
}
