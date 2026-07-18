# optirule

A/B test your coding-agent instruction files (`CLAUDE.md`, `AGENTS.md`, …) against
real tasks from your own repo. Linters check structure and optimizers guess —
optirule **measures** whether your instructions actually make the agent perform
better, and shows what each section costs in tokens.

## Quick start

```bash
npx optirule init             # detect instruction files, scaffold optirule.yml
npx optirule run              # benchmark: no instructions vs your instructions
npx optirule run --ablate     # also measure each section's impact (leave-one-out)
npx optirule export --minimal # write a trimmed file, keeping only load-bearing sections
```

`run` writes a self-contained report to `.optirule/report.html`.

## How it works

For every task, optirule runs your agent twice in isolated git worktrees:

| Variant    | Instruction file |
| ---------- | ---------------- |
| `baseline` | hidden           |
| `current`  | present          |

Each variant runs `reps` times (agents are non-deterministic, so a single
pass/fail is noise). The report shows the whole-file pass-rate delta, per-run
token/runtime/files-changed metrics, and the static token cost of each `##`
section — the deterministic half of "which sections earn their keep".

### Per-section impact (`--ablate`)

`run --ablate` adds a leave-one-out sweep: for each `##` section it runs one more
variant with that section removed, then reports `current pass rate − ablated pass
rate`. Positive means removing the section hurt (it earns its keep); ~0 means no
measurable effect; negative means it may hurt. This costs one extra variant per
section, so the estimate scales with section count — that's why it's opt-in.

Each row carries an honest signal label: **earns its keep**, **no measurable
impact**, **actively hurts**, **too small to measure** (the section is too tiny a
share of the file to attribute an effect to), or **low confidence** (too few runs).

`export --minimal` reads the last ablation run and writes `<file>.optirule.md`
(or `--out <path>`) keeping only load-bearing sections — it drops sections whose
removal measurably didn't hurt, never overwriting your original. The trimmed file
is validated only against your task set, so sections it removes may still matter
for tasks outside your benchmark.

Tasks come from two sources, manual entries first:

- **optirule.yml** — tasks you define, with a `success` command.
- **Git history** — recent `fix:`/`bug`/`closes #` commits whose tests fail at
  the parent commit. The commit message becomes the prompt; the task passes when
  those tests pass again.

Before spending money, `run` prints the planned invocation count and instruction
token cost and asks to proceed (`--yes` skips the prompt).

## optirule.yml

```yaml
agent: claude                 # built-in adapter, or an object with a command:
instruction_files:
  - CLAUDE.md
test_command: node --test
max_tasks: 5
reps: 3
tasks:
  - id: fix-auth-expiry
    prompt: "Fix the auth failure when the token expires before refresh"
    start_ref: abc123         # optional, defaults to HEAD
    success: npm test -- --grep auth
```

### Agents

Built-in adapters (each run headless with autonomous edits and machine-readable
output; the CLI must be on your `PATH`):

| `agent` | CLI | Default instruction file |
| --- | --- | --- |
| `claude` | Claude Code | `CLAUDE.md` |
| `codex` | OpenAI Codex | `AGENTS.md` |
| `opencode` | opencode | `AGENTS.md` |
| `gemini` | Gemini CLI | `GEMINI.md` |
| `aider` | aider | `CONVENTIONS.md` |

Anything else via a generic command template (no token or files-read parsing):

```yaml
agent:
  command: "my-agent --model ollama/codestral --yes {prompt}"
```

The report shows **avg files read** alongside tokens and files changed when the
adapter can report it (`claude` via its `Read` tool calls, `aider` from its chat
log); it reads `—` for adapters that don't expose it.

## Caveats

- A pass-rate delta from few runs is within agent noise; the report flags low
  confidence. Increase `reps` or add tasks to trust it.
- A section that is a small share of the whole file can't be measured by
  ablation even when it matters; those rows read "too small to measure".

## Development

```bash
npm install
npm run build      # bundle to dist/
npm test           # vitest
npm run typecheck
```
