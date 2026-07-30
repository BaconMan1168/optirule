---
name: audit
description: Benchmark CLAUDE.md and other repository instruction files against real, test-backed coding tasks. Use when the user wants a normal baseline-versus-current audit of task success, compliance, token cost, runtime, churn, tool calls, or files read. Use /optirule:ablate for section-level removal evidence and compact export.
disable-model-invocation: true
argument-hint: "[setup|lint|plan|run|report]"
---

# Audit repository instructions with OptiRule

Run OptiRule from the repository root. Treat `$ARGUMENTS` as the requested phase.
When it is empty, inspect existing OptiRule artifacts and recommend the next phase
without starting a model call.

## Resolve the CLI

Prefer an installed `optirule` command at version 0.3.0 or newer. Otherwise,
explain that `npx --yes optirule@latest` downloads the current npm package and
obtain permission before using it. Reuse the chosen command for the whole workflow.

## Preserve safety and evidence

- Never use `--yes` until the user has approved the exact plan printed by
  `optirule run --plan`.
- Read `max_tasks` and `reps` from `optirule.yml` and use them by default.
- Offer `--max-tasks 2 --reps 1` only as an explicit cheap-trial option. Never
  apply it unless the user chooses the cheaper, noisier trial.
- Review `optirule.rubric.yml` before benchmarking. It is the scoring contract.
- Do not commit generated configuration, reports, or exports unless asked.
- Never add `--ablate` or `--ablate-files`; this skill is baseline vs current.

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

Read `optirule.yml`, report its configured `max_tasks` and `reps`, then run:

```bash
optirule run --plan
```

Report the measurable task count, variants, repetitions, agent invocations,
judge calls, instruction-token cost, and plan fingerprint exactly as printed.
Do not start the benchmark. If the user explicitly selected a cheap trial, add
`--max-tasks 2 --reps 1` to this command and label its evidence low-confidence.

## run

Run the `plan` phase first in the same conversation. After the user explicitly
approves that plan, run the identical visible options without `--plan`; add the
internal `--yes` flag so the already-approved cost is not prompted twice. Verify
that the execution prints the same plan fingerprint. Users should never be
asked to type or understand `--yes`. Do not silently change task count,
repetitions, agent, or model.

After completion, report the paths written under `.optirule/`.

## report

Read `.optirule/analysis.json` and summarize:

- Task success for baseline and current instructions
- Mistakes avoided and rule-compliance changes
- Token, runtime, churn, tool-call, and files-read differences
- Confidence limitations
- Whole-file recommendation and baseline-vs-current section compliance

Separate measured observations from recommendations. Never describe
`never-exercised` as useless.
