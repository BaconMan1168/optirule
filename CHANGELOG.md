# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/BaconMan1168/optirule/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/BaconMan1168/optirule/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/BaconMan1168/optirule/releases/tag/v0.1.0
