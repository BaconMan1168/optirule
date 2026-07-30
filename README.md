# optirule

[![npm version](https://img.shields.io/npm/v/optirule.svg?logo=npm)](https://www.npmjs.com/package/optirule)
[![CI](https://github.com/BaconMan1168/optirule/actions/workflows/ci.yml/badge.svg)](https://github.com/BaconMan1168/optirule/actions/workflows/ci.yml)
[![Node.js ≥22.12](https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Does your `CLAUDE.md` actually help? Measure it instead of guessing.**

[Recent research](https://arxiv.org/abs/2602.11988) found that repository context
files do not generally improve task success rates, while raising inference cost
by more than 20%. Other tools respond by rewriting your instruction file against
a heuristic. Optirule does the opposite: it **runs the experiment on your repo**
and reports which of your rules actually change agent behaviour.

It replays real fixes from your own git history with and without `CLAUDE.md`,
`AGENTS.md`, and similar files, then reports which rules prevented mistakes,
whether the resulting code passed its tests, and what the instructions cost in
tokens and runtime.

## Quick start

From the root of a git repository that already has an instruction file:

```bash
npx optirule@latest init   # choose detected instruction files, scaffold optirule.yml
npx optirule@latest lint   # turn the written rules into a reviewable scoring rubric
```

`init` and `lint` are cheap: `init` spends nothing and `lint` is a single model
call. Review the generated `optirule.rubric.yml` — it is the scoring contract —
then benchmark.

When more than one context file is present, `init` shows the detected files as
a checklist. Press Enter to include all of them, or enter the numbers for only
the files you want written to `instruction_files` in `optirule.yml`.

Outside a terminal — in CI, or when a coding agent runs the command — there is
nobody to answer that prompt, so `init` keeps every detected file. Name the ones
you want instead:

```bash
optirule init --files CLAUDE.md
```

Plan the configured benchmark before spending anything:

```bash
npx optirule@latest run --plan # uses max_tasks and reps from optirule.yml
npx optirule@latest run
```

For an explicitly cheaper but noisier trial, override both values:

```bash
npx optirule@latest run --max-tasks 2 --reps 1 --plan
npx optirule@latest run --max-tasks 2 --reps 1
```

`run` compares no instructions with your current instructions and writes a
self-contained report to `.optirule/report.html`.

## Claude Code skill

Install the repository as a Claude Code plugin to run the guided workflow as a
slash command:

```text
/plugin marketplace add BaconMan1168/optirule
/plugin install optirule@optirule
/reload-plugins
/optirule:audit setup
```

`/optirule:audit` handles normal baseline-versus-current evaluation:

```text
/optirule:audit lint
/optirule:audit plan
/optirule:audit run
/optirule:audit report
```

`/optirule:ablate` is the dedicated section-level workflow:

```text
/optirule:ablate
```

Both skills are deliberately user-invoked. They read `max_tasks` and `reps`
from `optirule.yml`, run a no-spend plan, report exact agent and judge invocation
counts, and wait for explicit approval. A two-task, one-repetition trial is
offered only as an explicit cheaper option.

### Complete `/optirule:ablate` example

Suppose `optirule.yml` specifies five tasks and three repetitions, and
`CLAUDE.md` has four sections:

```text
You: /optirule:ablate

Claude: Configuration: max_tasks=5, reps=3, agent=claude, file=CLAUDE.md.
        I’ll plan 2 fixed variants + 4 leave-one-section-out variants.

Claude runs: optirule run --ablate --plan

OptiRule: Planned run: 5 tasks x 6 variants x 3 reps = 90 agent invocations.
          Instruction files add ~75,000 static tokens across the plan.
          Rubric judge rules add 0 calls.
          Plan fingerprint: 7b4e2a1c9d83f650

Claude: This plan costs 90 full agent runs. Proceed?
You: Proceed.

Claude runs the identical plan with its internal approval flag, verifies the
same fingerprint, then summarizes every section:

Section       Class         Confidence  Runs      Pass  Mistakes  Compliance  Tokens  Runtime  Churn  Tools  Reads  Static
Testing       Helpful      Sufficient  15/15/15  +20pp  -0.4      +18pp       -320    -4.1s    -12    -3     -2     340
Formatting    Neutral      Sufficient  15/15/15    0pp   0.0        0pp         +8    +0.2s      0     0      0     110
Deployment    Inconclusive Low          3/3/3      0pp   0.0         —           —       —        0     —      —     205
Legacy notes  Harmful      Sufficient  15/15/15    0pp  +0.2       -6pp       +410    +7.8s    +18    +4     +3     480

Claude: Neutral means sufficiently powered practical equivalence.
        Inconclusive means insufficient or conflicting evidence.
        Create CLAUDE.compact.md?
You: Yes.

Claude runs: optirule export --compact
Claude: Removed Formatting (neutral) and Legacy notes (harmful), explained each
        measured delta, and left CLAUDE.md unchanged.
```

Every execution fingerprint must match its approved plan. The internal approval
flag is handled by the skills; users do not need to type or understand it.

### What a run costs

Every invocation is a **full agent run** — minutes of wall clock and real token
spend. The count is `tasks × variants × reps`:

| Command | Tasks | Variants | Reps | Agent invocations |
| --- | --- | --- | --- | --- |
| `run --max-tasks 2 --reps 1` | 2 | 2 | 1 | **4** |
| `run --max-tasks 5` | 5 | 2 | 3 | **30** |
| `run` (defaults) | 15 | 2 | 3 | **90** |
| `run --ablate` | 15 | 2 + one per section | 3 | **45 × (2 + sections)** |

Fewer reps is cheaper and noisier — agents are non-deterministic, so the default
of 3 exists for a reason and the report flags results too thin to trust. Optirule
always prints the planned invocation count and instruction token cost and waits
for confirmation before spending anything. Guided skills reuse the approved
saved plan with an internal flag.

For repeated use, install the CLI globally:

```bash
npm install -g optirule
```

Additional analysis and export commands:

```bash
optirule run --ablate       # measure each section with leave-one-out runs
optirule run --ablate-files # remove each whole instruction file in turn
optirule export --compact   # write ablation-backed <file>.compact.md copies
```

## What you learn

- **Quality:** Did the agent complete the task and pass the relevant tests?
- **Compliance:** Which written rules prevented observable mistakes?
- **Cost:** How did instructions change tokens, runtime, churn, and tool use?
- **Section impact:** Which sections helped, did nothing, or caused regressions?

Optirule is deliberately narrower than a general LLM evaluation framework. It
tests repository-level coding-agent instructions against executable work from
that repository's own history.

Unlike a static instruction-file linter, Optirule does not assign a quality
score from prose alone. It observes whether the instructions change agent
behaviour on executable tasks, while still exposing its generated compliance
rubric for review before the benchmark.

## Requirements

- **Node.js ≥ 22.12**
- A **git repository** to run in (optirule works from your project root)
- At least one **coding-agent CLI** on your `PATH` (`claude`, `codex`, `gemini`,
  `opencode`, or `aider`) — or any agent wired up via a custom command

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

The baseline-vs-current compliance view still labels rule sections as
**earns its keep**, **one task only**, **redundant**, **never exercised**, or
**harmful**. A never-exercised guardrail is unproven, not useless.

`--ablate` adds a complete leave-one-section-out comparison. For each section,
the report includes current and ablated values, their change, paired confidence,
pass rate, mistakes, compliance, tokens, runtime, churn, tool calls, files read,
static tokens removed, and run counts. It classifies the section as **helpful**,
**harmful**, **neutral**, or **inconclusive**. Neutral requires sufficient runs;
low-confidence or conflicting evidence is inconclusive.

`export --compact` requires a valid ablation run and refuses stale evidence if
an instruction file changed afterward. It removes only confidently neutral or
harmful sections, explains each removal, preserves helpful and inconclusive
sections, and writes `CLAUDE.compact.md` (or the corresponding name for another
instruction file) without touching the original. `--ablate-files` separately
removes each whole instruction file in turn.

Tasks come from two sources, manual entries first:

- **optirule.yml** — tasks you define, with a `success` command.
- **Git history** — the most recent `feat:`/`fix:`/`bug`/`closes #` commits that
  **changed test files**. Each starts from the commit's parent with the commit
  message as the prompt, and is scored against that commit's tests. Commits with
  no test change are skipped, as are commits whose tests already pass at the
  parent — neither can distinguish a working agent from an idle one.

Before spending money, `run` prints the planned invocation count and instruction
token cost and asks to proceed. The Claude skills separately plan, request
conversational approval, and then execute only the matching fingerprint.

### Reports and automation

Every completed run writes:

- `.optirule/report.html` — a self-contained human-readable report.
- `.optirule/analysis.json` — the same analysis as machine-readable JSON.
- `.optirule/run-plan.json` — the last no-spend plan and its fingerprint.

The analysis JSON includes `schemaVersion: 2`. Ablation runs add the full
per-section metric table, classifications, confidence, plan fingerprint, and
instruction-file hashes so skills and local automation can validate evidence
before acting on it.

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

`optirule init` lets you choose from the context files it detects, then
autodetects which of these CLIs are on your `PATH` and picks one — preferring
the runner it's invoked from, then a CLI whose default selected instruction
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

## Safety and privacy

Optirule creates temporary, history-free repository snapshots and deletes them
after the run. Reports stay local unless you choose to share them.

Claude Code benchmark subprocesses do not inherit the invoking Claude session's
identity, child-session markers, parent PID, or force-persistence setting. Each
subprocess gets a private temporary directory, ignores ambient MCP servers, and
disables session persistence. This lets `/optirule:audit` and
`/optirule:ablate` start isolated benchmark agents without polluting the parent
session or the session picker.

The coding-agent CLI and success commands still run with your user account's
environment and whatever network access those tools normally have. Optirule is
not a security sandbox: use trusted repositories, instruction files, task
prompts, and commands, and review which credentials your agent CLI can access.

Please report security issues privately as described in
[SECURITY.md](SECURITY.md).

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
