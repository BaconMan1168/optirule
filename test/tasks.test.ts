import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectTasks } from "../src/tasks.js";
import type { OptiruleConfig } from "../src/config.js";

function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

function commit(dir: string, file: string, subject: string): void {
  writeFileSync(join(dir, file), subject);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", subject);
}

function config(overrides: Partial<OptiruleConfig> = {}): OptiruleConfig {
  return {
    agent: "claude",
    instruction_files: ["CLAUDE.md"],
    test_command: "true", // passes everywhere: the old probe gate would drop every task
    max_tasks: 2,
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
    commit(dir, "a.txt", "init");
    commit(dir, "b.txt", "feat: add the widget");
    commit(dir, "c.txt", "fix: stop the crash");
    commit(dir, "d.txt", "chore: tidy up");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("turns recent feat and fix commits into tasks without a failing-parent gate", async () => {
    const tasks = await collectTasks(dir, config());
    const prompts = tasks.map((t) => t.prompt).sort();
    expect(prompts).toEqual(["add the widget", "stop the crash"]);
    expect(tasks.every((t) => t.source === "git-history")).toBe(true);
    expect(tasks.every((t) => t.startRef.length >= 7)).toBe(true); // parent sha, not HEAD
  });

  it("lets manual tasks take priority", async () => {
    const tasks = await collectTasks(
      dir,
      config({ tasks: [{ id: "m", prompt: "manual one", success: "true" }] }),
    );
    expect(tasks[0]!.id).toBe("m");
    expect(tasks[0]!.source).toBe("manual");
  });
});
