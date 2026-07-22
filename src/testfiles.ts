/** Directory segments that mark a path as test code. */
const TEST_DIR = /(^|\/)(test|tests|__tests__|spec|specs)\//i;
/** Filename shapes that mark a file as test code across common ecosystems. */
const TEST_FILENAME = /(^|\/)(test_[^/]+|[^/]+[._-](test|spec))\.[A-Za-z]+$|_test\.go$/i;

/** Whether a repo-relative path looks like test code rather than production code. */
export function isTestFile(path: string): boolean {
  return TEST_DIR.test(path) || TEST_FILENAME.test(path);
}
