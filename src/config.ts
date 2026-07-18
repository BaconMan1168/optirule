import { readFileSync, existsSync } from "node:fs";
import { parse, stringify } from "yaml";

/** A manually-specified task entry in optirule.yml. */
export interface ConfigTask {
  id: string;
  prompt: string;
  /** Optional; defaults to HEAD when omitted. */
  start_ref?: string;
  /** Success command; falls back to the top-level test_command. */
  success?: string;
}

/** Either a built-in adapter name or a generic shell command template. */
export type AgentSpec = string | { command: string };

/** The optirule.yml file after parsing and defaulting. */
export interface OptiruleConfig {
  agent: AgentSpec;
  /** Extra CLI args appended to every built-in agent invocation, e.g. ["--model", "ollama_chat/qwen"]. */
  agent_args: string[];
  instruction_files: string[];
  test_command: string;
  max_tasks: number;
  reps: number;
  tasks: ConfigTask[];
}

const DEFAULTS = {
  agent: "claude",
  test_command: "npm test",
  max_tasks: 8,
  reps: 5,
} as const;

export const CONFIG_FILENAME = "optirule.yml";

/** Load and default optirule.yml from a directory. Throws if it is missing. */
export function loadConfig(dir: string): OptiruleConfig {
  const path = `${dir}/${CONFIG_FILENAME}`;
  if (!existsSync(path)) {
    throw new Error(`No ${CONFIG_FILENAME} found. Run \`optirule init\` first.`);
  }
  const raw = (parse(readFileSync(path, "utf8")) ?? {}) as Partial<OptiruleConfig>;
  if (!raw.instruction_files?.length) {
    throw new Error(`${CONFIG_FILENAME} must list at least one instruction file.`);
  }
  return {
    agent: raw.agent ?? DEFAULTS.agent,
    agent_args: raw.agent_args ?? [],
    instruction_files: raw.instruction_files,
    test_command: raw.test_command ?? DEFAULTS.test_command,
    max_tasks: raw.max_tasks ?? DEFAULTS.max_tasks,
    reps: raw.reps ?? DEFAULTS.reps,
    tasks: raw.tasks ?? [],
  };
}

/** Render a starter optirule.yml given detected files and agent. */
export function scaffoldConfig(instructionFiles: string[], agent: string): string {
  const config = {
    agent,
    instruction_files: instructionFiles,
    test_command: DEFAULTS.test_command,
    max_tasks: DEFAULTS.max_tasks,
    reps: DEFAULTS.reps,
    tasks: [],
  };
  return stringify(config);
}
