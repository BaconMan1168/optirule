import { existsSync } from "node:fs";

/** Instruction files optirule knows how to detect, in priority order. */
const KNOWN_INSTRUCTION_FILES = [
  "CLAUDE.md",
  ".claude/CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  "CONVENTIONS.md",
  ".cursorrules",
];

/** Return the known instruction files that exist in a repo directory. */
export function detectInstructionFiles(dir: string): string[] {
  return KNOWN_INSTRUCTION_FILES.filter((f) => existsSync(`${dir}/${f}`));
}

/**
 * Detect the agent runner from the environment, when optirule is invoked from
 * within one. Returns undefined when nothing recognizable is set.
 */
export function detectAgent(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDECODE) return "claude";
  return undefined;
}
