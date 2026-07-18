/** Agent adapters: how optirule invokes a coding agent and reads its output. */

/** How to spawn one agent invocation. Runner sets cwd to the worktree. */
export interface SpawnSpec {
  command: string;
  args: string[];
  /** Run through a shell, used by the generic template adapter. */
  shell?: boolean;
}

export interface AgentAdapter {
  name: string;
  /** Instruction files this agent reads by default. */
  instructionFiles: string[];
  /** Build the spawn spec for a task prompt. */
  buildCommand(prompt: string): SpawnSpec;
  /** Best-effort token total parsed from the agent's stdout. */
  parseTokenUsage(stdout: string): number | undefined;
}

/** Sum the numeric token fields Claude Code reports under `usage`. */
function sumClaudeUsage(usage: Record<string, unknown>): number | undefined {
  const fields = [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ];
  let total = 0;
  let found = false;
  for (const f of fields) {
    const v = usage[f];
    if (typeof v === "number") {
      total += v;
      found = true;
    }
  }
  return found ? total : undefined;
}

/** Claude Code CLI, run headless with autonomous edits and JSON output. */
function claudeAdapter(instructionFiles: string[]): AgentAdapter {
  return {
    name: "claude",
    instructionFiles,
    buildCommand(prompt) {
      return {
        command: "claude",
        args: ["-p", prompt, "--output-format", "json", "--permission-mode", "acceptEdits"],
      };
    },
    parseTokenUsage(stdout) {
      try {
        const json = JSON.parse(stdout) as { usage?: Record<string, unknown> };
        return json.usage ? sumClaudeUsage(json.usage) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/** Shell-quote a value for safe interpolation into a command template. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Generic escape hatch: a shell command template with a `{prompt}` placeholder.
 * Token usage is not parsed, since the format is unknown.
 */
function genericAdapter(template: string, instructionFiles: string[]): AgentAdapter {
  return {
    name: "custom",
    instructionFiles,
    buildCommand(prompt) {
      return {
        command: template.replaceAll("{prompt}", shellQuote(prompt)),
        args: [],
        shell: true,
      };
    },
    parseTokenUsage() {
      return undefined;
    },
  };
}

/** Resolve the configured agent to a concrete adapter. */
export function resolveAdapter(
  agent: string | { command: string },
  instructionFiles: string[],
): AgentAdapter {
  if (typeof agent === "object") {
    return genericAdapter(agent.command, instructionFiles);
  }
  if (agent === "claude") {
    return claudeAdapter(instructionFiles);
  }
  throw new Error(
    `Unknown built-in agent "${agent}". Use "claude", or an object with a "command" template.`,
  );
}
