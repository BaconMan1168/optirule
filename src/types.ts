/** Shared domain types used across optirule's core. */

/** The two instruction variants compared in a Phase 1 run. */
export type Variant = "baseline" | "current";

/** A single benchmark task the agent is asked to complete. */
export interface Task {
  /** Stable identifier, used in paths and report rows. */
  id: string;
  /** Natural-language instruction handed to the agent. */
  prompt: string;
  /** Commit to check out as the task's starting state. */
  startRef: string;
  /** Shell command whose exit code 0 means the task passed. */
  successCommand: string;
  /** Where the task came from, for reporting. */
  source: "manual" | "git-history";
}

/** A `##` section parsed from an instruction file, with its static token cost. */
export interface Section {
  /** Heading text without the leading `##`. */
  title: string;
  /** Estimated token count of the heading plus its body. */
  tokens: number;
}

/** Metrics collected from one task × variant × repetition. */
export interface RunResult {
  taskId: string;
  variant: Variant;
  /** 0-based repetition index. */
  rep: number;
  /** Whether the success command exited 0. */
  passed: boolean;
  /** Wall-clock milliseconds from agent spawn to exit. */
  durationMs: number;
  /** Tokens parsed from agent output, when the adapter can report them. */
  tokens?: number;
  /** Files modified in the worktree, from `git diff --name-only`. */
  filesChanged: string[];
}
