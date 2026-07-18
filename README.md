# optirule

A/B test your coding-agent instruction files (`CLAUDE.md`, `AGENTS.md`, …) against
real tasks from your own repo. Linters check structure and optimizers guess —
optirule **measures** whether your instructions actually make the agent perform
better, and shows what each section costs in tokens.

## Quick start

```bash
npx optirule init     # detect instruction files, scaffold optirule.yml
npx optirule run      # benchmark: no instructions vs your instructions
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

- Built-in: `claude` (Claude Code CLI, run headless with autonomous edits).
- Anything else via a generic command template:

  ```yaml
  agent:
    command: "aider --model ollama/codestral --yes {prompt}"
  ```

## Caveats

- A pass-rate delta from few runs is within agent noise; the report flags low
  confidence. Increase `reps` or add tasks to trust it.
- Per-section *impact* (not just cost) needs an ablation sweep — coming in a
  later version.

## Development

```bash
npm install
npm run build      # bundle to dist/
npm test           # vitest
npm run typecheck
```
