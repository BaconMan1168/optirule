# optirule

[![npm version](https://img.shields.io/npm/v/optirule.svg)](https://www.npmjs.com/package/optirule)
[![npm downloads](https://img.shields.io/npm/dm/optirule.svg)](https://www.npmjs.com/package/optirule)
[![node](https://img.shields.io/node/v/optirule.svg)](https://www.npmjs.com/package/optirule)
[![license](https://img.shields.io/npm/l/optirule.svg)](./LICENSE)

A/B test your coding-agent instruction files (`CLAUDE.md`, `AGENTS.md`, …) against
real tasks from your own repo. Linters check structure and optimizers guess —
optirule **measures** whether your instructions actually make the agent work more
efficiently, and shows what each section costs in tokens.

## Requirements

- **Node.js ≥ 18**
- A **git repository** to run in (optirule works from your project root)
- At least one **coding-agent CLI** on your `PATH` (`claude`, `codex`, `gemini`,
  `opencode`, or `aider`) — or any agent wired up via a custom command

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

Each variant runs `reps` times (default 5; agents are non-deterministic, so a
single run is noise). Modern agents pass most tasks either way, so the **primary
signal is efficiency, not pass/fail**: the report headlines the change in agent
**token usage** (`current` vs `baseline`), shows runtime / files-changed / files-read
alongside it, keeps pass rate as one demoted column, and pairs it all with a
plain-language **recommendation**. Pass/fail is still recorded — the ~1% where a
section actually breaks correctness is worth catching.

### Per-section impact (`--ablate`)

`run --ablate` adds a leave-one-out sweep: for each `##` section it runs one more
variant with that section removed, then reports the **token impact** `ablated
tokens − current tokens`. Positive means the agent burned more tokens without the
section (it earns its keep); ~0 means no measurable effect; negative means the
section made the agent burn more. This costs one extra variant per section, so
the estimate scales with section count — that's why it's opt-in.

The keep/drop call keys off **tokens** — a section earns its keep only if removing
it moves agent token usage past a ±20% neutral band (tokens vary ~2× run-to-run on
the same task, so smaller effects are noise). Each row carries an honest signal:
**earns its keep**, **no measurable impact**, **actively hurts**, **too small to
measure** (too tiny a share of the file to attribute an effect to), or **low
confidence** (too few runs, or the agent reports no token counts). Token effects
are noisy, so raise `reps` (10+) for sharper per-section verdicts.

`export --minimal` reads the last ablation run and writes `<file>.optirule.md`
(or `--out <path>`) keeping only load-bearing sections — it drops sections whose
removal didn't cost tokens (dead weight) or freed tokens (actively hurts), never
overwriting your original. The trimmed file is validated only against your task
set, so sections it removes may still matter for tasks outside your benchmark.

Tasks come from two sources, manual entries first:

- **optirule.yml** — tasks you define, with a `success` command.
- **Git history** — the most recent `feat:`/`fix:`/`bug`/`closes #` commits. Each
  starts from the commit's parent with the commit message as the prompt; optirule
  measures how efficiently the agent redoes that work.

Before spending money, `run` prints the planned invocation count and instruction
token cost and asks to proceed (`--yes` skips the prompt).

## optirule.yml

```yaml
agent: claude                 # built-in adapter, or an object with a command:
instruction_files:
  - CLAUDE.md
test_command: node --test
max_tasks: 8
reps: 5
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

`optirule init` autodetects which of these CLIs are on your `PATH` and picks one
— preferring the runner it's invoked from, then a CLI whose default instruction
file is present — instead of always assuming `claude`.

Anything else via a generic command template (no token or files-read parsing):

```yaml
agent:
  command: "my-agent --model ollama/codestral --yes {prompt}"
```

#### Extra agent flags (`agent_args`)

`agent_args` appends flags to every built-in agent invocation, so you can pin a
model or endpoint while keeping token/files-read parsing:

```yaml
agent: aider
agent_args: ["--model", "ollama_chat/qwen2.5-coder"]
```

#### Local & self-hosted models (ollama, vLLM, OpenRouter)

optirule benchmarks the **agent CLI**; the model is a setting *inside* that CLI,
so you reach a local or hosted model *through* an adapter like `aider`. Point
aider at the backend with its own env vars, then select the model with
`agent_args` — token parsing keeps working:

| Backend | aider env | `agent_args` model |
| --- | --- | --- |
| ollama | `OLLAMA_API_BASE=http://127.0.0.1:11434` | `["--model", "ollama_chat/<model>"]` |
| vLLM (OpenAI-compatible) | `OPENAI_API_BASE=<url>`, `OPENAI_API_KEY=<key>` | `["--model", "openai/<model>"]` |
| OpenRouter | `OPENROUTER_API_KEY=<key>` | `["--model", "openrouter/<vendor>/<model>"]` |

Endpoints and keys stay in the agent's environment — optirule never handles them.

The report shows **avg files read** alongside tokens and files changed when the
adapter can report it (`claude` via its `Read` tool calls, `aider` from its chat
log); it reads `—` for adapters that don't expose it.

## Caveats

- Agent token usage varies ~2× run-to-run on the same task, so a delta from few
  runs is within noise; the report flags low confidence. Increase `reps` or add
  tasks to trust it.
- A section that is a small share of the whole file can't be measured by
  ablation even when it matters; those rows read "too small to measure".
- Efficiency, not correctness, is the headline — a section that measurably saves
  no tokens can still matter for tasks outside your benchmark.

## Development

```bash
npm install
npm run build      # bundle to dist/
npm test           # vitest
npm run typecheck
```

## Contributing

Contributions are welcome — whether it's a bug report, a new agent adapter, or a
docs fix. optirule is small on purpose, so the bar is "does this help people
measure their instruction files without adding weight the project doesn't need."

**Found a bug or have an idea?** Open an
[issue](https://github.com/BaconMan1168/optirule/issues) first. For anything
non-trivial, please start a discussion there before opening a PR so we can agree
on the approach — it saves everyone rework.

**Sending a pull request:**

1. Fork the repo and create a branch off `main` (`git checkout -b fix-token-parse`).
2. Set up your environment with the [Development](#development) steps above.
3. Make your change. Keep it focused — one logical change per PR, and match the
   existing style (the codebase favors small, surgical edits).
4. **Add or update tests** for any behavior you change (`npm test`).
5. Make sure `npm test` and `npm run typecheck` both pass before pushing.
6. Write clear commit messages in
   [Conventional Commits](https://www.conventionalcommits.org/) style
   (`feat:`, `fix:`, `docs:`, …) — it's what the project's history uses.
7. Open the PR against `main` and describe what changed and why.

**Adding an agent adapter?** Adapters live in
[`src/adapters.ts`](src/adapters.ts); each one builds the agent's command and
parses token usage (and, ideally, files-read) from its output. Add it to the
built-in map, register its default instruction file in
[`src/detect.ts`](src/detect.ts), and cover it in
[`test/adapters.test.ts`](test/adapters.test.ts).

By contributing, you agree that your contributions will be licensed under the
project's MIT License.

## License

[MIT](./LICENSE) © BaconMan1168
