import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { runBenchmark } from "../src/commands/run.js";

function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

describe("run --plan", () => {
  it("prints the measured invocation plan without running an agent", async () => {
    const repo = mkdtempSync(join(tmpdir(), "optirule-plan-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      git(repo, "init", "-q");
      git(repo, "config", "user.email", "t@t.co");
      git(repo, "config", "user.name", "t");
      writeFileSync(join(repo, "CLAUDE.md"), "# Rules\n\nRun the tests.\n");
      writeFileSync(join(repo, "value.txt"), "broken\n");
      writeFileSync(
        join(repo, "optirule.yml"),
        stringify({
          agent: { command: `${JSON.stringify(process.execPath)} -e "process.exit(99)" {prompt}` },
          instruction_files: ["CLAUDE.md"],
          test_command: `${JSON.stringify(process.execPath)} -e "process.exit(1)"`,
          max_tasks: 1,
          reps: 1,
          tasks: [{ id: "manual", prompt: "Fix the value" }],
        }),
      );
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "test fixture");

      await runBenchmark(repo, { plan: true });

      expect(log).toHaveBeenCalledWith(expect.stringContaining("Planned run: 1 tasks"));
      expect(log).toHaveBeenCalledWith("Plan only — no agent or judge invocations were run.");
      expect(existsSync(join(repo, ".optirule", "report.html"))).toBe(false);
    } finally {
      log.mockRestore();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
