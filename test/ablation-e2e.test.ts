import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { runBenchmark } from "../src/commands/run.js";
import type { Analysis } from "../src/analyze.js";
import type { SavedRunPlan } from "../src/runplan.js";

function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

describe("fake-agent ablation end to end", () => {
  it("executes the approved variants and writes schema-v2 HTML and JSON", async () => {
    const repo = mkdtempSync(join(tmpdir(), "optirule-ablation-e2e-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      git(repo, "init", "-q");
      git(repo, "config", "user.email", "t@t.co");
      git(repo, "config", "user.name", "t");
      writeFileSync(
        join(repo, "CLAUDE.md"),
        "## Correctness\nFix the requested value.\n## Scope\nOnly edit what is needed.\n",
      );
      writeFileSync(join(repo, "value.txt"), "broken\n");
      writeFileSync(
        join(repo, "fake-agent.cjs"),
        'require("node:fs").writeFileSync("value.txt", "fixed\\n");\n',
      );
      writeFileSync(
        join(repo, "fake-check.cjs"),
        'process.exit(require("node:fs").readFileSync("value.txt", "utf8") === "fixed\\n" ? 0 : 1);\n',
      );
      writeFileSync(
        join(repo, "optirule.yml"),
        stringify({
          agent: {
            command: `${JSON.stringify(process.execPath)} fake-agent.cjs {prompt}`,
          },
          instruction_files: ["CLAUDE.md"],
          test_command: `${JSON.stringify(process.execPath)} fake-check.cjs`,
          max_tasks: 1,
          reps: 1,
          tasks: [{ id: "fix-value", prompt: "Fix the value" }],
        }),
      );
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "test fixture");

      await runBenchmark(repo, { ablate: true, plan: true });
      const approved = JSON.parse(
        readFileSync(join(repo, ".optirule/run-plan.json"), "utf8"),
      ) as SavedRunPlan;
      expect(approved.variantIds).toEqual([
        "baseline",
        "current",
        "ablate-correctness",
        "ablate-scope",
      ]);

      await runBenchmark(repo, { ablate: true, yes: true });

      const analysis = JSON.parse(
        readFileSync(join(repo, ".optirule/analysis.json"), "utf8"),
      ) as Analysis;
      const html = readFileSync(join(repo, ".optirule/report.html"), "utf8");
      expect(analysis.schemaVersion).toBe(2);
      expect(analysis.ablation).toMatchObject({
        valid: true,
        planFingerprint: approved.fingerprint,
      });
      expect(analysis.ablation!.sections).toHaveLength(2);
      expect(analysis.ablation!.sections.every((section) => section.ablatedRuns === 1)).toBe(true);
      expect(
        analysis.ablation!.sections.every(
          (section) =>
            section.confidence === "low" && section.classification === "inconclusive",
        ),
      ).toBe(true);
      expect(html).toContain("Section ablation");
      expect(html).toContain("Correctness");
      expect(html).toContain("Inconclusive");
    } finally {
      log.mockRestore();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
