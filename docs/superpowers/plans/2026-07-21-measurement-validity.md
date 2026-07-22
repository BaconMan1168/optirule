# Measurement Validity (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make optirule's pass/fail signal actually measure whether the agent did the task, and make it impossible for the agent to read the future commit that solves it.

**Architecture:** Two independent defects are fixed. (1) Auto-extracted tasks currently run the *whole* test suite at the fix commit's parent, where the fix's test does not exist yet — so a no-op agent passes. We adopt the SWE-bench FAIL_TO_PASS construction: extract the test files the fix commit touched, restore their post-fix content after the agent finishes, and use that as the success check. Tasks whose target tests already pass at the parent are dropped. (2) `git worktree add` shares the object database with the parent repo, so an agent can `git log --all` / `git show <sha>` and read the exact commit whose subject is its prompt. We replace worktrees with `git archive` snapshots in a temp directory that contain exactly one commit and no future history.

**Non-goal:** This plan does not touch metrics, the report, or `export --minimal`. Those depend on seeing what pass/fail looks like once it is real, and get their own plan (P1).

**Tech Stack:** TypeScript (ESM, `type: module`), execa for subprocesses, vitest for tests, tsup for bundling.

---

## File Structure

**New files:**
- `src/testfiles.ts` — recognises test paths and builds a commit's test patch. One responsibility: "which files are tests, and what did they look like after the fix."
- `src/snapshot.ts` — creates and destroys history-free working copies. Replaces `src/worktree.ts` entirely.
- `src/validate.ts` — drops auto-extracted tasks whose target tests already pass at the start ref.
- `test/testfiles.test.ts`, `test/snapshot.test.ts`, `test/validate.test.ts`

**Modified:**
- `src/types.ts` — `Task` gains `testFiles`; new `TestFile` interface.
- `src/git.ts` — add `filesChangedBetween` and `fileAtRef`.
- `src/tasks.ts` — auto-extraction builds test patches and skips commits without them.
- `src/runner.ts` — snapshots instead of worktrees; applies the test patch after measuring the diff.
- `src/commands/run.ts` — calls the validity gate and reports dropped tasks.
- `src/constants.ts` — drop `RUNS_DIR`, add `SNAPSHOT_PREFIX`.
- `README.md` — describe the real success construction.

**Deleted:**
- `src/worktree.ts` — superseded by `src/snapshot.ts`.

**A note on a deliberate omission:** an earlier sketch of this work included transcript scanning to detect an agent peeking at future commits. Once snapshots land there is no future history in the object database to peek at, so there would be nothing to detect. It is not in this plan.

---

### Task 1: Recognise test files

**Files:**
- Create: `src/testfiles.ts`
- Test: `test/testfiles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/testfiles.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isTestFile } from "../src/testfiles.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/testfiles.test.ts`
Expected: FAIL — `Failed to resolve import "../src/testfiles.js"`

- [ ] **Step 3: Write minimal implementation**

Create `src/testfiles.ts`:

```typescript
/** Directory segments that mark a path as test code. */
const TEST_DIR = /(^|\/)(test|tests|__tests__|spec|specs)\//i;
/** Filename shapes that mark a file as test code across common ecosystems. */
const TEST_FILENAME = /(^|\/)(test_[^/]+|[^/]+[._-](test|spec))\.[A-Za-z]+$|_test\.go$/i;

/** Whether a repo-relative path looks like test code rather than production code. */
export function isTestFile(path: string): boolean {
  return TEST_DIR.test(path) || TEST_FILENAME.test(path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/testfiles.test.ts`
Expected: PASS, 2 tests

Note `docs/testing.md` passes only because `TEST_DIR` requires a trailing slash and `testing.md` has no `[._-]test.` separator — if it fails, the regex was mistyped.

- [ ] **Step 5: Commit**

```bash
git add src/testfiles.ts test/testfiles.test.ts
git commit -m "feat: recognise test files by path and filename shape"
```

---

### Task 2: Read files and diffs at arbitrary refs

**Files:**
- Modify: `src/git.ts` (append after `changedFiles`, around line 34)
- Test: `test/git.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/git.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filesChangedBetween, fileAtRef } from "../src/git.js";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
}

describe("git ref helpers", () => {
  let dir: string;
  let parent: string;
  let head: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "optirule-git-"));
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@t.co");
    git(dir, "config", "user.name", "t");
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(join(dir, "src.ts"), "export const x = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "init");
    parent = git(dir, "rev-parse", "HEAD");

    writeFileSync(join(dir, "src.ts"), "export const x = 2;\n");
    writeFileSync(join(dir, "test/x.test.ts"), "assert(x === 2);\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "fix: correct x");
    head = git(dir, "rev-parse", "HEAD");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lists files changed between two commits", async () => {
    const changed = await filesChangedBetween(parent, head, dir);
    expect(changed.sort()).toEqual(["src.ts", "test/x.test.ts"]);
  });

  it("reads a file's content at a ref", async () => {
    expect(await fileAtRef(head, "src.ts", dir)).toBe("export const x = 2;\n");
    expect(await fileAtRef(parent, "src.ts", dir)).toBe("export const x = 1;\n");
  });

  it("returns undefined for a file absent at that ref", async () => {
    expect(await fileAtRef(parent, "test/x.test.ts", dir)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git.test.ts`
Expected: FAIL — `filesChangedBetween is not a function`

- [ ] **Step 3: Write minimal implementation**

The existing private `git()` helper in `src/git.ts` trims its output, which would corrupt file content. Add a second raw helper and both functions. Append to `src/git.ts`:

```typescript
/** Run a git command without trimming, for content that must survive verbatim. */
async function gitRaw(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execa("git", args, { cwd });
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/git.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/git.ts test/git.test.ts
git commit -m "feat(git): read file content and changed files at a ref"
```

---

### Task 3: Build a commit's test patch

**Files:**
- Modify: `src/testfiles.ts`
- Modify: `src/types.ts:18` (append `TestFile`, extend `Task`)
- Test: `test/testfiles.test.ts` (append)

- [ ] **Step 1: Add the type**

Append to `src/types.ts`:

```typescript
/**
 * A test file restored to its post-fix content before the success check runs.
 * This is what makes pass/fail mean "did the task", not "didn't break anything":
 * at the start ref these tests fail, and only a correct change makes them pass.
 */
export interface TestFile {
  /** Repo-relative path. */
  path: string;
  /** Content at the fix commit. */
  content: string;
}
```

Then modify the `Task` interface in `src/types.ts` — add this field after `successCommand`:

```typescript
  /** Tests to restore before the success check. Empty for manual tasks. */
  testFiles: TestFile[];
```

- [ ] **Step 2: Write the failing test**

First extend the imports at the **top** of `test/testfiles.test.ts` (do not leave a
second import block mid-file):

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isTestFile, buildTestPatch } from "../src/testfiles.js";
```

Then append to the bottom of the same file:

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/testfiles.test.ts`
Expected: FAIL — `buildTestPatch is not a function`

- [ ] **Step 4: Write minimal implementation**

Append to `src/testfiles.ts`:

```typescript
import type { TestFile } from "./types.js";
import { filesChangedBetween, fileAtRef } from "./git.js";

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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/testfiles.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add src/testfiles.ts src/types.ts test/testfiles.test.ts
git commit -m "feat: build a fix commit's test patch for success checking"
```

---

### Task 4: Auto-extract only tasks that carry tests

**Files:**
- Modify: `src/tasks.ts:28-45` (`autoExtractTasks`) and `src/tasks.ts:11-19` (`manualTasks`)
- Test: `test/tasks.test.ts`

- [ ] **Step 1: Update the existing test**

The current suite in `test/tasks.test.ts` commits only non-test files, so under the new rule every auto-extracted task is dropped. Replace the whole file:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectTasks } from "../src/tasks.js";
import type { OptiruleConfig } from "../src/config.js";

function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

/** Commit a source change plus a matching test file, as a real fix commit would. */
function commitWithTest(dir: string, name: string, subject: string): void {
  mkdirSync(join(dir, "test"), { recursive: true });
  writeFileSync(join(dir, `${name}.ts`), subject);
  writeFileSync(join(dir, `test/${name}.test.ts`), `expect(${name})`);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", subject);
}

/** Commit a source-only change, with no test file. */
function commitWithoutTest(dir: string, name: string, subject: string): void {
  writeFileSync(join(dir, `${name}.ts`), subject);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", subject);
}

function config(overrides: Partial<OptiruleConfig> = {}): OptiruleConfig {
  return {
    agent: "claude",
    agent_args: [],
    instruction_files: ["CLAUDE.md"],
    test_command: "true",
    max_tasks: 4,
    reps: 5,
    tasks: [],
    ...overrides,
  };
}

describe("collectTasks auto-extraction", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "optirule-tasks-"));
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@t.co");
    git(dir, "config", "user.name", "t");
    commitWithoutTest(dir, "a", "init");
    commitWithTest(dir, "b", "feat: add the widget");
    commitWithTest(dir, "c", "fix: stop the crash");
    commitWithoutTest(dir, "d", "chore: tidy up");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("turns feat and fix commits that touched tests into tasks", async () => {
    const tasks = await collectTasks(dir, config());
    const prompts = tasks.map((t) => t.prompt).sort();
    expect(prompts).toEqual(["add the widget", "stop the crash"]);
    expect(tasks.every((t) => t.source === "git-history")).toBe(true);
    expect(tasks.every((t) => t.startRef.length >= 7)).toBe(true); // parent sha, not HEAD
  });

  it("carries each commit's post-fix test content as the success criterion", async () => {
    const tasks = await collectTasks(dir, config());
    const crash = tasks.find((t) => t.prompt === "stop the crash")!;
    expect(crash.testFiles).toEqual([
      { path: "test/c.test.ts", content: "expect(c)" },
    ]);
  });

  it("skips commits that touched no test files", async () => {
    commitWithoutTest(dir, "e", "fix: untested change");
    const tasks = await collectTasks(dir, config());
    expect(tasks.map((t) => t.prompt)).not.toContain("untested change");
  });

  it("lets manual tasks take priority and leaves their success command alone", async () => {
    const tasks = await collectTasks(
      dir,
      config({ tasks: [{ id: "m", prompt: "manual one", success: "true" }] }),
    );
    expect(tasks[0]!.id).toBe("m");
    expect(tasks[0]!.source).toBe("manual");
    expect(tasks[0]!.testFiles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tasks.test.ts`
Expected: FAIL — the `testFiles` assertions fail (property is undefined), and "skips commits that touched no test files" fails.

- [ ] **Step 3: Update the implementation**

In `src/tasks.ts`, add the import at the top:

```typescript
import { buildTestPatch } from "./testfiles.js";
```

Add `testFiles: []` to the object returned by `manualTasks`:

```typescript
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
```

Replace `autoExtractTasks` entirely:

```typescript
/**
 * Extract tasks from recent feat/fix commits. Each starts from the commit's
 * parent with the commit subject as its prompt, and carries the commit's test
 * files at their post-fix content. Commits that touched no tests are skipped:
 * without a test that fails at the parent there is no way to tell whether the
 * agent did the task, and the run would score a no-op agent as a pass.
 */
export async function autoExtractTasks(
  repoDir: string,
  config: OptiruleConfig,
  needed: number,
): Promise<Task[]> {
  if (needed <= 0) return [];
  // Over-fetch: commits without tests are dropped, so candidates exceed slots.
  const strict = await findFixCommits(repoDir, needed * 3);
  const commits =
    strict.length >= needed ? strict : await findFixCommits(repoDir, needed * 3, true);

  const tasks: Task[] = [];
  for (const commit of commits) {
    if (tasks.length >= needed) break;
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
```

Update the error message in `collectTasks` to reflect the new rule:

```typescript
    throw new Error(
      "No tasks found. Add tasks to optirule.yml, or ensure recent feat/fix commits changed test files — a commit with no test change cannot be scored.",
    );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/tasks.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/tasks.ts test/tasks.test.ts
git commit -m "feat(tasks): require a test patch for auto-extracted tasks"
```

---

### Task 5: Replace worktrees with history-free snapshots

**Files:**
- Create: `src/snapshot.ts`
- Delete: `src/worktree.ts`
- Modify: `src/constants.ts:6`
- Test: `test/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/snapshot.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshot, destroySnapshot } from "../src/snapshot.js";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
}

describe("createSnapshot", () => {
  let repo: string;
  let snap: string;
  let parent: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "optirule-repo-"));
    snap = join(mkdtempSync(join(tmpdir(), "optirule-snap-")), "work");
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t.co");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "a.txt"), "before\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "first");
    parent = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "a.txt"), "after\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "SECRET FUTURE FIX");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(snap, { recursive: true, force: true });
  });

  it("materialises the tree at the requested ref", async () => {
    await createSnapshot(repo, parent, snap);
    expect(readFileSync(join(snap, "a.txt"), "utf8")).toBe("before\n");
  });

  it("hides all future history from the snapshot", async () => {
    await createSnapshot(repo, parent, snap);
    const log = git(snap, "log", "--all", "--oneline");
    expect(log).not.toContain("SECRET FUTURE FIX");
    expect(log.split("\n")).toHaveLength(1);
  });

  it("supports git diff so changed files can be measured", async () => {
    await createSnapshot(repo, parent, snap);
    writeFileSync(join(snap, "a.txt"), "agent edit\n");
    expect(git(snap, "diff", "--name-only")).toBe("a.txt");
  });

  it("destroys the snapshot directory", async () => {
    await createSnapshot(repo, parent, snap);
    destroySnapshot(snap);
    expect(existsSync(snap)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/snapshot.test.ts`
Expected: FAIL — `Failed to resolve import "../src/snapshot.js"`

- [ ] **Step 3: Write the implementation**

Create `src/snapshot.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/snapshot.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Delete the worktree module and its constant**

```bash
git rm src/worktree.ts
```

In `src/constants.ts`, replace the `RUNS_DIR` line:

```typescript
export const SNAPSHOT_PREFIX = "optirule-run-";
```

- [ ] **Step 6: Verify nothing else imports the deleted module**

Run: `grep -rn "worktree\|RUNS_DIR" src/ test/`
Expected: only `src/runner.ts` (fixed in Task 6). If `src/git.ts`'s `addWorktree`/`removeWorktree` are now unreferenced, delete them too — they were only ever used by `worktree.ts`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: isolate runs in history-free snapshots instead of worktrees"
```

---

### Task 6: Apply the test patch after measuring the diff

**Files:**
- Modify: `src/runner.ts:1-11` (imports), `src/runner.ts:46-85` (`runTask`), `src/runner.ts:98-112` (`runAll`)
- Test: `test/runner.test.ts` (create)

The ordering matters and is easy to get wrong: **agent → measure changed files → apply test patch → success check**. Applying the patch before measuring would attribute our own test files to the agent.

- [ ] **Step 1: Write the failing test**

Create `test/runner.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTestPatch } from "../src/runner.js";

describe("applyTestPatch", () => {
  it("writes each test file, creating missing directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-patch-apply-"));
    try {
      applyTestPatch(dir, [{ path: "test/deep/a.test.ts", content: "expect(1)" }]);
      expect(readFileSync(join(dir, "test/deep/a.test.ts"), "utf8")).toBe("expect(1)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("overwrites a stale version of the same test", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-patch-apply-"));
    try {
      writeFileSync(join(dir, "a.test.ts"), "old");
      applyTestPatch(dir, [{ path: "a.test.ts", content: "new" }]);
      expect(readFileSync(join(dir, "a.test.ts"), "utf8")).toBe("new");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op for an empty patch", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-patch-apply-"));
    try {
      expect(() => applyTestPatch(dir, [])).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/runner.test.ts`
Expected: FAIL — `applyTestPatch is not a function`

- [ ] **Step 3: Update the implementation**

In `src/runner.ts`, replace the import block at the top:

```typescript
import { readFileSync, writeFileSync, rmSync, mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { OptiruleConfig } from "./config.js";
import type { AgentAdapter } from "./adapters.js";
import type { Task, RunResult, TestFile } from "./types.js";
import type { VariantSpec } from "./variants.js";
import { removeSection } from "./sections.js";
import { createSnapshot, destroySnapshot } from "./snapshot.js";
import { changedFiles } from "./git.js";
import { runSpec, runShell } from "./exec.js";
import { SNAPSHOT_PREFIX, AGENT_TIMEOUT_MS, SUCCESS_TIMEOUT_MS } from "./constants.js";
```

Add the exported helper above `runTask`:

```typescript
/**
 * Restore the task's test files at their post-fix content. Called only after
 * the agent's diff has been measured, so these files are never counted as the
 * agent's own changes.
 */
export function applyTestPatch(dir: string, testFiles: TestFile[]): void {
  for (const file of testFiles) {
    const dest = join(dir, file.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.content);
  }
}
```

Replace the body of the `try` block inside `runTask` (currently `src/runner.ts:59-78`) so the snapshot replaces the worktree and the patch lands in the right place:

```typescript
      try {
        await createSnapshot(repoDir, task.startRef, path);
        applyVariant(path, adapter.instructionFiles, contents, variant);
        const agent = await runSpec(adapter.buildCommand(task.prompt), path, AGENT_TIMEOUT_MS);
        // Measure the agent's diff before restoring tests, or the test files
        // we write would be attributed to the agent.
        const changed = (await changedFiles(path)).filter(
          (f) => !adapter.instructionFiles.includes(f),
        );
        applyTestPatch(path, task.testFiles);
        const check = await runShell(task.successCommand, path, SUCCESS_TIMEOUT_MS);
        const result: RunResult = {
          taskId: task.id,
          variant: variant.id,
          rep,
          passed: check.exitCode === 0,
          durationMs: agent.durationMs,
          tokens: adapter.parseTokenUsage(agent.stdout),
          filesChanged: changed,
          filesRead: adapter.parseFilesRead?.(agent.stdout),
        };
        results.push(result);
        onProgress?.(result);
      } finally {
        destroySnapshot(path);
      }
```

Change the `path` assignment at the top of the rep loop (`src/runner.ts:58`) — snapshots live outside the repo so the agent cannot walk up into the real `.git`:

```typescript
      const path = join(sessionDir, task.id, variant.id, `rep-${rep}`);
```

Thread `sessionDir` through: add it as a parameter to `runTask` after `repoDir`:

```typescript
async function runTask(
  repoDir: string,
  sessionDir: string,
  adapter: AgentAdapter,
```

And create it once in `runAll`, cleaning up at the end:

```typescript
export async function runAll(
  repoDir: string,
  config: OptiruleConfig,
  adapter: AgentAdapter,
  tasks: Task[],
  variants: VariantSpec[],
  onProgress?: ProgressFn,
): Promise<RunResult[]> {
  const contents = loadInstructionContents(repoDir, adapter.instructionFiles);
  const sessionDir = mkdtempSync(join(tmpdir(), SNAPSHOT_PREFIX));
  const all: RunResult[] = [];
  try {
    for (const task of tasks) {
      all.push(
        ...(await runTask(repoDir, sessionDir, adapter, task, contents, variants, config.reps, onProgress)),
      );
    }
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
  return all;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/runner.test.ts`
Expected: PASS, 3 tests

Run: `npm test && npm run typecheck`
Expected: both pass. `existsSync` may now be unused in `runner.ts` — it is still used by `applyVariant` and `loadInstructionContents`, so leave it.

- [ ] **Step 5: Commit**

```bash
git add src/runner.ts test/runner.test.ts
git commit -m "feat(runner): restore target tests after measuring the agent diff"
```

---

### Task 7: Drop tasks whose tests already pass at the start ref

**Files:**
- Create: `src/validate.ts`
- Modify: `src/commands/run.ts:45-47`
- Test: `test/validate.test.ts`

Without this gate a task can still be vacuous: if the fix commit only *edited* an existing test in a way that already passes at the parent, the agent gets a free pass. This is the PRD's original "skip commits where no tests fail at parent", restored.

- [ ] **Step 1: Write the failing test**

Create `test/validate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keepMeasurableTasks } from "../src/validate.js";
import type { Task } from "../src/types.js";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t",
    prompt: "do it",
    startRef: "HEAD",
    successCommand: "true",
    testFiles: [],
    source: "git-history",
    ...overrides,
  };
}

describe("keepMeasurableTasks", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "optirule-validate-"));
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@t.co");
    git(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "a.txt"), "x");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "init");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps a task whose tests fail at the start ref", async () => {
    const kept = await keepMeasurableTasks(dir, [
      task({ id: "real", successCommand: "false", testFiles: [{ path: "t.test", content: "x" }] }),
    ]);
    expect(kept.map((t) => t.id)).toEqual(["real"]);
  });

  it("drops a task whose tests already pass at the start ref", async () => {
    const kept = await keepMeasurableTasks(dir, [
      task({ id: "vacuous", successCommand: "true", testFiles: [{ path: "t.test", content: "x" }] }),
    ]);
    expect(kept).toEqual([]);
  });

  it("never probes manual tasks", async () => {
    const kept = await keepMeasurableTasks(dir, [
      task({ id: "m", source: "manual", successCommand: "true" }),
    ]);
    expect(kept.map((t) => t.id)).toEqual(["m"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/validate.test.ts`
Expected: FAIL — `Failed to resolve import "../src/validate.js"`

- [ ] **Step 3: Write the implementation**

Create `src/validate.ts`:

```typescript
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Task } from "./types.js";
import { createSnapshot, destroySnapshot } from "./snapshot.js";
import { applyTestPatch } from "./runner.js";
import { runShell } from "./exec.js";
import { SNAPSHOT_PREFIX, SUCCESS_TIMEOUT_MS } from "./constants.js";

/** Called for each task as it is probed, so callers can show progress. */
export type ProbeFn = (task: Task, measurable: boolean) => void;

/**
 * Keep only auto-extracted tasks whose target tests actually fail at the start
 * ref. A task whose tests already pass there measures nothing: any agent, doing
 * anything at all — including nothing — scores a pass. Manual tasks are trusted
 * as written and never probed.
 */
export async function keepMeasurableTasks(
  repoDir: string,
  tasks: Task[],
  onProbe?: ProbeFn,
): Promise<Task[]> {
  const session = mkdtempSync(join(tmpdir(), SNAPSHOT_PREFIX));
  const kept: Task[] = [];
  try {
    for (const task of tasks) {
      if (task.source === "manual") {
        kept.push(task);
        continue;
      }
      const path = join(session, `probe-${task.id}`);
      try {
        await createSnapshot(repoDir, task.startRef, path);
        applyTestPatch(path, task.testFiles);
        const check = await runShell(task.successCommand, path, SUCCESS_TIMEOUT_MS);
        const measurable = check.exitCode !== 0;
        onProbe?.(task, measurable);
        if (measurable) kept.push(task);
      } finally {
        destroySnapshot(path);
      }
    }
  } finally {
    rmSync(session, { recursive: true, force: true });
  }
  return kept;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/validate.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Wire it into the run command**

In `src/commands/run.ts`, add the import:

```typescript
import { keepMeasurableTasks } from "../validate.js";
```

Replace the task-collection block (`src/commands/run.ts:45-47`):

```typescript
  console.log("Collecting tasks...");
  const candidates = await collectTasks(repoDir, config);
  console.log(`Found ${candidates.length} candidate task(s). Checking each is measurable...`);
  const tasks = await keepMeasurableTasks(repoDir, candidates, (task, measurable) => {
    if (!measurable) console.log(`  skipped ${task.id}: its tests already pass at the start ref.`);
  });
  if (tasks.length === 0) {
    throw new Error(
      "No measurable tasks. Every candidate's tests already pass at its start ref, " +
        "so no run could tell a working agent from an idle one. Add tasks to optirule.yml.",
    );
  }
  console.log(`${tasks.length} measurable task(s).`);
```

- [ ] **Step 6: Verify the whole suite**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/validate.ts src/commands/run.ts test/validate.test.ts
git commit -m "feat: drop tasks whose target tests already pass at the start ref"
```

---

### Task 8: Correct the documented claims

**Files:**
- Modify: `README.md:31-46` (How it works), `README.md:71-79` (task sources), `README.md:150-158` (Caveats)

The README currently tells users pass/fail is uninformative and tokens are the real signal. That was a conclusion drawn from the broken success check, and it must not outlive it.

- [ ] **Step 1: Rewrite the "How it works" isolation and signal paragraphs**

Replace the paragraph beginning "Each variant runs `reps` times" with:

```markdown
Each variant runs `reps` times (default 5; agents are non-deterministic, so a
single run is noise). Every run happens in a **history-free snapshot** of your
repo at the task's start commit — one commit, no future history — so the agent
cannot read the commit that solves its own task.

For tasks taken from git history, success is the commit's own tests: optirule
restores the test files the fix commit touched, at their post-fix content, after
the agent finishes and after its diff has been measured. Those tests fail at the
start commit and pass only if the agent actually did the work, so **pass/fail
measures task completion**. Token usage, runtime, files changed, and files read
are reported alongside it as cost.
```

- [ ] **Step 2: Rewrite the git-history bullet**

Replace the "**Git history**" bullet with:

```markdown
- **Git history** — the most recent `feat:`/`fix:`/`bug`/`closes #` commits that
  **changed test files**. Each starts from the commit's parent with the commit
  message as the prompt, and is scored against that commit's tests. Commits with
  no test change are skipped, as are commits whose tests already pass at the
  parent — neither can distinguish a working agent from an idle one.
```

- [ ] **Step 3: Replace the first caveat**

Replace the caveat beginning "Agent token usage varies ~2×" with:

```markdown
- A task is only as good as the test the fix commit shipped. A thin test scores a
  thin solution as a pass.
- Commit subjects are terse prompts. A task whose commit message does not explain
  the intent may be unsolvable for reasons unrelated to your instructions.
- Agent token usage varies ~2× run-to-run on the same task, so token deltas from
  few runs are within noise; the report flags low confidence.
```

- [ ] **Step 4: Verify the docs match the code**

Run: `grep -n "worktree" README.md`
Expected: no matches — worktrees are gone.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: describe the real success construction and snapshot isolation"
```

---

## What this plan leaves for P1

This plan fixes measurement validity only — it does not implement the metrics the Reddit feedback asked for. Those are specified in full in
[`2026-07-21-compliance-metrics.md`](2026-07-21-compliance-metrics.md): the rubric and `optirule lint`, deterministic compliance checks, the blind judge, failure classification, mistakes-avoided as the headline, the ≥2-task keep rule, and guardrail protection in `export --minimal`.

P0 comes first because every one of those metrics is computed from runs, and until the success check can tell a working agent from an idle one, the runs themselves are not worth scoring.

**After Task 8, before starting P1:** run `optirule run` on this repo and look at the pass rates. The whole efficiency-first framing was built on pass rates that could not move. Now they can.
