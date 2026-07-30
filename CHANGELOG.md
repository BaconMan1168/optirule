# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.2] - 2026-07-29

### Added

- Let users choose which detected context files `optirule init` writes to
  `instruction_files`, with all detected files selected by default.

### Fixed

- Report the correct version from `optirule --version`. The string was hardcoded
  in the CLI and was missed by the 0.3.1 release, so 0.3.1 reported `0.3.0`.

## [0.3.0] - 2026-07-29

### Added

- Add complete leave-one-section-out metrics for pass rate, mistakes,
  compliance, tokens, runtime, churn, tool calls, files read, static tokens,
  run counts, paired confidence intervals, and section classification.
- Add the dedicated `/optirule:ablate` Claude Code skill with configuration-led
  planning, explicit cost approval, plan-fingerprint verification, section
  summary, and optional compact export.
- Add `CLAUDE.compact.md` export backed only by a valid, unchanged ablation run.
  Every removal is explained and the original instruction file is never
  overwritten.
- Add fake-agent end-to-end ablation coverage and regression tests for fresh
  processes, fresh snapshots, distinct Claude sessions, exact planned variants,
  and parent-context isolation.

### Changed

- Bump `.optirule/analysis.json` to `schemaVersion: 2` and include the complete
  section table in both JSON and HTML.
- Classify sections as helpful, harmful, neutral, or inconclusive. Neutral now
  requires sufficient runs and is distinct from insufficient evidence.
- Make `max_tasks` and `reps` from `optirule.yml` authoritative in both skills;
  the two-task, one-repetition scope is now an explicit cheap-trial option.
- Keep `/optirule:audit` focused on normal baseline-versus-current evaluation.

## [0.2.0] - 2026-07-29

### Added

- Add `optirule run --plan` to collect measurable tasks and print the exact
  agent and judge invocation plan without starting any model calls.
- Add a validated Claude Code plugin and the user-invoked `/optirule:audit`
  skill for setup, rubric review, cost planning, benchmarking, reporting, and
  safe minimal export.
- Add `schemaVersion: 1` to `.optirule/analysis.json` as a stable integration
  check for skills and local automation.

### Fixed

- Isolate Claude Code subprocesses from a parent Claude session, disable ambient
  MCP servers and session persistence, and give each invocation a private
  temporary directory so Optirule can run safely from a Claude Code skill.
- Give the intentional probe-timeout test enough CI scheduling headroom while
  keeping its simulated hang short.
- Align Node.js type definitions with the minimum supported Node.js 22 runtime.
- Move CI actions to their Node.js 24-based releases.

## [0.1.1] - 2026-07-23

### Added

- GitHub issue forms, a pull request template, and private security-reporting
  guidance for contributors.

### Fixed

- Align the documented Node.js requirement and CI matrix with the supported
  runtime range of the CLI's dependencies.
- Direct new users to audit their instruction files with `optirule lint` before
  running a benchmark.

## [0.1.0] - 2026-07-23

Initial release.

### Added

- `optirule init` — detect instruction files and scaffold `optirule.yml`.
- `optirule lint` — extract an editable rule rubric (`optirule.rubric.yml`) from
  your instruction files.
- `optirule run` — benchmark an agent with instructions hidden vs. present in a
  history-free snapshot of your repo, leading with **mistakes avoided**.
  - `--ablate` for leave-one-section-out impact, `--ablate-files` for
    whole-file ablation.
- `optirule export --minimal` — write a trimmed instruction file, keeping only
  load-bearing sections.
- Built-in agent adapters: `claude`, `codex`, `opencode`, `gemini`, `aider`,
  plus a generic command template for anything else.
- Five rubric checks: `files-touched`, `command-used`, `public-api-preserved`,
  `no-new-env-vars`, and `judge`.
- Self-contained HTML report at `.optirule/report.html`.

[Unreleased]: https://github.com/BaconMan1168/optirule/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/BaconMan1168/optirule/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/BaconMan1168/optirule/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/BaconMan1168/optirule/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/BaconMan1168/optirule/releases/tag/v0.1.0
