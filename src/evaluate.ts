import type { Rule } from "./rubric.js";
import type { RunContext } from "./checks.js";
import type { RuleVerdict, FailureCategory } from "./types.js";
import {
  checkFilesTouched,
  checkCommandUsed,
  checkPublicApiPreserved,
  checkNoNewEnvVars,
} from "./checks.js";

export function evaluateDeterministic(rules: Rule[], ctx: RunContext): RuleVerdict[] {
  const verdicts: RuleVerdict[] = [];
  for (const rule of rules) {
    switch (rule.check.kind) {
      case "files-touched":
        verdicts.push({ ruleId: rule.id, verdict: checkFilesTouched(rule.check, ctx) });
        break;
      case "command-used":
        verdicts.push({ ruleId: rule.id, verdict: checkCommandUsed(rule.check, ctx) });
        break;
      case "public-api-preserved":
        verdicts.push({ ruleId: rule.id, verdict: checkPublicApiPreserved(ctx) });
        break;
      case "no-new-env-vars":
        verdicts.push({ ruleId: rule.id, verdict: checkNoNewEnvVars(ctx) });
        break;
      case "judge":
        break;
    }
  }
  return verdicts;
}

export function classifyFailure(
  passed: boolean,
  ctx: RunContext,
  verdicts: RuleVerdict[],
): FailureCategory | undefined {
  if (passed) return undefined;
  if (ctx.timedOut) return "timed-out";
  if (ctx.filesChanged.length === 0) return "no-op";
  if (verdicts.some((verdict) => verdict.verdict === "violated")) {
    return "ignored-instructions";
  }
  return "wrong-code";
}
