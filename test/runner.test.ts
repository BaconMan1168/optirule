import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTestPatch, runAll } from "../src/runner.js";
import { buildTestPatch } from "../src/testfiles.js";
import type { AgentAdapter } from "../src/adapters.js";
import type { OptiruleConfig } from "../src/config.js";
import type { Task } from "../src/types.js";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
}

describe("applyTestPatch", () => {
  it("writes each test file, creating missing directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-patch-apply-"));
    try {
      applyTestPatch(dir, [{ path: "test/deep/a.test.ts", content: Buffer.from("expect(1)") }]);
      expect(readFileSync(join(dir, "test/deep/a.test.ts"), "utf8")).toBe("expect(1)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("overwrites a stale version of the same test", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-patch-apply-"));
    try {
      writeFileSync(join(dir, "a.test.ts"), "old");
      applyTestPatch(dir, [{ path: "a.test.ts", content: Buffer.from("new") }]);
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

describe("runAll measurement flow", () => {
  it("fails a no-op and passes the source fix against the restored regression test", async () => {
    const repo = mkdtempSync(join(tmpdir(), "optirule-runner-flow-"));
    try {
      git(repo, "init", "-q");
      git(repo, "config", "user.email", "t@t.co");
      git(repo, "config", "user.name", "t");
      writeFileSync(join(repo, "value.txt"), "broken\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "initial bug");
      const parent = git(repo, "rev-parse", "HEAD");

      writeFileSync(join(repo, "value.txt"), "fixed\n");
      writeFileSync(
        join(repo, "value.test.cjs"),
        'const fs = require("node:fs");\n' +
          'if (fs.readFileSync("value.txt", "utf8") !== "fixed\\n") process.exit(1);\n',
      );
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "fix: correct the value");
      const fix = git(repo, "rev-parse", "HEAD");

      const task: Task = {
        id: "fix-value",
        prompt: "correct the value",
        startRef: parent,
        successCommand: `${JSON.stringify(process.execPath)} value.test.cjs`,
        testFiles: await buildTestPatch(parent, fix, repo),
        source: "git-history",
      };
      const config: OptiruleConfig = {
        agent: "test",
        agent_args: [],
        instruction_files: [],
        test_command: task.successCommand,
        max_tasks: 1,
        reps: 1,
        tasks: [],
      };
      const adapter = (script: string): AgentAdapter => ({
        name: "test",
        instructionFiles: [],
        buildCommand: () => ({ command: process.execPath, args: ["-e", script] }),
        parseTokenUsage: () => undefined,
      });
      const variants = [{ id: "current", kind: "current" }] as const;

      const noOp = await runAll(repo, config, adapter(""), [task], [...variants]);
      expect(noOp).toMatchObject([{ passed: false, filesChanged: [] }]);

      const fixed = await runAll(
        repo,
        config,
        adapter('require("node:fs").writeFileSync("value.txt", "fixed\\n")'),
        [task],
        [...variants],
      );
      expect(fixed).toMatchObject([{ passed: true, filesChanged: ["value.txt"] }]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
