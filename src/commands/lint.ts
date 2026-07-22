import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../config.js";
import { resolveAdapter } from "../adapters.js";
import { parseSections } from "../sections.js";
import type { ParsedSection } from "../sections.js";
import { saveRubric, RUBRIC_FILENAME } from "../rubric.js";
import type { Rubric, Rule, CheckKind } from "../rubric.js";
import { runSpec } from "../exec.js";
import { SUCCESS_TIMEOUT_MS } from "../constants.js";

const SUPPORTED_KINDS: CheckKind[] = [
  "files-touched",
  "command-used",
  "public-api-preserved",
  "no-new-env-vars",
  "judge",
];

export function buildLintPrompt(sections: ParsedSection[], content: string): string {
  return `You are auditing a coding-agent instruction file. Split it into rules that can be
mechanically verified after an agent edits a repository, and rules that cannot.

Prefer a deterministic check kind over "judge" whenever one fits:
- files-touched: the change must stay within "allow" globs and never touch "forbid" globs.
- command-used: at least one shell command contains "require"; none contain "banned" strings.
- public-api-preserved: no exported symbol's signature is removed or changed.
- no-new-env-vars: the change introduces no environment variable that did not already exist.
- judge: anything else, as a yes/no "question" where yes means the rule was followed.

Put prose with no observable action in "unmeasurable" with a one-line reason. Also list
pairs of instructions that contradict each other in "conflicts".

Reply with JSON only:
{"rules":[{"id":"kebab-case","file":"...","section":"...","text":"verbatim",
"check":{"kind":"command-used","require":"npm test"}}],
"unmeasurable":[{"file":"...","section":"...","text":"...","reason":"..."}],
"conflicts":[{"a":"...","b":"...","reason":"..."}]}

Sections present: ${sections.map((s) => s.title).join(", ")}

The file:
${content}`;
}

export function parseLintResponse(reply: string): Rubric {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
  const candidate = fenced?.[1] ?? reply;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Could not read a rubric: the reply contained no JSON object.");
  }
  let raw: Partial<Rubric>;
  try {
    raw = JSON.parse(candidate.slice(start, end + 1)) as Partial<Rubric>;
  } catch {
    throw new Error("Could not read a rubric: the reply contained no JSON object.");
  }
  const rules = (raw.rules ?? []).filter(
    (rule): rule is Rule =>
      Boolean(rule?.check?.kind) && SUPPORTED_KINDS.includes(rule.check.kind),
  );
  return { rules, unmeasurable: raw.unmeasurable ?? [], conflicts: raw.conflicts ?? [] };
}

export async function runLint(repoDir: string): Promise<void> {
  const config = loadConfig(repoDir);
  const adapter = resolveAdapter(config.agent, config.instruction_files, config.agent_args);
  const merged: Rubric = { rules: [], unmeasurable: [], conflicts: [] };
  const scratch = mkdtempSync(join(tmpdir(), "optirule-lint-"));
  try {
    for (const file of config.instruction_files) {
      const path = join(repoDir, file);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf8");
      const prompt = buildLintPrompt(parseSections(content, file), content);
      const result = await runSpec(adapter.buildJudgeCommand(prompt), scratch, SUCCESS_TIMEOUT_MS);
      const rubric = parseLintResponse(adapter.extractText(result.stdout));
      merged.rules.push(...rubric.rules);
      merged.unmeasurable.push(...rubric.unmeasurable);
      merged.conflicts.push(...rubric.conflicts);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  saveRubric(repoDir, merged);
  console.log(`Wrote ${RUBRIC_FILENAME}: ${merged.rules.length} checkable rule(s).`);
  const deterministic = merged.rules.filter((rule) => rule.check.kind !== "judge").length;
  console.log(`  ${deterministic} checked for free, ${merged.rules.length - deterministic} need the judge.`);
  if (merged.unmeasurable.length) {
    console.log(`\n${merged.unmeasurable.length} instruction(s) cannot be scored:`);
    for (const rule of merged.unmeasurable) {
      console.log(`  [${rule.section}] ${rule.text} — ${rule.reason}`);
    }
  }
  if (merged.conflicts.length) {
    console.log(`\n${merged.conflicts.length} contradiction(s):`);
    for (const conflict of merged.conflicts) {
      console.log(`  "${conflict.a}" vs "${conflict.b}" — ${conflict.reason}`);
    }
  }
  console.log(`\nReview and edit ${RUBRIC_FILENAME} before running \`optirule run\`.`);
}
