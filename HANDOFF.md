# P0 + P1 Handoff

Date: 2026-07-22
Branch: `feat/measurement-rewrite`

## Status

P0 measurement validity and P1 compliance metrics are implemented. The P1
source plan is `docs/superpowers/plans/2026-07-21-compliance-metrics.md`.

## P0 summary

P0 now extracts post-fix tests for history tasks, runs agents in standalone
one-commit snapshots, restores regression tests after measuring the agent diff,
drops vacuous or invalid candidates, and prevents dependency symlinks and task
IDs from escaping into the source repository. See commits through `8bb893b` for
the earlier detailed P0 work.

## P1 implementation

P1 landed as incremental conventional commits:

- `e23668e` — editable `optirule.rubric.yml` persistence.
- `862c393` — `optirule lint`, read-only rubric extraction, and judge-capable
  adapter methods.
- `6e08c6b` — command parsing, tool-call counts, unified diffs, and churn.
- `2fd6f52` — deterministic file and command checks.
- `05063dc` — public-API and new-environment-variable checks.
- `862eeb5` — blind, batched judge scoring.
- `5df920b` — per-run verdicts and failure classification.
- `dcc806e` — deterministic paired bootstrap confidence intervals.
- `7b5bc67` — mistakes avoided as the analysis headline.
- `8a2b61d` — compliance-based minimal export with guardrail protection.
- `0688399` — two-axis compliance/outcome report plus tokens per success,
  churn, tool calls, and file activity.
- `2abbbc9` — wider defaults, power warning, whole-file ablation, README, and
  final measurement-isolation fixes.
- `7e2c404` — judge-call cost disclosure before confirmation.

The completed flow is:

1. `optirule lint` extracts an editable rubric before benchmarking.
2. Four deterministic check kinds score diff/command evidence for free;
   `judge` rules are scored blind in one batched read-only call per run.
3. Each run stores rule verdicts, churn, tool calls, and a deterministic failure
   category.
4. Analysis pairs baseline/current deltas by task and reports a reproducible
   95% bootstrap interval.
5. Sections earn their keep only after improving at least two distinct tasks.
   Never-exercised and single-task guardrails cannot be removed by
   `export --minimal`.
6. The report separates rule compliance from task outcome and treats tokens as
   cost rather than the verdict.

## Additional issues fixed during P1

- Structured response extraction now prefers Claude's final result instead of
  concatenating duplicate stream blocks, and reads Codex agent-message events.
- `agent_args` are appended to judge calls as well as editing calls.
- Lint prompts include the source filename so multi-file rules trace correctly.
- Untracked files are marked intent-to-add after the agent runs, making them
  visible to path checks, unified diffs, and churn without staging content.
- Instruction files are excluded from judge diff evidence and churn so variant
  setup cannot reveal the condition or inflate metrics.
- Colliding whole-file ablation slugs are disambiguated.
- Plans disclose one judge call per run when any judge rule exists.

## Verification

The final gate passed:

- Vitest: 20 files, 160 tests.
- TypeScript: `tsc --noEmit`.
- Production bundle: `tsup`, Node 18 target.
- CLI help exposes `lint`, `--ablate-files`, and the compliance-based export.
- `git diff --check`.

The Codex shell had no `npm` executable on `PATH`, so the pinned project
binaries were invoked directly with Codex's bundled Node runtime.

## Remaining live validation

No paid model-backed `optirule lint` or `optirule run` was executed in this
checkout because it has no `optirule.yml` or tracked instruction file. Unit and
integration tests cover the complete deterministic pipeline, but real-agent
rubric quality and pass-rate data still require a representative instruction
file, benchmark configuration, and user-approved model spend.

When Claude resumes:

1. Review this handoff and the commits above.
2. If a representative config and instruction file are available, run `lint`,
   review the generated rubric, then run the live benchmark.
3. Delete this temporary `HANDOFF.md` after it has been consumed.
