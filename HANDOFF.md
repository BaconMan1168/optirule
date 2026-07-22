# P0 Measurement-Validity Handoff

Date: 2026-07-22
Branch: `feat/measurement-rewrite`

## Scope

This handoff covers P0 only. P1 (`docs/superpowers/plans/2026-07-21-compliance-metrics.md`)
has not been started or modified.

The P0 source plan is
`docs/superpowers/plans/2026-07-21-measurement-validity.md`.

## What was already complete

Claude's P0 implementation was committed and the worktree was clean when Codex
took over. It included:

- extracting post-fix test files for git-history tasks;
- preserving exact filenames and raw test-file bytes from git;
- rejecting auto-extracted tasks without usable changed tests;
- creating standalone, one-commit snapshots instead of shared-history
  worktrees;
- staging dependencies outside the source repository so `node_modules/..`
  cannot lead back to its `.git` directory;
- measuring the agent diff before restoring the target tests;
- dropping candidates whose restored tests already pass at the start ref;
- surviving invalid candidates and timed-out validation probes;
- rejecting manual task IDs that could escape the snapshot session directory;
- documenting the corrected success signal and snapshot isolation.

Claude also fixed several edge cases beyond the original P0 plan: Unicode git
paths, non-UTF-8 test content, locale-independent git error classification,
relaxed-search fallback based on surviving tasks, duplicate fallback
candidates, and accurate probe progress/outcomes.

## What Codex changed

### `f9bddc2 test(runner): cover P0 success flow end to end`

Added a focused integration test in `test/runner.test.ts`. The test constructs a
real temporary git history with a broken parent and a later fix commit, extracts
the fix commit's regression test, and executes the complete runner flow twice.
It proves that:

- a no-op agent fails against the restored post-fix test;
- an agent making the matching source fix passes;
- the restored test itself is not attributed to the agent's `filesChanged`.

This closed the main verification gap left by the helper-only runner tests. It
did not require a production behavior change.

### `3a225db docs: update snapshot terminology in code comments`

Replaced stale `worktree` terminology in runner, adapter, variant, and result
comments/parameter names with `snapshot`. The remaining `git worktree` mention
in `src/snapshot.ts` is intentional: it explains why worktrees were replaced.

## Audit result

No additional P0 implementation defect was found after reviewing the full diff
from `9f3cccd` through the current branch, the P0 plan, the source modules, and
the tests. No P1 code was added.

## Verification

All checks passed after the changes:

- Vitest: 14 test files passed, 103 tests passed.
- TypeScript: `tsc --noEmit` passed.
- Production bundle: `tsup` succeeded for the Node 18 target.
- CLI smoke test: `dist/cli.js --version` returned `0.1.0`.
- CLI smoke test: `dist/cli.js run --help` rendered successfully.
- `git diff --check` passed.

`npm` was not present on the Codex shell's `PATH`, so the equivalent project
binaries were run directly with Codex's bundled Node executable. No dependency
or source changes were needed for that environment limitation.

## Remaining before P1

The P0 plan asks for one live `optirule run` on this repository before P1 so the
new pass rates can be inspected. That paid/agent-backed benchmark was not run:
this checkout has no `optirule.yml` and no tracked `CLAUDE.md` or `AGENTS.md`, so
there is no meaningful local benchmark configuration to execute. The new
integration test verifies the same pass/fail construction deterministically,
but it does not produce real-agent pass-rate data.

When resuming with Claude:

1. Read this handoff and inspect commits `f9bddc2` and `3a225db` if needed.
2. If a real instruction file and benchmark config are available, run the P0
   live benchmark and review its pass rates.
3. Do not begin P1 until the user explicitly asks for it.
4. Delete this temporary `HANDOFF.md` after it has been consumed.
