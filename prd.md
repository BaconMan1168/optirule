# optirule — MVP Spec
*2026-07-17*

---

## Problem

Repositories accumulate `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, and similar files. No existing tool answers the actual question: **do these instructions make the agent perform better on this repository?** Linters check structure. Optimizers guess. Nothing measures.

---

## What it is

A CLI tool that A/B tests your coding-agent instruction files against real tasks from your own repo. It runs your agent with no instructions, your current instructions, and reports which sections actually moved the needle — and which cost tokens for nothing.

---

## Target user

Individual developer or OSS maintainer. Runs it on their own repo. Zero team setup. Should work in under 5 minutes from `npx optirule init`.

---

## CLI surface

```bash
npx optirule init                # detect instruction files, scaffold optirule.yml
npx optirule run                 # run benchmark (auto-detect agent or prompt)
npx optirule run --agent claude
npx optirule export --minimal    # opt-in: generate trimmed instruction file
```

`init` writes `optirule.yml` to the repo root. `run` produces `.optirule/report.html`.

---

## Agent support

optirule tests **agents** (tools that can read and edit files), not raw models.

Built-in adapters for MVP:
- `claude` — Claude Code CLI
- `codex` / `opencode` — OpenAI Codex / opencode CLI
- `gemini` — Gemini CLI
- `aider` — supports local model backends out of the box

Generic escape hatch for anything else (vLLM, LM Studio, Ollama via aider, custom harnesses):

```yaml
agents:
  - name: my-local-agent
    command: "aider --model ollama/codestral --yes {prompt}"
    instruction_files: ["AGENTS.md"]
```

**Auto-detect:** if optirule is invoked from within a supported agent (e.g., Claude Code sets `CLAUDE_CODE_ENTRYPOINT`), it skips the `--agent` flag and announces the detected runner. Falls back to prompting if undetected.

---

## Adapter interface

Each built-in adapter implements:

```typescript
interface AgentAdapter {
  name: string;
  instructionFiles: string[];          // e.g. ['CLAUDE.md', '.claude/CLAUDE.md']
  buildCommand(prompt: string, worktreePath: string): string;
  parseTokenUsage(stdout: string): number | undefined;
  parseFilesRead(stdout: string): string[] | undefined;
}
```

The core handles everything else: worktrees, timing, git diff, success checks.

---

## Task sourcing

Two sources merged at runtime. `optirule.yml` task entries always win; auto-extracted tasks fill remaining slots up to the configured limit (default: 10).

### Auto-extract from git history

Scans recent commits for fix-pattern keywords (`fix:`, `bug`, `closes #`, `resolves #`). For each:

1. Checks out the **parent commit** in a worktree — the broken state
2. Records which tests are failing at that point — these are the target tests
3. Task prompt = cleaned commit message
4. Success = those specific failing tests now pass after the agent runs
5. Skips commits where no tests fail at parent (nothing to measure)

### optirule.yml tasks

```yaml
tasks:
  - id: fix-auth-expiry
    prompt: "Fix the authentication failure when the token expires before refresh"
    start_ref: abc123           # optional — defaults to HEAD
    success: npm test -- --grep auth    # exit 0 = pass
```

---

## Instruction variants

Two variants run **in parallel**, each in its own worktree:

| Variant | Instruction file |
|---------|-----------------|
| `baseline` | none (file hidden for the run) |
| `current` | your existing file as-is |

No auto-minimized variant. Section-level signal is reported; the user decides what to remove. `optirule export --minimal` is an explicit opt-in (see Report section).

---

## Isolation

Each run gets a fresh git worktree:

```
.optirule/
  runs/
    task-fix-auth/
      baseline/     ← worktree at start_ref, no instruction file
      current/      ← worktree at start_ref, with instruction file
```

**Worktree lifecycle:** create at `start_ref` → copy/omit instruction file → spawn agent subprocess → wait for exit → run success check → collect metrics → destroy worktree.

---

## Metrics collected per run

| Metric | Source |
|--------|--------|
| Pass / fail | Exit code of success command |
| Wall-clock duration | Process spawn → exit |
| Token usage | Parsed from agent stdout (adapter-specific) |
| Files changed | `git diff --name-only` after agent exits |
| Files read | Agent stdout where available |

---

## Report

Single self-contained HTML file at `.optirule/report.html`. No server, no dependencies.

### Summary table

```
Variant    Pass rate   Tokens   Runtime   Files changed
baseline   60%         —        38s       4
current    75%         18k      52s       6
```

### Section impact table

One row per `##` section in your instruction file, based on ablation runs (each section removed, re-run, delta measured):

```
Section                  Pass rate delta   Token delta   Signal
## Testing guidelines    +15%              +2k           earns its keep
## Code style rules      +0%               +3k           no measurable impact
## File structure rules  -5%               +1k           actively hurts
```

The tool surfaces the data. The user decides what to remove.

### `optirule export --minimal`

Generates a trimmed instruction file with only the sections that showed positive or neutral pass-rate delta. Prints a clear caveat: *validated only against your optirule task set — sections removed here may matter for tasks not in your benchmark.*

---

## optirule.yml (generated by init)

```yaml
agent: claude                    # or auto-detect
instruction_files:
  - CLAUDE.md
test_command: npm test
max_tasks: 10
tasks: []                        # optional manual tasks
```

---

## Out of scope for MVP

- Cloud report sharing
- Multi-agent parallel comparison in a single run
- Docker isolation (worktrees only)
- LLM-as-judge success evaluation
- CI/CD integration
- Web UI

---

## Viral launch hook

Run optirule against 20–30 prominent OSS repos with `CLAUDE.md` or `AGENTS.md`. Publish results as: *"We benchmarked 30 popular agent instruction files. Here's what actually helped."* The dataset is independently valuable and shareable.