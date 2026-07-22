import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentAdapter } from "./adapters.js";
import type { Rule } from "./rubric.js";
import type { RunContext } from "./checks.js";
import type { RuleVerdict, Verdict } from "./types.js";
import { runSpec } from "./exec.js";
import { SUCCESS_TIMEOUT_MS } from "./constants.js";

const VERDICTS: Verdict[] = ["followed", "violated", "not-applicable"];
const MAX_DIFF_CHARS = 20_000;

export function buildJudgePrompt(taskPrompt: string, rules: Rule[], ctx: RunContext): string {
  const diff =
    ctx.diff.length > MAX_DIFF_CHARS
      ? `${ctx.diff.slice(0, MAX_DIFF_CHARS)}\n… diff truncated …`
      : ctx.diff;
  const questions = rules
    .map((rule) => `- id: ${rule.id}\n  question: ${rule.check.question ?? rule.text}`)
    .join("\n");

  return `A developer was asked to make a change to a repository. Judge the result against
each question below.

Answer each question with exactly one verdict:
- followed: the change satisfies the question.
- violated: the change contradicts it.
- not-applicable: the change never encountered the situation the question describes.
Use not-applicable freely; it is not a criticism.

Task given to the developer:
${taskPrompt}

Commands they ran:
${ctx.commands.length ? ctx.commands.map((command) => `  $ ${command}`).join("\n") : "  (none recorded)"}

Diff of their change:
${diff || "(no changes)"}

Questions:
${questions}

Reply with JSON only: [{"id":"<id>","verdict":"followed|violated|not-applicable"}]`;
}

export function parseJudgeResponse(reply: string, rules: Rule[]): RuleVerdict[] {
  const byId = new Map<string, Verdict>();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
  const candidate = fenced?.[1] ?? reply;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const value = entry as { id?: unknown; verdict?: unknown };
          if (typeof value.id !== "string" || typeof value.verdict !== "string") continue;
          if (VERDICTS.includes(value.verdict as Verdict)) {
            byId.set(value.id, value.verdict as Verdict);
          }
        }
      }
    } catch {
      // Missing answers become not-applicable below.
    }
  }
  return rules.map((rule) => ({
    ruleId: rule.id,
    verdict: byId.get(rule.id) ?? "not-applicable",
  }));
}

export async function judgeRun(
  adapter: AgentAdapter,
  taskPrompt: string,
  rules: Rule[],
  ctx: RunContext,
): Promise<RuleVerdict[]> {
  if (rules.length === 0) return [];
  const scratch = mkdtempSync(join(tmpdir(), "optirule-judge-"));
  try {
    const prompt = buildJudgePrompt(taskPrompt, rules, ctx);
    const result = await runSpec(adapter.buildJudgeCommand(prompt), scratch, SUCCESS_TIMEOUT_MS);
    return parseJudgeResponse(adapter.extractText(result.stdout), rules);
  } catch {
    return rules.map((rule) => ({ ruleId: rule.id, verdict: "not-applicable" as const }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
