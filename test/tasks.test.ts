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
      { path: "test/c.test.ts", content: Buffer.from("expect(c)") },
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
