import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isTestFile, buildTestPatch } from "../src/testfiles.js";

describe("isTestFile", () => {
  it("recognises common test locations and filenames", () => {
    const paths = [
      "test/tasks.test.ts",
      "tests/test_thing.py",
      "__tests__/widget.jsx",
      "spec/models/user_spec.rb",
      "src/foo.test.ts",
      "src/foo.spec.js",
      "pkg/handler_test.go",
    ];
    for (const path of paths) expect(isTestFile(path), path).toBe(true);
  });

  it("does not mistake ordinary source files for tests", () => {
    const paths = [
      "src/latest.ts",
      "src/contestant.ts",
      "src/protest/index.ts",
      "docs/testing.md",
      "src/runner.ts",
    ];
    for (const path of paths) expect(isTestFile(path), path).toBe(false);
  });
});

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
}

describe("buildTestPatch", () => {
  let dir: string;
  let parent: string;
  let head: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "optirule-patch-"));
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@t.co");
    git(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "src.ts"), "old\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "init");
    parent = git(dir, "rev-parse", "HEAD");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("collects post-fix content of test files the commit touched", async () => {
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(join(dir, "src.ts"), "new\n");
    writeFileSync(join(dir, "test/a.test.ts"), "expect(new)\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "fix: it");
    head = git(dir, "rev-parse", "HEAD");

    const patch = await buildTestPatch(parent, head, dir);
    expect(patch).toEqual([{ path: "test/a.test.ts", content: "expect(new)\n" }]);
  });

  it("returns an empty patch when the commit touched no tests", async () => {
    writeFileSync(join(dir, "src.ts"), "new\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "fix: it");
    head = git(dir, "rev-parse", "HEAD");

    expect(await buildTestPatch(parent, head, dir)).toEqual([]);
  });

  it("skips test files the commit deleted", async () => {
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(join(dir, "test/gone.test.ts"), "old\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "add test");
    const withTest = git(dir, "rev-parse", "HEAD");

    rmSync(join(dir, "test/gone.test.ts"));
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "fix: drop it");
    head = git(dir, "rev-parse", "HEAD");

    expect(await buildTestPatch(withTest, head, dir)).toEqual([]);
  });
});
