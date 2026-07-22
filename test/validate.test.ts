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
      task({
        id: "real",
        successCommand: "false",
        testFiles: [{ path: "t.test", content: Buffer.from("x") }],
      }),
    ]);
    expect(kept.map((t) => t.id)).toEqual(["real"]);
  });

  it("drops a task whose tests already pass at the start ref", async () => {
    const kept = await keepMeasurableTasks(dir, [
      task({
        id: "vacuous",
        successCommand: "true",
        testFiles: [{ path: "t.test", content: Buffer.from("x") }],
      }),
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
