# optirule — Phase 2 & 3 Handoff

Temp doc. Delete after Phase 3 lands. Everything needed to execute Phases 2 and 3
cold in a fresh session, without the originating chat. Phase 2 is §4–§7; Phase 3
is §9.

---

## 1. What optirule is (one paragraph)

A TypeScript/Node CLI that A/B tests coding-agent instruction files (`CLAUDE.md`,
`AGENTS.md`, …) against real tasks from the user's own repo. It runs the agent
with the instruction file hidden (`baseline`) vs present (`current`) in isolated
git worktrees, repeated `reps` times because a single agent pass/fail is noise,
and reports whether the file actually moves the pass rate — plus the static token
cost of each `##` section. Phase 1 is **built, committed, verified**. The full
product spec is in `prd.md` at repo root.

---

## 2. Current state (Phase 1 — DONE)

Commands that exist and work: `optirule init`, `optirule run [--yes] [--agent <name>]`.

Verify the baseline is green before starting:

```bash
npm install
npm run typecheck && npm run build && npm test   # all must pass (13 tests)
```

Git log is 9 small conventional commits on `main` (last: `docs: document optirule…`).

### File map (`src/`) — read these before touching anything

| File | Responsibility |
| --- | --- |
| `cli.ts` | commander entry; wires `init` and `run` subcommands. |
| `commands/init.ts` | Detect files, scaffold `optirule.yml`. |
| `commands/run.ts` | Orchestrates a run: load config → resolve adapter → parse sections → collect tasks → cost gate → `runAll` → `analyze` → `writeReport`. **This is where `--ablate` and the `export` command hook in.** |
| `config.ts` | `OptiruleConfig` type, `loadConfig`, `scaffoldConfig`. `agent` is `string \| { command: string }` (type `AgentSpec`). |
| `detect.ts` | Instruction-file detection + agent auto-detect via env. |
| `adapters.ts` | `AgentAdapter` interface, `SpawnSpec`, `resolveAdapter`. Built-in `claude` (headless `-p --output-format json --permission-mode acceptEdits`) + generic `{command}` template with `{prompt}` placeholder (shell-quoted). |
| `tasks.ts` | `collectTasks` = manual (from yml, always win) + `autoExtractTasks` (git fix-commits whose tests fail at parent; relaxed fallback). |
| `git.ts` | Worktree add/remove, `changedFiles`, `findFixCommits(cwd, limit, relaxed?)`. |
| `worktree.ts` | `setupWorktree` (adds worktree + symlinks repo `node_modules` in) / `teardownWorktree`. |
| `runner.ts` | **Core.** `runAll` → `runTask` → per variant × rep: setup worktree, `applyVariant`, spawn agent, run success cmd, collect `RunResult`. `VARIANTS` is hardcoded `["baseline","current"]`. |
| `sections.ts` | `parseSections(md) → Section[]` and `estimateTokens`. **Returns only `{title, tokens}` today — no body/offsets. Phase 2 must extend this (see §5).** |
| `analyze.ts` | `analyze(results, sections, taskCount) → Analysis`. Computes per-variant summaries, `passRateDeltaPct`, `lowConfidence` (min runs/variant < 5). |
| `report.ts` | `renderReport(analysis) → html`, `writeReport`. Self-contained HTML, inline CSS, no deps. |
| `estimate.ts` | `planRun(taskCount, reps, instructionTokens) → RunPlan`, `formatPlan`. Cost/confirm math. |
| `prompt.ts` | `confirm(question)` via readline. |
| `exec.ts` | `runSpec`/`runShell` — execa v10, `reject:false`, returns `{exitCode,stdout,stderr,durationMs,timedOut}`. |
| `constants.ts` | Timeouts + `.optirule/` paths (`RUNS_DIR`, `REPORT_PATH`, `PROBE_DIR`). |
| `types.ts` | `Variant`, `Task`, `Section`, `RunResult`. |

### Key data shapes (current)

```ts
type Variant = "baseline" | "current";
interface Section { title: string; tokens: number; }   // NO body yet
interface RunResult { taskId; variant: Variant; rep; passed; durationMs; tokens?; filesChanged: string[]; }
interface Analysis { variants: VariantSummary[]; passRateDeltaPct; lowConfidence; sections: Section[]; totalInstructionTokens; taskCount; }
```

---

## 3. Locked decisions & methodology (DO NOT re-litigate — preserve these)

1. **Single-run pass/fail is noise.** (τ-bench: 60% pass@1 → 25% cross-trial
   consistency.) Never present a per-section pass-rate delta from single runs as
   fact. Always attach a confidence signal and require repetitions.
2. **Ablation has a documented blind spot**: when a section is small relative to
   total tokens, its ablation effect is "basically invisible." The report MUST
   warn when a section is too small to measure.
3. **Cost gate is mandatory.** Any run that spends real tokens prints planned
   invocation count + token cost and asks to proceed; `--yes` skips. Ablation
   multiplies cost — the estimate must reflect it prominently.
4. **Tiered design.** Default `run` stays cheap (baseline vs current). Ablation
   is opt-in behind `--ablate` precisely because it is expensive and noisier.
5. **Deterministic per-section token cost is always shown** (it's free and
   trustworthy); per-section *impact* is the expensive/noisy part.
6. Stack: TypeScript on Node, ESM, execa/commander/yaml. Sequential runs (not
   parallel) — simpler, predictable cost. Keep it that way unless asked.

---

## 4. Phase 2 scope (build these two things)

### A. `optirule run --ablate`
Leave-one-out per-section sweep. For each `##` section S, run a variant where the
instruction file has S removed, and compare its pass rate to `current` (full
file). Report a per-section impact table with honest confidence labels.

- **Delta semantics:** `impact(S) = passRate(current) − passRate(ablated_S)`.
  Positive = removing S hurt → S earns its keep. Negative = removing S helped →
  S may hurt. ≈0 = no measurable impact.
- **Variants per task when ablating:** `baseline` + `current` + one per section =
  `2 + N` variants, each × `reps`. This is the cost blow-up — surface it in the
  estimate.
- **Confidence labels per row:** reuse the low-confidence rule (few runs) AND add
  the small-section warning (S tokens / total below a threshold → "too small to
  measure"). Both must render in the report.

### B. `optirule export --minimal`
Emit a trimmed instruction file containing only sections with positive-or-neutral
pass-rate delta (i.e., drop sections whose removal didn't hurt). Print the caveat
verbatim: *"validated only against your optirule task set — sections removed here
may matter for tasks not in your benchmark."* Requires ablation data (see §5 on
persistence). Writes a new file (e.g. `CLAUDE.optirule.md` or `--out <path>`),
never overwrites the original without explicit confirmation.

---

## 5. Concrete implementation plan (needed refactors)

These are the real gaps between Phase 1 and Phase 2. Address in order.

1. **Extend `sections.ts` to capture body + file attribution.**
   `parseSections` currently returns `{title, tokens}` only. Ablation needs to
   reconstruct the file *without* a given section, and `instruction_files` can be
   multiple, so a section must know its source file and its exact text span.
   Add a richer type, e.g.:
   ```ts
   interface ParsedSection { file: string; title: string; tokens: number;
                             startLine: number; endLine: number; }
   ```
   Add a helper `removeSection(fileContent, section) → string` (or rebuild from
   kept line ranges). Keep the existing `Section {title,tokens}` for the report's
   cost table, or migrate the report to the richer type — either is fine, just
   keep tests green.

2. **Generalize the variant model in `runner.ts`.**
   `Variant` is a string union `"baseline"|"current"` and `applyVariant` branches
   on it. Introduce a variant descriptor so ablation variants are first-class:
   ```ts
   type VariantSpec =
     | { kind: "baseline" }
     | { kind: "current" }
     | { kind: "ablate"; file: string; title: string };   // section removed
   ```
   `applyVariant` for `ablate` writes each instruction file, but for the target
   file writes `removeSection(content, section)`. Give each variant a stable
   worktree-path-safe id (e.g. `ablate-<slug(title)>`). `RunResult.variant` must
   become able to hold these ids (widen the type or add a `variantId: string`).
   **Watch:** the worktree path is derived from the variant id — slugify titles
   (no slashes/spaces) or paths break.

3. **Analysis for ablation (`analyze.ts`).**
   Add per-section impact computation: for each ablated section, delta vs
   `current`, plus per-row confidence + small-section flag. Emit a new
   `SectionImpact[]` on `Analysis` (only populated in ablate mode).

4. **Report (`report.ts`).**
   Add the section-impact table (title | pass-rate delta | token cost | signal
   label). Keep the existing cost table. Signal label maps delta+confidence to
   "earns its keep" / "no measurable impact" / "actively hurts" / "too small to
   measure" / "low confidence".

5. **Cost estimate (`estimate.ts`).**
   `planRun` assumes 2 variants. Add variant count as an input (or an ablate-aware
   overload) so the confirm prompt shows `tasks × (2+N) × reps`.

6. **Persistence for `export`.**
   `export --minimal` needs ablation results. Simplest: during `--ablate`, write a
   machine-readable `.optirule/analysis.json` (the `Analysis` object). `export`
   reads it; if missing, error telling the user to run `optirule run --ablate`
   first. (Do **not** silently re-run an expensive ablation from `export`.)

7. **Wire `--ablate` flag in `cli.ts`/`commands/run.ts`** and add an `export`
   subcommand (`commands/export.ts`) with `--minimal` and optional `--out`.

---

## 6. Conventions (mandatory — from the user)

- **Small incremental commits**, conventional format, **one sentence max** each.
- **NO "Co-Authored-By: Claude"** and **do not add yourself as a contributor.**
- **Every dependency: verify latest version via context7 MCP or web search
  BEFORE installing. Do not install a version without checking first.** (Phase 1
  pinned: commander ^15, yaml ^2.9, execa ^10, typescript ^7.0.2 (native
  compiler — needs `"types":["node"]` in tsconfig), tsup ^8.5, vitest ^4.1.) Try
  to avoid new deps; a char/4 token heuristic is used instead of a tokenizer.
- Simplicity first, surgical changes, don't overbuild. Match existing style.

---

## 7. Verification recipe (reuse this — no real token spend)

Phase 1 was verified with a **fake agent** via the generic adapter that only
"fixes" code when the instruction file is present. Rebuild a sandbox like this to
test ablation without spending money:

- `git init` a temp repo with a `check.js` that exits 0 only if a marker file
  exists, a `CLAUDE.md` with **multiple `##` sections**, and an `agent.sh` whose
  behavior depends on a *specific* section's presence (e.g., only writes the fix
  if a line from `## Fixing` is in the CLAUDE.md it reads). That makes ablating
  that section flip the pass rate → proves per-section attribution end-to-end.
- `optirule.yml`: `agent: { command: "bash /abs/agent.sh" }`, one manual task,
  small `reps`.
- Run `node dist/cli.js run --ablate -y` from the sandbox; assert the section
  impact table shows the load-bearing section as "earns its keep" and inert
  sections as "no measurable impact". Confirm `git worktree list` shows only main
  afterward (cleanup).
- Then `node dist/cli.js export --minimal` and assert inert sections are dropped
  and the caveat prints.

Sandbox pattern from Phase 1 (adapt for multi-section): fake `agent.sh` did
`if [ -f CLAUDE.md ]; then echo fixed > fixed.txt; fi`. For ablation, gate on a
grep of a section's text instead: `if grep -q "create fixed.txt" CLAUDE.md; then …`.

---

## 8. Known limitations / gotchas (carry forward)

- Worktrees leave **empty** dir scaffolding under `.optirule/runs/…` after
  cleanup (gitignored, harmless). Only the git worktree registration is removed.
- `node_modules` is symlinked from repo HEAD into each worktree; assumes deps
  didn't change between the task's `start_ref` and HEAD. Fine for most repos.
- Generic adapter returns `undefined` tokens (can't parse) → report shows "—".
  Expected.
- Global `~/.claude/CLAUDE.md` loads for all variants and cancels out; don't try
  to suppress it.
- `.optirule/` is gitignored. `prd.md` and this file are untracked by design.

---

## 9. Phase 3 (breadth) — do AFTER Phase 2

Mechanical, not design-heavy: add more built-in agent adapters and a "files read"
metric. The one real trap: **these agent CLIs change their non-interactive flags
often — verify each against current docs via context7/web before coding (per §6).
Do not trust the example flags below; they are starting points to confirm.**

### A. New built-in adapters (`adapters.ts`)
Each is a small function like `claudeAdapter`, added to the `resolveAdapter`
switch. Implement `buildCommand` (headless + autonomous-edit + machine-readable
output) and `parseTokenUsage`. All run with `cwd = worktree`, same as claude, so
the instruction file's presence/absence drives the variant — nothing else in the
runner changes.

| Adapter | Default instruction file | Non-interactive invocation (VERIFY) | Token parse (VERIFY) |
| --- | --- | --- | --- |
| `codex` | `AGENTS.md` | `codex exec "<prompt>"` with full-auto/sandbox flags for unattended edits | from JSON/usage output if available |
| `opencode` | `AGENTS.md` | `opencode run "<prompt>"` (headless run subcommand) | from output if available |
| `gemini` | `GEMINI.md` | `gemini -p "<prompt>"` plus an auto-approve flag (e.g. `--yolo`) | from output if available |
| `aider` | `CONVENTIONS.md`/`AGENTS.md` | `aider --yes --message "<prompt>" --no-auto-commits` (supports local models — key selling point) | aider prints token/cost lines to stdout |

Notes:
- Update `detect.ts` `KNOWN_INSTRUCTION_FILES` and `detectAgent` env signals if
  any of these expose an entrypoint env var (like claude's `CLAUDE_CODE_ENTRYPOINT`).
- `aider --no-auto-commits` matters: optirule measures `git diff` in the worktree,
  so the agent must NOT commit its own work or `changedFiles` comes back empty.
- Keep `parseTokenUsage` defensive (try/catch, return `undefined`) — same as claude.

### B. Files-read metric (`parseFilesRead`)
The PRD's `AgentAdapter` interface includes `parseFilesRead(stdout): string[] |
undefined`; Phase 1 omitted it. To add it:
1. Add optional `parseFilesRead?(stdout: string): string[] | undefined` to
   `AgentAdapter` in `adapters.ts`; implement where the agent's output exposes
   read files (claude stream-json tool calls; aider's chat log).
2. Add `filesRead?: string[]` to `RunResult` (`types.ts`); populate in
   `runner.ts` from `adapter.parseFilesRead?.(agent.stdout)`.
3. Add "Avg files read" column to the summary table in `report.ts` and an
   `avgFilesRead?` to `VariantSummary` in `analyze.ts`. Show "—" when unavailable
   (most adapters won't have it) — same honest-blank pattern as tokens.

### C. Verification (fake agents, no spend)
Extend the §7 sandbox: give each adapter a fake CLI shim (a shell script named to
match, on `PATH` or referenced by abs path) that mimics that CLI's output format,
and assert `buildCommand` + `parseTokenUsage`/`parseFilesRead` handle it. Unit-test
the parsers directly in `test/adapters.test.ts` with captured sample output — no
network, no real agent. This is the primary way to test Phase 3.

### Out of scope (still deferred past Phase 3, per prd.md)
Cloud report sharing, multi-agent parallel comparison in one run, Docker isolation,
LLM-as-judge success eval, CI/CD integration, web UI. Don't build these.
