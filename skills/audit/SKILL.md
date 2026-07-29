---
name: audit
description: Benchmark CLAUDE.md and other repository instruction files against real, test-backed coding tasks. Use when the user wants to measure whether coding-agent rules improve task success or compliance, inspect their token and runtime cost, identify harmful or redundant sections, or create an evidence-backed minimal instruction file.
disable-model-invocation: true
argument-hint: "[setup|lint|plan|run|report|export]"
---

# Audit repository instructions with OptiRule

Run OptiRule from the repository root. Treat `$ARGUMENTS` as the requested phase.
When it is empty, inspect existing OptiRule artifacts and recommend the next phase
without starting a model call.

## Resolve the CLI

Prefer an installed `optirule` command at version 0.2.0 or newer. Otherwise,
explain that `npx --yes optirule@latest` downloads the current npm package and
obtain permission before using it. Reuse the chosen command for the whole workflow.

## Preserve safety and evidence

- Never use `--yes` until the user has approved the exact plan printed by
  `optirule run --plan`.
- Start with `--max-tasks 2 --reps 1` unless the user explicitly requests a
  different scope.
- Do not treat a small trial as conclusive. Repeat the report's low-confidence
  warning.
- Review `optirule.rubric.yml` before benchmarking. It is the scoring contract.
- Never overwrite an original instruction file. `export --minimal` writes a
  separate candidate.
- Do not commit generated configuration, reports, or exports unless asked.

## setup

1. Confirm the working directory is a Git repository.
2. Confirm Node.js 22.12 or newer and the configured coding-agent CLI are
   available.
3. Locate at least one supported instruction file.
4. Run `optirule init`.
5. Read `optirule.yml`.
6. Verify `test_command` against the repository's actual test configuration.
   If the correct command is ambiguous, ask instead of guessing.

Stop after showing the resulting configuration.

## lint

Explain that linting uses one read-only model call per instruction file, then:

1. Run `optirule lint`.
2. Read `optirule.rubric.yml`.
3. Summarize deterministic rules, judge rules, unmeasurable instructions, and
   conflicts.
4. Ask the user to approve or edit the rubric before planning a benchmark.

## plan

Run:

```bash
optirule run --max-tasks 2 --reps 1 --plan
```

Report the measurable task count, variants, repetitions, agent invocations,
judge calls, and instruction-token cost exactly as printed. Do not start the
benchmark.

## run

Run the `plan` phase first in the same conversation. After the user explicitly
approves that plan, run the identical command without `--plan` and with `--yes`.
Do not silently change task count, repetitions, ablation flags, agent, or model.

After completion, report the paths written under `.optirule/`.

## report

Read `.optirule/analysis.json` and summarize:

- Task success for baseline and current instructions
- Mistakes avoided and rule-compliance changes
- Token, runtime, churn, tool-call, and files-read differences
- Confidence limitations
- Section evidence labels and any ablation results

Separate measured observations from recommendations. Never describe
`never-exercised` as useless.

## export

Require a completed compliance run, then run:

```bash
optirule export --minimal
```

Compare the generated candidate with the original instruction file. Explain
every removed section and preserve the original unchanged.
