---
name: ablate
description: Measure every CLAUDE.md section with leave-one-section-out agent runs, summarize helpful, harmful, neutral, and inconclusive evidence, and offer a safe CLAUDE.compact.md export. Use when the user wants section-level ablation or evidence-backed instruction trimming.
disable-model-invocation: true
argument-hint: "[trial]"
---

# Ablate repository instruction sections with OptiRule

Run OptiRule from the repository root. This is the dedicated section-ablation
workflow; use `/optirule:audit` for a normal baseline-versus-current evaluation.

## Resolve the CLI

Prefer an installed `optirule` command at version 0.3.0 or newer. Otherwise,
explain that `npx --yes optirule@latest` downloads the current npm package and
obtain permission before using it. Reuse the chosen command for the whole
workflow.

## Preserve safety and evidence

- Confirm the working directory is a Git repository.
- Read `optirule.yml` before constructing commands. Use its `max_tasks` and
  `reps` values by default.
- Offer `--max-tasks 2 --reps 1` only as an explicit cheap-trial option. Use it
  only when the user asks for or chooses the cheaper, noisier trial.
- Review `optirule.rubric.yml` when present and say when compliance metrics will
  be unavailable because it is absent.
- Never overwrite an original instruction file.
- Do not commit generated plans, reports, analysis, or exports unless asked.

## Workflow

1. Read `optirule.yml`. Report the instruction files, agent, `max_tasks`, and
   `reps` that will govern the run.
2. Run:

   ```bash
   optirule run --ablate --plan
   ```

   If and only if the user explicitly selected a cheap trial, append
   `--max-tasks 2 --reps 1`.
3. Show the measurable task count, variant count, repetitions, total agent
   invocations, judge calls, instruction-token cost, warnings, and plan
   fingerprint exactly as printed. Ask for explicit approval. Do not run agents
   before approval.
4. After approval, execute the identical command without `--plan`, adding
   internal `--yes`. Users should never be asked to type or understand `--yes`.
   Verify that the execution fingerprint exactly matches the approved
   fingerprint; stop if it does not.
5. Read `.optirule/analysis.json`. Require `schemaVersion: 2`,
   `ablation.valid: true`, and the approved `ablation.planFingerprint`.
   Summarize every section in a table with:
   - classification and confidence
   - current/ablated/paired run counts
   - pass-rate, mistakes, and compliance changes
   - token, runtime, churn, tool-call, and files-read changes
   - static tokens removed

   Every change is `current − ablated`. Positive is favorable for pass rate and
   compliance; negative is favorable for mistakes and cost metrics. Clearly say
   that `neutral` means sufficiently powered practical equivalence, while
   `inconclusive` means insufficient or conflicting evidence.
6. Offer, but do not automatically run:

   ```bash
   optirule export --compact
   ```

   After separate approval, run it, compare each generated
   `<instruction-file>.compact.md` with its original, and repeat every removal
   reason printed by OptiRule. Confirm that the originals remain unchanged.
