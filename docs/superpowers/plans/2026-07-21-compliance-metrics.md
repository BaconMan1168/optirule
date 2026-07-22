# Compliance Metrics (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** `docs/superpowers/plans/2026-07-21-measurement-validity.md` (P0) must be landed. This plan assumes `Task.testFiles`, `src/snapshot.ts`, and a real pass/fail signal exist.

**Goal:** Make "mistakes avoided" — violations of your own written conventions that the instruction file prevented — the headline metric, replacing token efficiency.

**Architecture:** A rubric is extracted from the instruction file *before any run*, as editable YAML. Each rule carries a check: four deterministic kinds computed from the diff and the agent's shell commands at zero cost, plus a `judge` kind batched into one blind LLM call per run through the agent CLI the user already has. Every run yields a per-rule verdict of followed / violated / **not-applicable**. A section earns its keep only when it reduces violations on **two or more distinct tasks**; a section whose rules were never applicable is reported as never-exercised and is never dropped. Tokens survive as a cost column and as cost-per-success.

**Tech Stack:** TypeScript (ESM), execa, vitest, yaml. No new dependencies — glob matching is a small local helper rather than picomatch.

---

## Traceability to the feedback

Every task below exists because someone asked for it. If a task's justification is unclear, this table is the answer.

| Feedback | Task |
|---|---|
| "main metric 'mistakes avoided', not token count" | 9, 11 |
| "define a rubric **before** running" | 1, 2 |
| "used the right test command / touched allowed files only / preserved public API / did not invent env vars" | 4, 5 |
| "followed the framework pattern" (not mechanically checkable) | 6 |
| "score the outputs **blindly** against the rubric" | 6 |
| "keep sections only if they change decisions on **more than one task**" | 9 (the rule), 10 (enforced on export) |
| "rare but critical guardrails that only matter during risky changes" | 10 (`never-exercised` is undroppable) |
| "classify the failures **before** comparing anything" | 7 |
| "runs-per-variant: enough that a difference is signal" | 8 (bootstrap CI), 9 (applied), 12 (pre-run warning) |
| "go wider not deeper — more tasks, fewer reps" | 12 |
| "LLM-verification of 'were the claude.md rules followed'" | 6 |
| "step ONE: audit claude.md for known-bad patterns and things that AREN'T instructions" | 2 |
| "2 things: is the instruction followed / is it a good idea" | 11 (two-axis report) |
| "which context is redundant? which pieces conflict?" | 2 (conflicts), 9 (redundant signal), 10 (acted on) |
| "code churn, tool calls, cost per successful implementation" | 3, 7, 11 |
| "generalize from one CLAUDE.md to every piece of context" | 12 (file-level units) |

**Explicitly not built, and why:**

- "Iterations before success" and "corrective prompts required" (commenter 4) presuppose an interactive loop; optirule runs agents one-shot, so both are structurally always 1.
- "Similarity to desired architecture" is the unmeasurable-taste problem commenter 5 named — the rubric replaces it with checkable rules rather than scoring resemblance.
- **Bug reintroduction** (commenter 5: find the commit that *made* the bug, see if the agent re-introduces it) is a genuinely good eval and the P0 fix-commit machinery gets it halfway. It is not here because reliably identifying the bug-introducing commit needs `git log -S` archaeology or bisection, and gets it wrong often enough that the tasks would need human review — which breaks the zero-setup promise. Worth a spike after this lands, not a task inside it.
- Auto-mutation of CLAUDE.md (commenter 5) needs this plan's scoring to exist before there is anything to mutate against.

---

## File Structure

**New files:**
- `src/rubric.ts` — rubric types, YAML load/save. One responsibility: the rubric's shape on disk.
- `src/commands/lint.ts` — the `optirule lint` command: section → rules, unmeasurable flags, conflicts.
- `src/checks.ts` — the four deterministic checkers plus the glob helper.
- `src/judge.ts` — blind batched LLM scoring through the agent adapter.
- `src/evaluate.ts` — runs all checks for one run, returns verdicts; classifies failures.
- `src/stats.ts` — paired deltas and bootstrap confidence intervals.
- Tests: `test/rubric.test.ts`, `test/lint.test.ts`, `test/checks.test.ts`, `test/judge.test.ts`, `test/evaluate.test.ts`, `test/stats.test.ts`

**Modified:**
- `src/types.ts` — `RunResult` gains `verdicts`, `churn`, `toolCalls`, `failure`.
- `src/adapters.ts` — `parseCommands`, `parseToolCalls`, `buildJudgeCommand`.
- `src/git.ts` — `unifiedDiff`, `churnLines`.
- `src/runner.ts` — collects diff/commands, evaluates rules per run.
- `src/analyze.ts` — compliance analysis replaces token-delta analysis as the headline.
- `src/report.ts` — two-axis report.
- `src/commands/export.ts` — keys off compliance, protects never-exercised sections.
- `src/config.ts` — `reps` 5→3, `max_tasks` 8→15.
- `src/cli.ts` — register `lint`, add `--ablate-files`.

---

### Task 1: The rubric file format

**Files:**
- Create: `src/rubric.ts`
- Test: `test/rubric.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/rubric.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRubric, saveRubric, RUBRIC_FILENAME } from "../src/rubric.js";
import type { Rubric } from "../src/rubric.js";

const sample: Rubric = {
  rules: [
    {
      id: "test-command",
      file: "CLAUDE.md",
      section: "Testing",
      text: "Always run tests with `npm test`",
      check: { kind: "command-used", require: "npm test" },
    },
  ],
  unmeasurable: [
    { file: "CLAUDE.md", section: "Philosophy", text: "Be an expert engineer", reason: "not an instruction" },
  ],
  conflicts: [],
};

describe("rubric persistence", () => {
  it("round-trips through YAML", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-rubric-"));
    try {
      saveRubric(dir, sample);
      expect(existsSync(join(dir, RUBRIC_FILENAME))).toBe(true);
      expect(loadRubric(dir)).toEqual(sample);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined when no rubric exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-rubric-"));
    try {
      expect(loadRubric(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults missing sections so a hand-edited rubric still loads", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-rubric-"));
    try {
      writeFileSync(join(dir, RUBRIC_FILENAME), "rules: []\n");
      expect(loadRubric(dir)).toEqual({ rules: [], unmeasurable: [], conflicts: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rubric.test.ts`
Expected: FAIL — `Failed to resolve import "../src/rubric.js"`

- [ ] **Step 3: Write the implementation**

Create `src/rubric.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

export const RUBRIC_FILENAME = "optirule.rubric.yml";

/**
 * How a rule is checked. Four kinds are deterministic and free — they read the
 * diff and the agent's shell commands. `judge` is the escape hatch for rules
 * that need reading comprehension, and costs one batched LLM call per run.
 */
export type CheckKind =
  | "files-touched"
  | "command-used"
  | "public-api-preserved"
  | "no-new-env-vars"
  | "judge";

export interface Check {
  kind: CheckKind;
  /** files-touched: globs the change must never touch. */
  forbid?: string[];
  /** files-touched: globs the change must stay within, when set. */
  allow?: string[];
  /** command-used: substring at least one agent command must contain. */
  require?: string;
  /** command-used: substrings no agent command may contain. */
  banned?: string[];
  /** judge: a yes/no question where "yes" means the rule was followed. */
  question?: string;
}

/** One checkable instruction, traced back to the section it came from. */
export interface Rule {
  id: string;
  file: string;
  section: string;
  /** The instruction verbatim, so a human can audit the extraction. */
  text: string;
  check: Check;
}

/** An instruction that cannot be checked, and why. Reported, never scored. */
export interface UnmeasurableRule {
  file: string;
  section: string;
  text: string;
  reason: string;
}

/** Two instructions that contradict each other, found statically at lint time. */
export interface RuleConflict {
  a: string;
  b: string;
  reason: string;
}

export interface Rubric {
  rules: Rule[];
  unmeasurable: UnmeasurableRule[];
  conflicts: RuleConflict[];
}

/** Read the rubric, or undefined when the user has not run `optirule lint`. */
export function loadRubric(dir: string): Rubric | undefined {
  const path = join(dir, RUBRIC_FILENAME);
  if (!existsSync(path)) return undefined;
  const raw = (parse(readFileSync(path, "utf8")) ?? {}) as Partial<Rubric>;
  return {
    rules: raw.rules ?? [],
    unmeasurable: raw.unmeasurable ?? [],
    conflicts: raw.conflicts ?? [],
  };
}

/** Write the rubric for the user to review and edit before spending money. */
export function saveRubric(dir: string, rubric: Rubric): void {
  writeFileSync(join(dir, RUBRIC_FILENAME), stringify(rubric));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/rubric.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/rubric.ts test/rubric.test.ts
git commit -m "feat: add the rubric file format for checkable instructions"
```

---

### Task 2: `optirule lint` — audit the file before spending a cent

This is commenter 5's "step ONE": audit CLAUDE.md for things that aren't instructions. It runs zero agent tasks, needs no benchmark, and produces the rubric that everything downstream scores against — so the user edits it *before* running.

**Files:**
- Create: `src/commands/lint.ts`
- Modify: `src/cli.ts`
- Test: `test/lint.test.ts`

- [ ] **Step 1: Write the failing test**

The extraction itself is an LLM call, so the test covers the deterministic parts: prompt construction and response parsing.

Create `test/lint.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildLintPrompt, parseLintResponse } from "../src/commands/lint.js";
import type { ParsedSection } from "../src/sections.js";

const sections: ParsedSection[] = [
  { file: "CLAUDE.md", title: "Testing", tokens: 20, startLine: 0, endLine: 3 },
];

describe("buildLintPrompt", () => {
  it("includes the section text and every supported check kind", () => {
    const prompt = buildLintPrompt(sections, "## Testing\nAlways run `npm test`.\n");
    expect(prompt).toContain("## Testing");
    expect(prompt).toContain("files-touched");
    expect(prompt).toContain("command-used");
    expect(prompt).toContain("public-api-preserved");
    expect(prompt).toContain("no-new-env-vars");
    expect(prompt).toContain("judge");
  });

  it("asks for unmeasurable instructions to be separated out", () => {
    const prompt = buildLintPrompt(sections, "## Philosophy\nBe an expert.\n");
    expect(prompt.toLowerCase()).toContain("unmeasurable");
  });
});

describe("parseLintResponse", () => {
  it("extracts a rubric from a fenced JSON reply", () => {
    const reply = [
      "Here is the rubric:",
      "```json",
      JSON.stringify({
        rules: [
          {
            id: "test-command",
            file: "CLAUDE.md",
            section: "Testing",
            text: "Always run `npm test`",
            check: { kind: "command-used", require: "npm test" },
          },
        ],
        unmeasurable: [
          { file: "CLAUDE.md", section: "Philosophy", text: "Be an expert", reason: "no observable action" },
        ],
        conflicts: [],
      }),
      "```",
    ].join("\n");

    const rubric = parseLintResponse(reply);
    expect(rubric.rules).toHaveLength(1);
    expect(rubric.rules[0]!.check.kind).toBe("command-used");
    expect(rubric.unmeasurable).toHaveLength(1);
  });

  it("drops rules whose check kind is not supported", () => {
    const reply = JSON.stringify({
      rules: [
        { id: "a", file: "f", section: "s", text: "t", check: { kind: "vibes" } },
        { id: "b", file: "f", section: "s", text: "t", check: { kind: "judge", question: "ok?" } },
      ],
    });
    const rubric = parseLintResponse(reply);
    expect(rubric.rules.map((r) => r.id)).toEqual(["b"]);
  });

  it("throws on a reply with no JSON at all", () => {
    expect(() => parseLintResponse("I could not do that.")).toThrow(/no JSON/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lint.test.ts`
Expected: FAIL — `Failed to resolve import "../src/commands/lint.js"`

- [ ] **Step 3: Write the implementation**

Create `src/commands/lint.ts`:

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
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

/** Ask the agent to turn an instruction file into checkable rules. */
export function buildLintPrompt(sections: ParsedSection[], content: string): string {
  return `You are auditing a coding-agent instruction file. Split it into rules that can be
mechanically verified after an agent edits a repository, and rules that cannot.

A good rule is a specific recipe: "if X, then Y". "Always run tests with npm test",
"never edit files under dist/", "do not add new environment variables".
An unmeasurable instruction has no observable action to check: "be an expert software
engineer", "make no mistakes", "ask the human if you are unsure". These go in
"unmeasurable" with a one-line reason — they are not failures, they just cannot be scored.

Prefer a deterministic check kind over "judge" whenever one fits:
- files-touched: the change must stay within "allow" globs and never touch "forbid" globs.
- command-used: at least one shell command the agent ran contains "require"; none contain
  any string in "banned".
- public-api-preserved: no exported symbol's signature is removed or changed.
- no-new-env-vars: the change introduces no environment variable that did not already exist.
- judge: anything else, expressed as a yes/no "question" where yes means the rule was followed.

Also list any pair of instructions that contradict each other, in "conflicts".

Reply with JSON only, in this shape:
{"rules":[{"id":"kebab-case","file":"...","section":"...","text":"the instruction verbatim",
"check":{"kind":"command-used","require":"npm test"}}],
"unmeasurable":[{"file":"...","section":"...","text":"...","reason":"..."}],
"conflicts":[{"a":"...","b":"...","reason":"..."}]}

Sections present: ${sections.map((s) => s.title).join(", ")}

The file:
${content}`;
}

/** Pull the first JSON object out of a reply and keep only supported rules. */
export function parseLintResponse(reply: string): Rubric {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
  const candidate = fenced?.[1] ?? reply;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error(`Could not read a rubric: the reply contained no JSON object.`);
  }
  let raw: Partial<Rubric>;
  try {
    raw = JSON.parse(candidate.slice(start, end + 1)) as Partial<Rubric>;
  } catch {
    throw new Error(`Could not read a rubric: the reply contained no JSON object.`);
  }
  const rules = (raw.rules ?? []).filter((r): r is Rule =>
    Boolean(r?.check?.kind) && SUPPORTED_KINDS.includes(r.check.kind),
  );
  return { rules, unmeasurable: raw.unmeasurable ?? [], conflicts: raw.conflicts ?? [] };
}

/** Audit every instruction file and write a rubric for the user to edit. */
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
  const deterministic = merged.rules.filter((r) => r.check.kind !== "judge").length;
  console.log(`  ${deterministic} checked for free, ${merged.rules.length - deterministic} need the judge.`);
  if (merged.unmeasurable.length) {
    console.log(`\n${merged.unmeasurable.length} instruction(s) cannot be scored:`);
    for (const u of merged.unmeasurable) console.log(`  [${u.section}] ${u.text} — ${u.reason}`);
  }
  if (merged.conflicts.length) {
    console.log(`\n${merged.conflicts.length} contradiction(s):`);
    for (const c of merged.conflicts) console.log(`  "${c.a}" vs "${c.b}" — ${c.reason}`);
  }
  console.log(`\nReview and edit ${RUBRIC_FILENAME} before running \`optirule run\`.`);
}
```

- [ ] **Step 4: Add the two adapter methods this depends on**

In `src/adapters.ts`, extend the `AgentAdapter` interface:

```typescript
  /** Build a read-only invocation for scoring prompts, with no edit permissions. */
  buildJudgeCommand(prompt: string): SpawnSpec;
  /** Pull the agent's plain-text reply out of its structured output. */
  extractText(stdout: string): string;
```

Add these helpers near `parseJsonLines`:

```typescript
/** Concatenate assistant text blocks from a JSON-lines transcript. */
function textFromJsonLines(stdout: string): string {
  const parts: string[] = [];
  for (const obj of parseJsonLines(stdout)) {
    const o = obj as { result?: unknown; message?: { content?: unknown } };
    if (typeof o.result === "string") parts.push(o.result);
    if (!Array.isArray(o.message?.content)) continue;
    for (const block of o.message.content) {
      const b = block as { type?: string; text?: string };
      if (b.type === "text" && b.text) parts.push(b.text);
    }
  }
  return parts.join("\n");
}
```

Add to `claudeAdapter`:

```typescript
    buildJudgeCommand(prompt) {
      return {
        command: "claude",
        args: ["-p", prompt, "--output-format", "stream-json", "--verbose"],
      };
    },
    extractText: textFromJsonLines,
```

Add to `codexAdapter`:

```typescript
    buildJudgeCommand(prompt) {
      return { command: "codex", args: ["exec", "--json", "--sandbox", "read-only", prompt] };
    },
    extractText: textFromJsonLines,
```

Add to `geminiAdapter`:

```typescript
    buildJudgeCommand(prompt) {
      return { command: "gemini", args: ["-p", prompt, "--output-format", "json"] };
    },
    extractText(stdout) {
      try {
        return (JSON.parse(stdout) as { response?: string }).response ?? stdout;
      } catch {
        return stdout;
      }
    },
```

Add to `opencodeAdapter`:

```typescript
    buildJudgeCommand(prompt) {
      return { command: "opencode", args: ["run", prompt, "--format", "json"] };
    },
    extractText: textFromJsonLines,
```

Add to `aiderAdapter`:

```typescript
    buildJudgeCommand(prompt) {
      return { command: "aider", args: ["--no-auto-commits", "--message", prompt] };
    },
    extractText: (stdout) => stdout,
```

Add to `genericAdapter` — a custom command cannot be trusted to be read-only, so it declines:

```typescript
    buildJudgeCommand() {
      throw new Error(
        "A custom `command:` agent cannot be used as a judge (optirule cannot guarantee it " +
          "runs read-only). Use judge-free rules, or set `agent` to a built-in adapter.",
      );
    },
    extractText: (stdout) => stdout,
```

- [ ] **Step 5: Register the command**

In `src/cli.ts`, add alongside the existing commands:

```typescript
program
  .command("lint")
  .description("audit instruction files and write an editable rubric — no agent runs")
  .action(() => runLint(process.cwd()));
```

with `import { runLint } from "./commands/lint.js";` at the top.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/lint.test.ts && npm run typecheck`
Expected: PASS, 5 tests, and typecheck clean (every adapter now implements the two new methods).

- [ ] **Step 7: Commit**

```bash
git add src/commands/lint.ts src/adapters.ts src/cli.ts test/lint.test.ts
git commit -m "feat: add optirule lint to extract an editable rubric before any run"
```

---

### Task 3: Capture the agent's commands, tool calls, and churn

**Files:**
- Modify: `src/adapters.ts`, `src/git.ts`
- Test: `test/adapters.test.ts` (append), `test/git.test.ts` (append)

- [ ] **Step 1: Write the failing adapter test**

Append to `test/adapters.test.ts`:

```typescript
import { resolveAdapter } from "../src/adapters.js";

describe("claude transcript parsing", () => {
  const stdout = [
    JSON.stringify({
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          { type: "tool_use", name: "Read", input: { file_path: "src/a.ts" } },
        ],
      },
    }),
    JSON.stringify({
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git status" } }] },
    }),
  ].join("\n");

  it("lists the shell commands the agent ran", () => {
    const adapter = resolveAdapter("claude", ["CLAUDE.md"]);
    expect(adapter.parseCommands!(stdout)).toEqual(["npm test", "git status"]);
  });

  it("counts every tool call, not just Bash", () => {
    const adapter = resolveAdapter("claude", ["CLAUDE.md"]);
    expect(adapter.parseToolCalls!(stdout)).toBe(3);
  });
});
```

- [ ] **Step 2: Write the failing git test**

Append to `test/git.test.ts`, inside the existing `describe("git ref helpers")` block:

```typescript
  it("reports churn as lines added plus deleted", async () => {
    writeFileSync(join(dir, "src.ts"), "export const x = 3;\nexport const y = 4;\n");
    expect(await churnLines(dir)).toBe(3); // 1 deleted, 2 added
  });

  it("returns the unified diff of the working tree", async () => {
    writeFileSync(join(dir, "src.ts"), "export const x = 9;\n");
    const diff = await unifiedDiff(dir);
    expect(diff).toContain("-export const x = 2;");
    expect(diff).toContain("+export const x = 9;");
  });
```

and extend that file's import to `import { filesChangedBetween, fileAtRef, churnLines, unifiedDiff } from "../src/git.js";`

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/adapters.test.ts test/git.test.ts`
Expected: FAIL — `parseCommands is not a function`, `churnLines is not a function`

- [ ] **Step 4: Write the implementations**

In `src/adapters.ts`, extend the interface:

```typescript
  /** Shell commands the agent ran, when its output exposes them. */
  parseCommands?(stdout: string): string[] | undefined;
  /** Total tool invocations, as an effort signal. */
  parseToolCalls?(stdout: string): number | undefined;
```

Add a shared helper near `parseJsonLines`:

```typescript
/** Every tool_use block in a JSON-lines transcript. */
function toolUses(stdout: string): { name?: string; input?: Record<string, unknown> }[] {
  const uses: { name?: string; input?: Record<string, unknown> }[] = [];
  for (const obj of parseJsonLines(stdout)) {
    const content = (obj as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = block as { type?: string; name?: string; input?: Record<string, unknown> };
      if (b.type === "tool_use") uses.push({ name: b.name, input: b.input });
    }
  }
  return uses;
}
```

Add to `claudeAdapter` (and, identically, to `opencodeAdapter`):

```typescript
    parseCommands(stdout) {
      const commands = toolUses(stdout)
        .filter((u) => u.name === "Bash" && typeof u.input?.command === "string")
        .map((u) => u.input!.command as string);
      return commands.length ? commands : undefined;
    },
    parseToolCalls(stdout) {
      const uses = toolUses(stdout);
      return uses.length ? uses.length : undefined;
    },
```

In `src/git.ts`, append:

```typescript
/** The working tree's unified diff against HEAD. */
export function unifiedDiff(cwd: string): Promise<string> {
  return git(["diff", "--unified=3"], cwd);
}

/** Lines added plus lines deleted in the working tree — a code-churn signal. */
export async function churnLines(cwd: string): Promise<number> {
  const out = await git(["diff", "--numstat"], cwd);
  if (!out) return 0;
  let total = 0;
  for (const line of out.split("\n")) {
    const [added, deleted] = line.split("\t");
    // Binary files report "-"; they contribute no line churn.
    total += (Number(added) || 0) + (Number(deleted) || 0);
  }
  return total;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/adapters.test.ts test/git.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters.ts src/git.ts test/adapters.test.ts test/git.test.ts
git commit -m "feat: capture agent commands, tool-call counts, and code churn"
```

---

### Task 4: Deterministic checks — files touched and command used

**Files:**
- Create: `src/checks.ts`
- Test: `test/checks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/checks.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { globToRegExp, checkFilesTouched, checkCommandUsed } from "../src/checks.js";
import type { RunContext } from "../src/checks.js";

function ctx(overrides: Partial<RunContext> = {}): RunContext {
  return { filesChanged: [], diff: "", commands: [], timedOut: false, ...overrides };
}

describe("globToRegExp", () => {
  it("matches ** across directory separators", () => {
    expect(globToRegExp("dist/**").test("dist/a/b.js")).toBe(true);
    expect(globToRegExp("dist/**").test("src/a.js")).toBe(false);
  });

  it("keeps * within a single segment", () => {
    expect(globToRegExp("*.lock").test("pnpm.lock")).toBe(true);
    expect(globToRegExp("*.lock").test("sub/pnpm.lock")).toBe(false);
  });

  it("escapes regex metacharacters in literal text", () => {
    expect(globToRegExp("a.b").test("a.b")).toBe(true);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
  });
});

describe("checkFilesTouched", () => {
  it("is not-applicable when the agent changed nothing", () => {
    expect(checkFilesTouched({ kind: "files-touched", forbid: ["dist/**"] }, ctx())).toBe(
      "not-applicable",
    );
  });

  it("is violated when a forbidden path was touched", () => {
    const c = ctx({ filesChanged: ["src/a.ts", "dist/bundle.js"] });
    expect(checkFilesTouched({ kind: "files-touched", forbid: ["dist/**"] }, c)).toBe("violated");
  });

  it("is followed when every change is inside the allowed globs", () => {
    const c = ctx({ filesChanged: ["src/a.ts", "src/b.ts"] });
    expect(checkFilesTouched({ kind: "files-touched", allow: ["src/**"] }, c)).toBe("followed");
  });

  it("is violated when a change escapes the allowed globs", () => {
    const c = ctx({ filesChanged: ["src/a.ts", "scripts/x.sh"] });
    expect(checkFilesTouched({ kind: "files-touched", allow: ["src/**"] }, c)).toBe("violated");
  });
});

describe("checkCommandUsed", () => {
  it("is not-applicable when the agent ran no commands", () => {
    expect(checkCommandUsed({ kind: "command-used", require: "npm test" }, ctx())).toBe(
      "not-applicable",
    );
  });

  it("is followed when a required substring appears", () => {
    const c = ctx({ commands: ["ls", "npm test -- --watch=false"] });
    expect(checkCommandUsed({ kind: "command-used", require: "npm test" }, c)).toBe("followed");
  });

  it("is violated when the required command never ran", () => {
    const c = ctx({ commands: ["npx jest"] });
    expect(checkCommandUsed({ kind: "command-used", require: "npm test" }, c)).toBe("violated");
  });

  it("is violated when a banned command ran, even if the required one did too", () => {
    const c = ctx({ commands: ["npm test", "npx jest"] });
    const check = { kind: "command-used" as const, require: "npm test", banned: ["jest"] };
    expect(checkCommandUsed(check, c)).toBe("violated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/checks.test.ts`
Expected: FAIL — `Failed to resolve import "../src/checks.js"`

- [ ] **Step 3: Write the implementation**

Create `src/checks.ts`:

```typescript
import type { Check } from "./rubric.js";
import type { Verdict } from "./types.js";

/** Everything a deterministic check needs from one completed run. */
export interface RunContext {
  /** Repo-relative paths the agent changed, instruction files excluded. */
  filesChanged: string[];
  /** Unified diff of the agent's changes. */
  diff: string;
  /** Shell commands the agent ran, empty when the adapter cannot report them. */
  commands: string[];
  /** Whether the agent hit its timeout. */
  timedOut: boolean;
}

/**
 * Convert a path glob to an anchored regex. `**` crosses directory separators,
 * `*` does not, and everything else is literal.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        // Swallow the slash in `**/` so it also matches zero directories.
        if (glob[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

/**
 * A path rule. Not applicable when the agent changed nothing — an idle agent
 * has not obeyed a rule about where to edit, it simply never faced it.
 */
export function checkFilesTouched(check: Check, ctx: RunContext): Verdict {
  if (ctx.filesChanged.length === 0) return "not-applicable";
  if (check.forbid?.length && ctx.filesChanged.some((f) => matchesAny(f, check.forbid!))) {
    return "violated";
  }
  if (check.allow?.length && !ctx.filesChanged.every((f) => matchesAny(f, check.allow!))) {
    return "violated";
  }
  return "followed";
}

/**
 * A command rule. Not applicable when the adapter reported no commands at all,
 * which means "we cannot see" rather than "the agent ran none".
 */
export function checkCommandUsed(check: Check, ctx: RunContext): Verdict {
  if (ctx.commands.length === 0) return "not-applicable";
  if (check.banned?.length) {
    const hit = ctx.commands.some((c) => check.banned!.some((b) => c.includes(b)));
    if (hit) return "violated";
  }
  if (check.require) {
    return ctx.commands.some((c) => c.includes(check.require!)) ? "followed" : "violated";
  }
  return "followed";
}
```

Add the `Verdict` type to `src/types.ts`:

```typescript
/**
 * How one rule fared in one run. `not-applicable` is a first-class outcome, not
 * a failure: a rule about database migrations says nothing about a task that
 * touched no migrations, and folding it into "followed" would inflate every
 * compliance rate.
 */
export type Verdict = "followed" | "violated" | "not-applicable";

/** One rule's outcome in one run. */
export interface RuleVerdict {
  ruleId: string;
  verdict: Verdict;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/checks.test.ts`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add src/checks.ts src/types.ts test/checks.test.ts
git commit -m "feat(checks): verify touched files and commands run against the rubric"
```

---

### Task 5: Deterministic checks — public API and environment variables

**Files:**
- Modify: `src/checks.ts`
- Test: `test/checks.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/checks.test.ts` (extend the import to include `checkPublicApiPreserved, checkNoNewEnvVars`):

```typescript
describe("checkPublicApiPreserved", () => {
  it("is not-applicable when the diff removes no exports", () => {
    const diff = "+export function added(): void {}\n";
    expect(checkPublicApiPreserved(ctx({ diff }))).toBe("not-applicable");
  });

  it("is violated when an exported signature disappears", () => {
    const diff = "-export function gone(a: string): void {}\n+function gone(a: string): void {}\n";
    expect(checkPublicApiPreserved(ctx({ diff }))).toBe("violated");
  });

  it("is followed when a removed export line is re-added verbatim", () => {
    const diff = "-export function same(a: string): void {}\n+export function same(a: string): void {}\n";
    expect(checkPublicApiPreserved(ctx({ diff }))).toBe("followed");
  });
});

describe("checkNoNewEnvVars", () => {
  it("is not-applicable when the diff reads no environment at all", () => {
    expect(checkNoNewEnvVars(ctx({ diff: "+const x = 1;\n" }))).toBe("not-applicable");
  });

  it("is violated when a new variable name appears", () => {
    const diff = "+const key = process.env.BRAND_NEW_KEY;\n";
    expect(checkNoNewEnvVars(ctx({ diff }))).toBe("violated");
  });

  it("is followed when the only names read were already present", () => {
    const diff = "-const k = process.env.API_KEY;\n+const k = process.env.API_KEY ?? '';\n";
    expect(checkNoNewEnvVars(ctx({ diff }))).toBe("followed");
  });

  it("recognises bracket and import.meta forms", () => {
    const diff = "+const a = process.env['NEW_ONE'];\n+const b = import.meta.env.ALSO_NEW;\n";
    expect(checkNoNewEnvVars(ctx({ diff }))).toBe("violated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/checks.test.ts`
Expected: FAIL — `checkPublicApiPreserved is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/checks.ts`:

```typescript
/** Added and removed lines of a unified diff, without the +++/--- file headers. */
function diffLines(diff: string): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { added, removed };
}

/**
 * Exported-symbol stability, approximated from the diff: a removed `export`
 * line that is not re-added verbatim is treated as a break. This is a text
 * heuristic, not a type-aware analysis — it catches deletions and signature
 * edits, and will miss a break made purely through a re-exported type.
 */
export function checkPublicApiPreserved(ctx: RunContext): Verdict {
  const { added, removed } = diffLines(ctx.diff);
  const removedExports = removed.filter((l) => /^\s*export\b/.test(l));
  if (removedExports.length === 0) return "not-applicable";
  const addedSet = new Set(added.map((l) => l.trim()));
  return removedExports.every((l) => addedSet.has(l.trim())) ? "followed" : "violated";
}

/** Every environment-variable name referenced in a set of lines. */
function envNames(lines: string[]): Set<string> {
  const names = new Set<string>();
  const patterns = [
    /process\.env\.([A-Z_][A-Z0-9_]*)/gi,
    /process\.env\[\s*["'`]([^"'`]+)["'`]\s*\]/gi,
    /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/gi,
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) names.add(match[1]!);
    }
  }
  return names;
}

/**
 * Whether the change invented an environment variable. Names already read in
 * the removed lines are pre-existing; anything else in the added lines is new.
 */
export function checkNoNewEnvVars(ctx: RunContext): Verdict {
  const { added, removed } = diffLines(ctx.diff);
  const introduced = envNames(added);
  if (introduced.size === 0) return "not-applicable";
  const existing = envNames(removed);
  for (const name of introduced) {
    if (!existing.has(name)) return "violated";
  }
  return "followed";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/checks.test.ts`
Expected: PASS, 18 tests

- [ ] **Step 5: Commit**

```bash
git add src/checks.ts test/checks.test.ts
git commit -m "feat(checks): verify public API stability and invented env vars"
```

---

### Task 6: The blind judge

One batched call per run scores every `judge` rule at once — scoring rules one at a time would multiply cost by the rule count. The prompt is built from the task, the diff, the commands, and the rule text, and **never** from the variant: the judge cannot know whether it is looking at a run with or without the instruction file, which is commenter 1's "score the outputs blindly".

**Files:**
- Create: `src/judge.ts`
- Test: `test/judge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/judge.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildJudgePrompt, parseJudgeResponse } from "../src/judge.js";
import type { Rule } from "../src/rubric.js";
import type { RunContext } from "../src/checks.js";

const rules: Rule[] = [
  {
    id: "adapter-registered",
    file: "CLAUDE.md",
    section: "Adapters",
    text: "New adapters must be registered in BUILTIN_ADAPTERS",
    check: { kind: "judge", question: "If an adapter was added, is it registered?" },
  },
];

const ctx: RunContext = {
  filesChanged: ["src/adapters.ts"],
  diff: "+function fooAdapter() {}\n",
  commands: ["npm test"],
  timedOut: false,
};

describe("buildJudgePrompt", () => {
  it("includes the task, diff, commands, and each rule's question", () => {
    const prompt = buildJudgePrompt("add a foo adapter", rules, ctx);
    expect(prompt).toContain("add a foo adapter");
    expect(prompt).toContain("+function fooAdapter() {}");
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("If an adapter was added, is it registered?");
  });

  it("offers not-applicable as an explicit verdict", () => {
    expect(buildJudgePrompt("t", rules, ctx)).toContain("not-applicable");
  });

  it("never reveals which variant produced the run", () => {
    const prompt = buildJudgePrompt("add a foo adapter", rules, ctx).toLowerCase();
    for (const leak of ["baseline", "variant", "current", "claude.md", "instruction file"]) {
      expect(prompt, leak).not.toContain(leak);
    }
  });
});

describe("parseJudgeResponse", () => {
  it("maps verdicts back onto rule ids", () => {
    const reply = '```json\n[{"id":"adapter-registered","verdict":"violated"}]\n```';
    expect(parseJudgeResponse(reply, rules)).toEqual([
      { ruleId: "adapter-registered", verdict: "violated" },
    ]);
  });

  it("falls back to not-applicable for rules the judge omitted", () => {
    expect(parseJudgeResponse("[]", rules)).toEqual([
      { ruleId: "adapter-registered", verdict: "not-applicable" },
    ]);
  });

  it("falls back to not-applicable when the reply is unparseable", () => {
    expect(parseJudgeResponse("the model refused", rules)).toEqual([
      { ruleId: "adapter-registered", verdict: "not-applicable" },
    ]);
  });

  it("ignores verdicts for ids that are not in the rubric", () => {
    const reply = '[{"id":"ghost","verdict":"violated"},{"id":"adapter-registered","verdict":"followed"}]';
    expect(parseJudgeResponse(reply, rules)).toEqual([
      { ruleId: "adapter-registered", verdict: "followed" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/judge.test.ts`
Expected: FAIL — `Failed to resolve import "../src/judge.js"`

- [ ] **Step 3: Write the implementation**

Create `src/judge.ts`:

```typescript
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
/** Cap the diff so a huge change cannot blow the judge's context. */
const MAX_DIFF_CHARS = 20_000;

/**
 * Build the scoring prompt. It deliberately contains no hint of which variant
 * produced this run — no variant name, no mention of an instruction file — so
 * the judge cannot favour the condition it expects to win.
 */
export function buildJudgePrompt(taskPrompt: string, rules: Rule[], ctx: RunContext): string {
  const diff = ctx.diff.length > MAX_DIFF_CHARS
    ? `${ctx.diff.slice(0, MAX_DIFF_CHARS)}\n… diff truncated …`
    : ctx.diff;
  const questions = rules
    .map((r) => `- id: ${r.id}\n  question: ${r.check.question ?? r.text}`)
    .join("\n");

  return `A developer was asked to make a change to a repository. Judge the result against
each question below.

Answer each question with exactly one verdict:
- followed: the change satisfies the question.
- violated: the change contradicts it.
- not-applicable: the change never encountered the situation the question describes.
Use not-applicable freely. It is the correct answer whenever the question is about a
situation this change did not involve, and it is not a criticism.

Task given to the developer:
${taskPrompt}

Commands they ran:
${ctx.commands.length ? ctx.commands.map((c) => `  $ ${c}`).join("\n") : "  (none recorded)"}

Diff of their change:
${diff || "(no changes)"}

Questions:
${questions}

Reply with JSON only: [{"id":"<id>","verdict":"followed|violated|not-applicable"}]`;
}

/** Map the judge's reply back onto rule ids, defaulting anything missing. */
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
          const e = entry as { id?: unknown; verdict?: unknown };
          if (typeof e.id !== "string" || typeof e.verdict !== "string") continue;
          if (VERDICTS.includes(e.verdict as Verdict)) byId.set(e.id, e.verdict as Verdict);
        }
      }
    } catch {
      // Unparseable reply: every rule falls back to not-applicable below.
    }
  }
  // A judge that failed to answer must not be counted as a violation.
  return rules.map((r) => ({ ruleId: r.id, verdict: byId.get(r.id) ?? "not-applicable" }));
}

/**
 * Score every judge-kind rule for one run in a single call, in an empty scratch
 * directory so the judge works from the prompt alone and cannot browse the repo.
 */
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
    return rules.map((r) => ({ ruleId: r.id, verdict: "not-applicable" as const }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/judge.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/judge.ts test/judge.test.ts
git commit -m "feat(judge): score judge-kind rules blind, batched one call per run"
```

---

### Task 7: Evaluate every rule for a run, and classify failures

Commenter 2 asked for failures to be classified *before* anything is compared. The categories are derived deterministically from data already collected, so no extra LLM call is needed.

**Files:**
- Create: `src/evaluate.ts`
- Modify: `src/types.ts`
- Test: `test/evaluate.test.ts`

- [ ] **Step 1: Add the types**

Append to `src/types.ts`:

```typescript
/**
 * Why a run failed. Derived from the diff and verdicts, so failures are never
 * lumped together: "the agent ignored a rule" and "the agent wrote wrong code"
 * are different problems with different fixes.
 */
export type FailureCategory = "timed-out" | "no-op" | "ignored-instructions" | "wrong-code";
```

Extend the `RunResult` interface with:

```typescript
  /** Per-rule outcomes for this run. Empty when no rubric exists. */
  verdicts: RuleVerdict[];
  /** Lines added plus deleted. */
  churn: number;
  /** Total tool invocations, when the adapter reports them. */
  toolCalls?: number;
  /** Set only when the run failed its success check. */
  failure?: FailureCategory;
```

- [ ] **Step 2: Write the failing test**

Create `test/evaluate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { evaluateDeterministic, classifyFailure } from "../src/evaluate.js";
import type { Rule } from "../src/rubric.js";
import type { RunContext } from "../src/checks.js";

function ctx(overrides: Partial<RunContext> = {}): RunContext {
  return { filesChanged: [], diff: "", commands: [], timedOut: false, ...overrides };
}

const rules: Rule[] = [
  { id: "no-dist", file: "f", section: "Layout", text: "never edit dist", check: { kind: "files-touched", forbid: ["dist/**"] } },
  { id: "npm-test", file: "f", section: "Testing", text: "use npm test", check: { kind: "command-used", require: "npm test" } },
  { id: "thinky", file: "f", section: "Style", text: "be idiomatic", check: { kind: "judge", question: "idiomatic?" } },
];

describe("evaluateDeterministic", () => {
  it("scores every non-judge rule and skips judge rules", () => {
    const verdicts = evaluateDeterministic(rules, ctx({ filesChanged: ["dist/x.js"], commands: ["npm test"] }));
    expect(verdicts).toEqual([
      { ruleId: "no-dist", verdict: "violated" },
      { ruleId: "npm-test", verdict: "followed" },
    ]);
  });

  it("returns nothing when the rubric is empty", () => {
    expect(evaluateDeterministic([], ctx())).toEqual([]);
  });
});

describe("classifyFailure", () => {
  it("returns undefined for a passing run", () => {
    expect(classifyFailure(true, ctx({ filesChanged: ["a.ts"] }), [])).toBeUndefined();
  });

  it("reports a timeout ahead of anything else", () => {
    const c = ctx({ timedOut: true, filesChanged: [] });
    expect(classifyFailure(false, c, [{ ruleId: "no-dist", verdict: "violated" }])).toBe("timed-out");
  });

  it("reports a no-op when the agent changed nothing", () => {
    expect(classifyFailure(false, ctx(), [])).toBe("no-op");
  });

  it("reports ignored instructions when a rule was violated", () => {
    const c = ctx({ filesChanged: ["a.ts"] });
    expect(classifyFailure(false, c, [{ ruleId: "no-dist", verdict: "violated" }])).toBe(
      "ignored-instructions",
    );
  });

  it("reports wrong code when work was done and no rule was broken", () => {
    const c = ctx({ filesChanged: ["a.ts"] });
    expect(classifyFailure(false, c, [{ ruleId: "no-dist", verdict: "followed" }])).toBe("wrong-code");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/evaluate.test.ts`
Expected: FAIL — `Failed to resolve import "../src/evaluate.js"`

- [ ] **Step 4: Write the implementation**

Create `src/evaluate.ts`:

```typescript
import type { Rule } from "./rubric.js";
import type { RunContext } from "./checks.js";
import type { RuleVerdict, FailureCategory } from "./types.js";
import {
  checkFilesTouched,
  checkCommandUsed,
  checkPublicApiPreserved,
  checkNoNewEnvVars,
} from "./checks.js";

/** Score every rule that can be checked without an LLM. Judge rules are skipped. */
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
        break; // scored separately, in one batched call
    }
  }
  return verdicts;
}

/**
 * Why a failing run failed. Ordered most-specific first: a timeout explains
 * everything after it, a no-op means the agent never engaged, a rule violation
 * points at the instructions, and anything left is ordinary wrong code.
 */
export function classifyFailure(
  passed: boolean,
  ctx: RunContext,
  verdicts: RuleVerdict[],
): FailureCategory | undefined {
  if (passed) return undefined;
  if (ctx.timedOut) return "timed-out";
  if (ctx.filesChanged.length === 0) return "no-op";
  if (verdicts.some((v) => v.verdict === "violated")) return "ignored-instructions";
  return "wrong-code";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/evaluate.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 6: Wire it into the runner**

In `src/runner.ts`, extend the imports:

```typescript
import { changedFiles, unifiedDiff, churnLines } from "./git.js";
import type { Rule } from "./rubric.js";
import type { RunContext } from "./checks.js";
import { evaluateDeterministic, classifyFailure } from "./evaluate.js";
import { judgeRun } from "./judge.js";
```

Add `rules: Rule[]` as a parameter to `runTask` and `runAll` (after `variants`), then replace the block between the agent call and the `RunResult` construction:

```typescript
        const changed = (await changedFiles(path)).filter(
          (f) => !adapter.instructionFiles.includes(f),
        );
        const ctx: RunContext = {
          filesChanged: changed,
          diff: await unifiedDiff(path),
          commands: adapter.parseCommands?.(agent.stdout) ?? [],
          timedOut: agent.timedOut,
        };
        const churn = await churnLines(path);
        const verdicts = evaluateDeterministic(rules, ctx);
        const judged = await judgeRun(
          adapter,
          task.prompt,
          rules.filter((r) => r.check.kind === "judge"),
          ctx,
        );
        const allVerdicts = [...verdicts, ...judged];

        applyTestPatch(path, task.testFiles);
        const check = await runShell(task.successCommand, path, SUCCESS_TIMEOUT_MS);
        const passed = check.exitCode === 0;
        const result: RunResult = {
          taskId: task.id,
          variant: variant.id,
          rep,
          passed,
          durationMs: agent.durationMs,
          tokens: adapter.parseTokenUsage(agent.stdout),
          filesChanged: changed,
          filesRead: adapter.parseFilesRead?.(agent.stdout),
          verdicts: allVerdicts,
          churn,
          toolCalls: adapter.parseToolCalls?.(agent.stdout),
          failure: classifyFailure(passed, ctx, allVerdicts),
        };
```

In `src/commands/run.ts`, load the rubric and pass its rules through:

```typescript
import { loadRubric, RUBRIC_FILENAME } from "../rubric.js";
```

after the adapter is resolved:

```typescript
  const rubric = loadRubric(repoDir);
  if (!rubric) {
    console.log(
      `No ${RUBRIC_FILENAME} found — running without compliance scoring. ` +
        `Run \`optirule lint\` first to measure whether your rules are actually followed.`,
    );
  }
  const rules = rubric?.rules ?? [];
```

and pass `rules` to `runAll(...)`.

- [ ] **Step 7: Verify the whole suite**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/evaluate.ts src/types.ts src/runner.ts src/commands/run.ts test/evaluate.test.ts
git commit -m "feat: score rules and classify failures on every run"
```

---

### Task 8: Paired statistics with confidence intervals

Commenter 3's concern — "enough runs that a difference is signal and not one lucky trajectory" — is answered by pairing per task (which removes task-difficulty variance for free) and reporting an interval instead of a point estimate.

**Files:**
- Create: `src/stats.ts`
- Test: `test/stats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/stats.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mean, bootstrapCI } from "../src/stats.js";

describe("mean", () => {
  it("averages values", () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it("returns 0 for an empty sample rather than NaN", () => {
    expect(mean([])).toBe(0);
  });
});

describe("bootstrapCI", () => {
  it("brackets the sample mean", () => {
    const values = [2, 3, 4, 3, 2, 4, 3, 3];
    const [low, high] = bootstrapCI(values);
    expect(low).toBeLessThanOrEqual(mean(values));
    expect(high).toBeGreaterThanOrEqual(mean(values));
  });

  it("is deterministic across calls, so reports are reproducible", () => {
    const values = [1, 5, 2, 8, 3];
    expect(bootstrapCI(values)).toEqual(bootstrapCI(values));
  });

  it("returns a zero-width interval for a constant sample", () => {
    expect(bootstrapCI([4, 4, 4, 4])).toEqual([4, 4]);
  });

  it("spans zero for a sample centred on zero, so no effect is claimed", () => {
    const [low, high] = bootstrapCI([-3, 3, -2, 2, -1, 1, 0, 0]);
    expect(low).toBeLessThan(0);
    expect(high).toBeGreaterThan(0);
  });

  it("returns [0, 0] for an empty sample", () => {
    expect(bootstrapCI([])).toEqual([0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/stats.test.ts`
Expected: FAIL — `Failed to resolve import "../src/stats.js"`

- [ ] **Step 3: Write the implementation**

Create `src/stats.ts`:

```typescript
/** Arithmetic mean; 0 for an empty sample so callers never see NaN. */
export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * A seeded linear congruential generator. The bootstrap must be reproducible:
 * two people reading the same report should see the same interval.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Percentile bootstrap confidence interval for the mean of `values`, which
 * should be **paired per-task deltas** rather than raw measurements. An interval
 * spanning zero means the run cannot distinguish the effect from noise — that is
 * the honest answer, and it is what stops a section being cut on one lucky
 * trajectory.
 */
export function bootstrapCI(
  values: number[],
  iterations = 1000,
  alpha = 0.05,
): [number, number] {
  if (values.length === 0) return [0, 0];
  const random = seededRandom(20260721);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) {
      sum += values[Math.floor(random() * values.length)]!;
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const low = means[Math.floor((alpha / 2) * iterations)]!;
  const high = means[Math.min(iterations - 1, Math.ceil((1 - alpha / 2) * iterations))]!;
  return [low, high];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/stats.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/stats.ts test/stats.test.ts
git commit -m "feat(stats): add paired-delta bootstrap confidence intervals"
```

---

### Task 9: Mistakes avoided becomes the headline

**Files:**
- Modify: `src/analyze.ts`
- Test: `test/analyze.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/analyze.test.ts`:

```typescript
import { analyzeCompliance } from "../src/analyze.js";
import type { RunResult } from "../src/types.js";
import type { Rule } from "../src/rubric.js";

const rules: Rule[] = [
  { id: "no-dist", file: "CLAUDE.md", section: "Layout", text: "never edit dist", check: { kind: "files-touched", forbid: ["dist/**"] } },
  { id: "guardrail", file: "CLAUDE.md", section: "Secrets", text: "never commit secrets", check: { kind: "judge", question: "secrets?" } },
];

function run(
  taskId: string,
  variant: string,
  verdicts: RunResult["verdicts"],
): RunResult {
  return {
    taskId, variant, rep: 0, passed: true, durationMs: 1000,
    filesChanged: ["a.ts"], verdicts, churn: 10,
  };
}

describe("analyzeCompliance", () => {
  it("counts mistakes avoided as baseline violations minus current violations", () => {
    const results = [
      run("t1", "baseline", [{ ruleId: "no-dist", verdict: "violated" }]),
      run("t1", "current", [{ ruleId: "no-dist", verdict: "followed" }]),
      run("t2", "baseline", [{ ruleId: "no-dist", verdict: "violated" }]),
      run("t2", "current", [{ ruleId: "no-dist", verdict: "followed" }]),
    ];
    const analysis = analyzeCompliance(results, rules);
    expect(analysis.mistakesAvoided).toBe(2);
    const layout = analysis.sections.find((s) => s.title === "Layout")!;
    expect(layout.tasksImproved).toBe(2);
    expect(layout.signal).toBe("earns-its-keep");
  });

  it("marks a section that only helped on one task as single-task-signal", () => {
    const results = [
      run("t1", "baseline", [{ ruleId: "no-dist", verdict: "violated" }]),
      run("t1", "current", [{ ruleId: "no-dist", verdict: "followed" }]),
      run("t2", "baseline", [{ ruleId: "no-dist", verdict: "followed" }]),
      run("t2", "current", [{ ruleId: "no-dist", verdict: "followed" }]),
    ];
    const layout = analyzeCompliance(results, rules).sections.find((s) => s.title === "Layout")!;
    expect(layout.tasksImproved).toBe(1);
    expect(layout.signal).toBe("single-task-signal");
  });

  it("marks a section the agent obeyed anyway as redundant", () => {
    const results = [
      run("t1", "baseline", [{ ruleId: "no-dist", verdict: "followed" }]),
      run("t1", "current", [{ ruleId: "no-dist", verdict: "followed" }]),
      run("t2", "baseline", [{ ruleId: "no-dist", verdict: "followed" }]),
      run("t2", "current", [{ ruleId: "no-dist", verdict: "followed" }]),
    ];
    const layout = analyzeCompliance(results, rules).sections.find((s) => s.title === "Layout")!;
    expect(layout.signal).toBe("redundant");
  });

  it("marks a never-applicable guardrail as never-exercised, not redundant", () => {
    const results = [
      run("t1", "baseline", [{ ruleId: "guardrail", verdict: "not-applicable" }]),
      run("t1", "current", [{ ruleId: "guardrail", verdict: "not-applicable" }]),
    ];
    const secrets = analyzeCompliance(results, rules).sections.find((s) => s.title === "Secrets")!;
    expect(secrets.signal).toBe("never-exercised");
  });

  it("flags a section that made compliance worse as harmful", () => {
    const results = [
      run("t1", "baseline", [{ ruleId: "no-dist", verdict: "followed" }]),
      run("t1", "current", [{ ruleId: "no-dist", verdict: "violated" }]),
      run("t2", "baseline", [{ ruleId: "no-dist", verdict: "followed" }]),
      run("t2", "current", [{ ruleId: "no-dist", verdict: "violated" }]),
    ];
    const layout = analyzeCompliance(results, rules).sections.find((s) => s.title === "Layout")!;
    expect(layout.signal).toBe("harmful");
  });

  it("summarises failure categories per variant", () => {
    const results = [
      { ...run("t1", "baseline", []), passed: false, failure: "no-op" as const },
      { ...run("t1", "current", []), passed: false, failure: "wrong-code" as const },
    ];
    const analysis = analyzeCompliance(results, rules);
    expect(analysis.failures.baseline["no-op"]).toBe(1);
    expect(analysis.failures.current["wrong-code"]).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/analyze.test.ts`
Expected: FAIL — `analyzeCompliance is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/analyze.ts`:

```typescript
import type { Rule } from "./rubric.js";
import type { FailureCategory, RunResult } from "./types.js";
import { bootstrapCI, mean } from "./stats.js";

/**
 * What a section did to the agent's behaviour. Deliberately not a single
 * number: a section can be load-bearing, redundant, unproven, untested, or
 * counterproductive, and collapsing those into one score is how guardrails get
 * deleted.
 */
export type SectionSignal =
  | "earns-its-keep"
  | "single-task-signal"
  | "redundant"
  | "never-exercised"
  | "harmful";

export interface SectionCompliance {
  file: string;
  title: string;
  /** baseline violations − current violations, summed over runs. */
  mistakesAvoided: number;
  /** Distinct tasks where `current` violated fewer rules than `baseline`. */
  tasksImproved: number;
  /** Runs where at least one of the section's rules applied. */
  applicableRuns: number;
  signal: SectionSignal;
}

export interface ComplianceAnalysis {
  /** Total violations prevented by the instruction file. The headline number. */
  mistakesAvoided: number;
  /** 95% interval on the per-task mistakes-avoided delta. Spans 0 = no signal. */
  mistakesAvoidedCI: [number, number];
  sections: SectionCompliance[];
  failures: Record<string, Partial<Record<FailureCategory, number>>>;
}

/**
 * A section must change behaviour on at least this many distinct tasks before
 * it is called load-bearing. One task is a coincidence: the same rule that
 * looks decisive on a single task is usually the agent's own default elsewhere.
 */
const MIN_TASKS_IMPROVED = 2;

function violationsIn(result: RunResult, ruleIds: Set<string>): number {
  return result.verdicts.filter((v) => ruleIds.has(v.ruleId) && v.verdict === "violated").length;
}

function applicableIn(result: RunResult, ruleIds: Set<string>): boolean {
  return result.verdicts.some((v) => ruleIds.has(v.ruleId) && v.verdict !== "not-applicable");
}

function classifySection(
  mistakesAvoided: number,
  tasksImproved: number,
  applicableRuns: number,
): SectionSignal {
  // Never-exercised outranks everything: we learned nothing about this section,
  // which is not the same as learning it does nothing.
  if (applicableRuns === 0) return "never-exercised";
  if (mistakesAvoided < 0) return "harmful";
  if (mistakesAvoided === 0) return "redundant";
  return tasksImproved >= MIN_TASKS_IMPROVED ? "earns-its-keep" : "single-task-signal";
}

/** Compare `baseline` and `current` on rule compliance, per section and overall. */
export function analyzeCompliance(results: RunResult[], rules: Rule[]): ComplianceAnalysis {
  const allIds = new Set(rules.map((r) => r.id));
  const tasks = [...new Set(results.map((r) => r.taskId))];
  const forVariant = (variant: string) => results.filter((r) => r.variant === variant);

  // Group rules by the section they came from.
  const sectionRules = new Map<string, { file: string; title: string; ids: Set<string> }>();
  for (const rule of rules) {
    const key = `${rule.file}::${rule.section}`;
    if (!sectionRules.has(key)) {
      sectionRules.set(key, { file: rule.file, title: rule.section, ids: new Set() });
    }
    sectionRules.get(key)!.ids.add(rule.id);
  }

  const perTaskDelta = tasks.map((taskId) => {
    const base = forVariant("baseline").filter((r) => r.taskId === taskId);
    const curr = forVariant("current").filter((r) => r.taskId === taskId);
    return mean(base.map((r) => violationsIn(r, allIds))) -
      mean(curr.map((r) => violationsIn(r, allIds)));
  });

  const sections: SectionCompliance[] = [];
  for (const { file, title, ids } of sectionRules.values()) {
    let mistakesAvoided = 0;
    let tasksImproved = 0;
    let applicableRuns = 0;
    for (const taskId of tasks) {
      const base = forVariant("baseline").filter((r) => r.taskId === taskId);
      const curr = forVariant("current").filter((r) => r.taskId === taskId);
      const baseViolations = base.reduce((sum, r) => sum + violationsIn(r, ids), 0);
      const currViolations = curr.reduce((sum, r) => sum + violationsIn(r, ids), 0);
      mistakesAvoided += baseViolations - currViolations;
      if (baseViolations > currViolations) tasksImproved++;
      applicableRuns += [...base, ...curr].filter((r) => applicableIn(r, ids)).length;
    }
    sections.push({
      file,
      title,
      mistakesAvoided,
      tasksImproved,
      applicableRuns,
      signal: classifySection(mistakesAvoided, tasksImproved, applicableRuns),
    });
  }

  const failures: ComplianceAnalysis["failures"] = {};
  for (const result of results) {
    if (!result.failure) continue;
    failures[result.variant] ??= {};
    failures[result.variant]![result.failure] =
      (failures[result.variant]![result.failure] ?? 0) + 1;
  }

  return {
    mistakesAvoided: sections.reduce((sum, s) => sum + s.mistakesAvoided, 0),
    mistakesAvoidedCI: bootstrapCI(perTaskDelta),
    sections,
    failures,
  };
}
```

Add the field to the `Analysis` interface (after `taskCount`):

```typescript
  /** Rule-following comparison between baseline and current. The headline. */
  compliance: ComplianceAnalysis;
```

Change the `analyze()` signature and its return object — the new `rules` parameter goes last so existing callers keep working:

```typescript
export function analyze(
  results: RunResult[],
  sections: Section[],
  taskCount: number,
  ablated?: VariantSpec[],
  rules: Rule[] = [],
): Analysis {
```

and inside the returned object, replace the `recommendation` line with:

```typescript
    compliance,
    recommendation: recommend(baseline, current, tokenDeltaPct, totalInstructionTokens, impacts, compliance),
```

computing `compliance` just above the `return`:

```typescript
  const compliance = analyzeCompliance(results, rules);
```

Update the call site in `src/commands/run.ts` to pass `rules` through as the fifth argument.

Finally, make `recommend()` lead with compliance rather than tokens. Add `compliance: ComplianceAnalysis` as its last parameter, and insert this at the top of its body, before the existing `tokenDeltaPct` branch:

```typescript
  const { mistakesAvoided, mistakesAvoidedCI } = compliance;
  if (compliance.sections.length === 0) {
    lines.push(`No rubric — nothing measured about rule-following. Run \`optirule lint\`.`);
  } else if (mistakesAvoidedCI[0] > 0) {
    lines.push(
      `Your instructions prevented ${mistakesAvoided} rule violation(s) that the agent made without them ` +
        `(95% CI ${mistakesAvoidedCI[0].toFixed(1)} to ${mistakesAvoidedCI[1].toFixed(1)} per task).`,
    );
  } else {
    lines.push(
      `No measurable reduction in rule violations (95% CI ${mistakesAvoidedCI[0].toFixed(1)} to ` +
        `${mistakesAvoidedCI[1].toFixed(1)} per task spans zero). Either the agent follows these rules ` +
        `anyway, or the run is too small to tell — add tasks before trimming anything.`,
    );
  }
```

`recommend()` needs `compliance` passed in; add it as a parameter and update the call site in `analyze()`. Keep the existing token lines, but reword the leading token sentence to `Token cost: …` so it reads as a cost note rather than a verdict.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/analyze.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyze.ts test/analyze.test.ts
git commit -m "feat(analyze): make mistakes avoided the headline metric"
```

---

### Task 10: Protect guardrails in `export --minimal`

The current implementation drops any section whose removal did not cost tokens — which deletes "never commit secrets" on its first run. This task makes dropping conditional on evidence of redundancy, and makes absence of evidence non-droppable.

**Files:**
- Modify: `src/commands/export.ts`
- Test: `test/export.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/export.test.ts`:

```typescript
import { isDroppable } from "../src/commands/export.js";

describe("isDroppable", () => {
  it("drops only sections the agent demonstrably obeyed anyway", () => {
    expect(isDroppable("redundant")).toBe(true);
  });

  it("never drops a guardrail that was never exercised", () => {
    expect(isDroppable("never-exercised")).toBe(false);
  });

  it("never drops a section on a single task's evidence", () => {
    expect(isDroppable("single-task-signal")).toBe(false);
  });

  it("keeps load-bearing sections", () => {
    expect(isDroppable("earns-its-keep")).toBe(false);
  });

  it("drops a section that made compliance worse", () => {
    expect(isDroppable("harmful")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/export.test.ts`
Expected: FAIL — `isDroppable` is not exported (it is currently module-private and typed on `SectionImpact["signal"]`).

- [ ] **Step 3: Write the implementation**

In `src/commands/export.ts`, replace the private `isDroppable` with an exported version keyed on the compliance signal:

```typescript
import type { SectionSignal } from "../analyze.js";

/**
 * Which sections a minimal export may remove. Only two qualify: one the agent
 * obeyed just as well without, and one that made compliance worse.
 *
 * `never-exercised` is deliberately kept. A rule that never came up in the
 * benchmark is unproven, not useless — "never commit secrets" earns nothing on
 * a set of ordinary tasks and matters enormously on the one risky change that
 * is not in it. `single-task-signal` is kept for the mirror-image reason: one
 * task is not enough evidence to act on in either direction.
 */
export function isDroppable(signal: SectionSignal): boolean {
  return signal === "redundant" || signal === "harmful";
}
```

Change `runExport` to read `analysis.compliance.sections` instead of `analysis.sectionImpacts`, and update its guard:

```typescript
  const analysis = readAnalysis(repoDir);
  if (!analysis?.compliance?.sections.length) {
    throw new Error(
      "No compliance data found. Run `optirule lint` then `optirule run` first.",
    );
  }

  const config = loadConfig(repoDir);
  const dropByFile = new Map<string, Set<string>>();
  for (const section of analysis.compliance.sections) {
    if (!isDroppable(section.signal)) continue;
    if (!dropByFile.has(section.file)) dropByFile.set(section.file, new Set());
    dropByFile.get(section.file)!.add(section.title);
  }
```

Update the caveat text:

```typescript
const CAVEAT =
  "validated only against your optirule task set. Sections kept as never-exercised or " +
  "single-task-signal were not proven useless — they were never put to the test.";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/export.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/export.ts test/export.test.ts
git commit -m "fix(export): stop dropping guardrails the benchmark never exercised"
```

---

### Task 11: The two-axis report

Commenter 5's decomposition — "is the instruction followed" versus "is the instruction even a good idea" — becomes the report's structure. They are never collapsed into one score.

**Files:**
- Modify: `src/report.ts`
- Test: `test/report.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/report.test.ts`:

```typescript
import { renderCompliance, costPerSuccess } from "../src/report.js";
import type { ComplianceAnalysis } from "../src/analyze.js";

const compliance: ComplianceAnalysis = {
  mistakesAvoided: 4,
  mistakesAvoidedCI: [1.2, 3.4],
  sections: [
    { file: "CLAUDE.md", title: "Layout", mistakesAvoided: 4, tasksImproved: 3, applicableRuns: 12, signal: "earns-its-keep" },
    { file: "CLAUDE.md", title: "Secrets", mistakesAvoided: 0, tasksImproved: 0, applicableRuns: 0, signal: "never-exercised" },
  ],
  failures: { baseline: { "no-op": 2 }, current: { "wrong-code": 1 } },
};

describe("renderCompliance", () => {
  it("shows the headline with its confidence interval", () => {
    const html = renderCompliance(compliance);
    expect(html).toContain("4");
    expect(html).toContain("1.2");
    expect(html).toContain("3.4");
  });

  it("labels a never-exercised section as unproven rather than useless", () => {
    expect(renderCompliance(compliance).toLowerCase()).toContain("never exercised");
  });

  it("breaks failures down by category and variant", () => {
    const html = renderCompliance(compliance);
    expect(html).toContain("no-op");
    expect(html).toContain("wrong-code");
  });
});

describe("costPerSuccess", () => {
  it("divides total tokens by passing runs", () => {
    expect(costPerSuccess(10_000, 4)).toBe(2500);
  });

  it("is undefined when nothing passed, rather than Infinity", () => {
    expect(costPerSuccess(10_000, 0)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/report.test.ts`
Expected: FAIL — `renderCompliance is not a function`

- [ ] **Step 3: Write the implementation**

Add to `src/report.ts`:

```typescript
import type { ComplianceAnalysis, SectionSignal } from "./analyze.js";

const COMPLIANCE_LABELS: Record<SectionSignal, string> = {
  "earns-its-keep": "Earns its keep",
  "single-task-signal": "One task only — not enough evidence",
  redundant: "Redundant — the agent complied anyway",
  "never-exercised": "Never exercised — unproven, not useless",
  harmful: "Harmful — compliance got worse",
};

/** Tokens spent per passing run, or undefined when nothing passed. */
export function costPerSuccess(totalTokens: number, passes: number): number | undefined {
  return passes > 0 ? totalTokens / passes : undefined;
}

/**
 * The compliance half of the report: did the agent follow the rules, and which
 * sections made that happen. Kept separate from the task-outcome half — whether
 * a rule was followed and whether the rule was a good idea are different
 * questions, and one cannot substitute for the other.
 */
export function renderCompliance(compliance: ComplianceAnalysis): string {
  const [low, high] = compliance.mistakesAvoidedCI;
  const rows = compliance.sections
    .map(
      (s) => `<tr>
      <td>${esc(s.title)}</td>
      <td>${s.mistakesAvoided}</td>
      <td>${s.tasksImproved}</td>
      <td>${s.applicableRuns}</td>
      <td>${COMPLIANCE_LABELS[s.signal]}</td>
    </tr>`,
    )
    .join("");

  const failureRows = Object.entries(compliance.failures)
    .flatMap(([variant, categories]) =>
      Object.entries(categories).map(
        ([category, count]) =>
          `<tr><td>${esc(variant)}</td><td>${esc(category)}</td><td>${count}</td></tr>`,
      ),
    )
    .join("");

  return `<section>
    <h2>Mistakes avoided</h2>
    <p class="headline">${compliance.mistakesAvoided}
      <span class="muted">rule violations prevented (95% CI ${low.toFixed(1)} to ${high.toFixed(1)} per task)</span></p>
    <table>
      <thead><tr><th>Section</th><th>Mistakes avoided</th><th>Tasks improved</th><th>Applicable runs</th><th>Verdict</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2>Failures by category</h2>
    <table>
      <thead><tr><th>Variant</th><th>Category</th><th>Runs</th></tr></thead>
      <tbody>${failureRows || `<tr><td colspan="3" class="muted">No failures.</td></tr>`}</tbody>
    </table>
  </section>`;
}
```

Then in the main `writeReport` template, place `renderCompliance(analysis.compliance)` **above** the existing variant summary table, and retitle that table "Cost and outcome" so tokens read as a price rather than a verdict.

Add a cost-per-success cell to `summaryRow`, and note the parentheses — `s.avgTokens ?? 0 * s.runs` would parse as `s.avgTokens ?? (0 * s.runs)` and silently produce nonsense:

```typescript
function summaryRow(s: VariantSummary): string {
  const tokens = s.avgTokens === undefined ? "—" : Math.round(s.avgTokens).toLocaleString();
  const filesRead = s.avgFilesRead === undefined ? "—" : s.avgFilesRead.toFixed(1);
  const perSuccess = costPerSuccess((s.avgTokens ?? 0) * s.runs, s.passed);
  const cost = perSuccess === undefined ? "—" : Math.round(perSuccess).toLocaleString();
  return `<tr>
    <td>${s.variant}</td>
    <td>${pct(s.passRate)} <span class="muted">(${s.passed}/${s.runs})</span></td>
    <td>${tokens}</td>
    <td>${cost}</td>
    <td>${(s.avgDurationMs / 1000).toFixed(1)}s</td>
    <td>${s.avgFilesChanged.toFixed(1)}</td>
    <td>${filesRead}</td>
  </tr>`;
}
```

Add a matching `<th>Tokens / success</th>` to that table's header row.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/report.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/report.ts test/report.test.ts
git commit -m "feat(report): lead with mistakes avoided and split cost from compliance"
```

---

### Task 12: Wider not deeper, and context units beyond sections

Commenter 5's "go wider not deeper" becomes the defaults. Commenter 4's "every piece of context is an experiment" becomes file-level ablation — the cheap generalisation, not the platform.

**Files:**
- Modify: `src/config.ts`, `src/estimate.ts`, `src/variants.ts`, `src/cli.ts`, `README.md`
- Test: `test/estimate.test.ts`, `test/variants.test.ts`

- [ ] **Step 1: Change the defaults**

In `src/config.ts`, update `DEFAULTS`:

```typescript
const DEFAULTS = {
  agent: "claude",
  test_command: "npm test",
  // Wider beats deeper: task-to-task variance dominates run-to-run variance, and
  // more tasks also buys generalisation that more reps of the same task cannot.
  max_tasks: 15,
  reps: 3,
} as const;
```

- [ ] **Step 2: Write the failing test for the power warning**

Append to `test/estimate.test.ts`:

```typescript
import { powerWarning } from "../src/estimate.js";

describe("powerWarning", () => {
  it("warns when there are too few tasks for the two-task keep rule", () => {
    expect(powerWarning(3)).toMatch(/two-task/i);
  });

  it("stays quiet with a healthy task count", () => {
    expect(powerWarning(15)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/estimate.test.ts`
Expected: FAIL — `powerWarning is not a function`

- [ ] **Step 4: Write the implementation**

Append to `src/estimate.ts`:

```typescript
/** Below this many tasks, "improved on ≥2 tasks" is satisfied by coincidence too easily. */
const MIN_HEALTHY_TASKS = 8;

/**
 * Warn before spending money when the task set is too small for its own keep
 * rule. A section must help on two distinct tasks to count as load-bearing; with
 * only a handful of tasks that threshold is a coin flip, not evidence.
 */
export function powerWarning(taskCount: number): string | undefined {
  if (taskCount >= MIN_HEALTHY_TASKS) return undefined;
  return (
    `Only ${taskCount} task(s). The two-task rule that decides whether a section earns its ` +
    `keep needs a wider set to mean anything — add tasks to optirule.yml, or raise max_tasks, ` +
    `before trusting any keep/drop verdict.`
  );
}
```

Print it in `src/commands/run.ts`, right after the plan is shown:

```typescript
  const warning = powerWarning(tasks.length);
  if (warning) console.log(`\n⚠ ${warning}`);
```

- [ ] **Step 5: Add file-level context units**

In `src/variants.ts`, extend the spec so a whole instruction file can be a unit:

```typescript
export type VariantSpec =
  | { id: "baseline"; kind: "baseline" }
  | { id: "current"; kind: "current" }
  | { id: string; kind: "ablate"; section: ParsedSection }
  | { id: string; kind: "ablate-file"; file: string };

/**
 * Append one variant per instruction file, each run with that whole file
 * removed. Answers "does this file earn its place" for repos carrying several —
 * CLAUDE.md next to AGENTS.md next to a coding-standards doc.
 */
export function planFileVariants(files: string[]): VariantSpec[] {
  return files.map((file) => ({ id: `ablate-file-${slugify(file)}`, kind: "ablate-file", file }));
}
```

In `src/runner.ts`, handle the new kind in `applyVariant` — add before the `contents.get` lookup:

```typescript
    if (variant.kind === "ablate-file" && variant.file === file) {
      if (existsSync(dest)) rmSync(dest);
      continue;
    }
```

In `src/cli.ts`, add the flag to the `run` command:

```typescript
  .option("--ablate-files", "also measure each whole instruction file's impact")
```

In `src/commands/run.ts`, add `ablateFiles?: boolean` to `RunOptions`, import `planFileVariants`, and append the file variants after the section variants:

```typescript
  const variants = planVariants(sections, ablate);
  if (options.ablateFiles) variants.push(...planFileVariants(config.instruction_files));
```

Commander maps `--ablate-files` to the `ablateFiles` property automatically, so no manual mapping is needed.

- [ ] **Step 6: Add the variants test**

Append to `test/variants.test.ts`:

```typescript
import { planFileVariants } from "../src/variants.js";

describe("planFileVariants", () => {
  it("makes one ablation variant per instruction file", () => {
    const variants = planFileVariants(["CLAUDE.md", ".claude/rules.md"]);
    expect(variants.map((v) => v.id)).toEqual([
      "ablate-file-claude-md",
      "ablate-file-claude-rules-md",
    ]);
    expect(variants.every((v) => v.kind === "ablate-file")).toBe(true);
  });
});
```

- [ ] **Step 7: Verify everything**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass.

- [ ] **Step 8: Update the README**

Replace the "Per-section impact" section with a description of the new flow — `optirule lint` first, rubric editing, compliance as the headline, tokens as cost — and document the five check kinds and the five section verdicts. State plainly that `never-exercised` sections are never dropped and why.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: default to wider task sets, warn on weak power, ablate whole files"
```

---

## Cost, concretely

Commenter 5 was right that cost is the limiting factor, so here is where the money goes with the new defaults (15 tasks × 3 reps):

| Mode | Agent runs | Judge calls |
|---|---|---|
| `lint` | 0 | 1 per instruction file |
| `run` (baseline + current) | 90 | 90, only if any rule is `judge` kind |
| `run --ablate` (12 sections) | 630 | 630 |
| `run --ablate-files` (2 files) | 180 | 180 |

The important consequence: **per-section verdicts come out of the 90-run default**, because baseline-vs-current already reveals, for every rule, whether the agent complied without being told. `--ablate` is only needed for interaction effects between sections and for context dilution — commenter 6's "rules decay once context fills". It is no longer the price of admission for section-level signal.

Judge calls are avoidable. Every rule `optirule lint` can express as `files-touched`, `command-used`, `public-api-preserved`, or `no-new-env-vars` costs nothing to score. Reviewing the rubric and converting `judge` rules into deterministic ones is the single highest-leverage thing a user can do to cut their bill.

## Known limits to state in the report, not paper over

- **Compliance is not quality.** An agent can follow every rule and still write bad code. That is why task pass/fail from P0 stays in the report next to compliance rather than being replaced by it.
- **The rubric is only as good as the extraction.** `optirule lint` is an LLM reading your prose; the rubric is written to disk precisely so a human can correct it before it decides anything.
- **`public-api-preserved` is a text heuristic** over the diff, not type-aware analysis. It catches deletions and signature edits and will miss breaks made through re-exported types.
- **Context dilution is real but unmeasured here.** Commenter 6's observation that rules decay as context fills would need long-horizon multi-turn tasks; one-shot runs cannot see it.
