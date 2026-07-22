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
npx optirule lint             # extract an editable rule rubric; review it first
npx optirule run              # benchmark: no instructions vs your instructions
npx optirule run --ablate     # also measure each section's impact (leave-one-out)
npx optirule run --ablate-files # also remove each whole instruction file in turn
npx optirule export --minimal # write a trimmed file, keeping only load-bearing sections
```

`run` writes a self-contained report to `.optirule/report.html`.

## How it works

For every task, optirule runs your agent twice in a history-free snapshot:

| Variant    | Instruction file |
| ---------- | ---------------- |
| `baseline` | hidden           |
| `current`  | present          |

Each variant runs `reps` times (default 3; agents are non-deterministic, so a
single run is noise). Every run happens in a **history-free snapshot** of your
repo at the task's start commit — one commit, no future history — so the agent
cannot read the commit that solves its own task.

For tasks taken from git history, success is the commit's own tests: optirule
restores the test files the fix commit touched, at their post-fix content, after
the agent finishes and after its diff has been measured. Those tests fail at the
start commit and pass only if the agent actually did the work, so **pass/fail
measures task completion**.

Before the benchmark, `optirule lint` asks the configured built-in agent to turn
each instruction file into `optirule.rubric.yml`. Review and edit that file: it
is the scoring contract. Rules use one of five checks:

- `files-touched`: allow or forbid path globs.
- `command-used`: require or ban shell-command fragments.
- `public-api-preserved`: flag removed or changed exported signatures.
- `no-new-env-vars`: flag newly introduced environment-variable names.
- `judge`: ask one blind yes/no model question, batched with all judge rules.

The report leads with **mistakes avoided**: baseline rule violations minus
current rule violations, paired by task with a reproducible 95% interval. It
keeps compliance separate from quality (test pass/fail) and reports tokens,
runtime, churn, tool calls, and files touched/read as cost and effort.

Every section receives one of five evidence labels: **earns its keep** (helped on
at least two tasks), **one task only**, **redundant**, **never exercised**, or
**harmful**. `export --minimal` removes only redundant or harmful sections. A
never-exercised guardrail is unproven, not useless, so it is never dropped.

`--ablate` still adds a leave-one-section-out sweep for interaction and token
effects. `--ablate-files` does the same for each whole instruction file. Both
increase the invocation count shown before confirmation.

Tasks come from two sources, manual entries first:

- **optirule.yml** — tasks you define, with a `success` command.
- **Git history** — the most recent `feat:`/`fix:`/`bug`/`closes #` commits that
  **changed test files**. Each starts from the commit's parent with the commit
  message as the prompt, and is scored against that commit's tests. Commits with
  no test change are skipped, as are commits whose tests already pass at the
  parent — neither can distinguish a working agent from an idle one.

Before spending money, `run` prints the planned invocation count and instruction
token cost and asks to proceed (`--yes` skips the prompt).

## optirule.yml

```yaml
agent: claude                 # built-in adapter, or an object with a command:
instruction_files:
  - CLAUDE.md
test_command: node --test
max_tasks: 15
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

The report shows churn, tool calls, and files read alongside tokens and files
changed when the adapter exposes them; unavailable values read `—`.

## Caveats

- A task is only as good as the test the fix commit shipped. A thin test scores a
  thin solution as a pass.
- Commit subjects are terse prompts. A task whose commit message does not explain
  the intent may be unsolvable for reasons unrelated to your instructions.
- Compliance is not quality. An agent can follow every rule and still fail the
  task, so test pass/fail stays beside compliance in the report.
- Rubric extraction is a model reading prose. Review `optirule.rubric.yml`
  before it decides anything.
- `public-api-preserved` is a diff-text heuristic, not type-aware analysis.
- Rules that never apply to the task set remain protected; the benchmark has no
  evidence about whether those guardrails are useful.

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
