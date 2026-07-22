/** Agent adapters: how optirule invokes a coding agent and reads its output. */

/** How to spawn one agent invocation. Runner sets cwd to the snapshot. */
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
  /** Build a read-only invocation for scoring prompts. */
  buildJudgeCommand(prompt: string): SpawnSpec;
  /** Pull the agent's plain-text reply out of its structured output. */
  extractText(stdout: string): string;
  /** Best-effort token total parsed from the agent's stdout. */
  parseTokenUsage(stdout: string): number | undefined;
  /** Best-effort list of files the agent read, when its output exposes them. */
  parseFilesRead?(stdout: string): string[] | undefined;
  /** Shell commands the agent ran, when its output exposes them. */
  parseCommands?(stdout: string): string[] | undefined;
  /** Total tool invocations, as an effort signal. */
  parseToolCalls?(stdout: string): number | undefined;
}

/** Parse a JSON-lines stream, skipping blank or malformed lines. */
function parseJsonLines(stdout: string): unknown[] {
  const objects: unknown[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      objects.push(JSON.parse(trimmed));
    } catch {
      // Ignore non-JSON lines (progress text, banners, etc.).
    }
  }
  return objects;
}

/** Concatenate assistant text blocks from a JSON-lines transcript. */
function textFromJsonLines(stdout: string): string {
  const parts: string[] = [];
  for (const obj of parseJsonLines(stdout)) {
    const o = obj as { result?: unknown; message?: { content?: unknown } };
    if (typeof o.result === "string") parts.push(o.result);
    if (!Array.isArray(o.message?.content)) continue;
    for (const block of o.message.content) {
      const b = block as { type?: string; text?: string };
      if (b.type === "text" && b.text) parts.push(b.text);
    }
  }
  return parts.join("\n");
}

/** Every tool_use block in a JSON-lines transcript. */
function toolUses(stdout: string): { name?: string; input?: Record<string, unknown> }[] {
  const uses: { name?: string; input?: Record<string, unknown> }[] = [];
  for (const obj of parseJsonLines(stdout)) {
    const content = (obj as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const use = block as { type?: string; name?: string; input?: Record<string, unknown> };
      if (use.type === "tool_use") uses.push({ name: use.name, input: use.input });
    }
  }
  return uses;
}

function commandsFromToolUses(stdout: string): string[] | undefined {
  const commands = toolUses(stdout)
    .filter((use) => use.name === "Bash" && typeof use.input?.command === "string")
    .map((use) => use.input!.command as string);
  return commands.length ? commands : undefined;
}

function toolCallCount(stdout: string): number | undefined {
  const uses = toolUses(stdout);
  return uses.length ? uses.length : undefined;
}

/** Sum a set of numeric fields on an object, or undefined if none are present. */
function sumFields(obj: Record<string, unknown>, fields: string[]): number | undefined {
  let total = 0;
  let found = false;
  for (const f of fields) {
    const v = obj[f];
    if (typeof v === "number") {
      total += v;
      found = true;
    }
  }
  return found ? total : undefined;
}

/**
 * Claude Code CLI, run headless with autonomous edits and streaming JSON so we
 * can read both token usage and the files it opened via `Read` tool calls.
 */
function claudeAdapter(instructionFiles: string[]): AgentAdapter {
  return {
    name: "claude",
    instructionFiles,
    buildCommand(prompt) {
      return {
        command: "claude",
        args: [
          "-p",
          prompt,
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode",
          "acceptEdits",
        ],
      };
    },
    buildJudgeCommand(prompt) {
      return {
        command: "claude",
        args: ["-p", prompt, "--output-format", "stream-json", "--verbose"],
      };
    },
    extractText: textFromJsonLines,
    parseTokenUsage(stdout) {
      // The final `result` event carries cumulative usage; fall back to any
      // object with a usage field (e.g. a single-object non-streaming reply).
      let usage: Record<string, unknown> | undefined;
      for (const obj of parseJsonLines(stdout)) {
        const o = obj as { usage?: Record<string, unknown> };
        if (o.usage) usage = o.usage;
      }
      return usage
        ? sumFields(usage, [
            "input_tokens",
            "output_tokens",
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
          ])
        : undefined;
    },
    parseFilesRead(stdout) {
      const objects = parseJsonLines(stdout);
      if (objects.length === 0) return undefined;
      const files: string[] = [];
      for (const obj of objects) {
        const content = (obj as { message?: { content?: unknown } }).message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          const b = block as { type?: string; name?: string; input?: { file_path?: string } };
          if (b.type === "tool_use" && b.name === "Read" && b.input?.file_path) {
            if (!files.includes(b.input.file_path)) files.push(b.input.file_path);
          }
        }
      }
      return files;
    },
    parseCommands: commandsFromToolUses,
    parseToolCalls: toolCallCount,
  };
}

/** OpenAI Codex CLI, run non-interactively with workspace-write sandbox and JSON. */
function codexAdapter(instructionFiles: string[]): AgentAdapter {
  return {
    name: "codex",
    instructionFiles,
    buildCommand(prompt) {
      return {
        command: "codex",
        args: ["exec", "--json", "--sandbox", "workspace-write", prompt],
      };
    },
    buildJudgeCommand(prompt) {
      return { command: "codex", args: ["exec", "--json", "--sandbox", "read-only", prompt] };
    },
    extractText: textFromJsonLines,
    parseTokenUsage(stdout) {
      // `turn.completed` reports cumulative usage; cached/reasoning counts are
      // subsets of input/output, so only base input + output are summed.
      let usage: Record<string, unknown> | undefined;
      for (const obj of parseJsonLines(stdout)) {
        const o = obj as { type?: string; usage?: Record<string, unknown> };
        if (o.type === "turn.completed" && o.usage) usage = o.usage;
      }
      return usage ? sumFields(usage, ["input_tokens", "output_tokens"]) : undefined;
    },
  };
}

/** Gemini CLI, run headless with --yolo auto-approve and structured JSON output. */
function geminiAdapter(instructionFiles: string[]): AgentAdapter {
  return {
    name: "gemini",
    instructionFiles,
    buildCommand(prompt) {
      return {
        command: "gemini",
        args: ["-p", prompt, "--output-format", "json", "--yolo"],
      };
    },
    buildJudgeCommand(prompt) {
      return { command: "gemini", args: ["-p", prompt, "--output-format", "json"] };
    },
    extractText(stdout) {
      try {
        return (JSON.parse(stdout) as { response?: string }).response ?? stdout;
      } catch {
        return stdout;
      }
    },
    parseTokenUsage(stdout) {
      try {
        const json = JSON.parse(stdout) as {
          stats?: { models?: Record<string, { tokens?: { total?: unknown } }> };
        };
        const models = json.stats?.models;
        if (!models) return undefined;
        let total = 0;
        let found = false;
        for (const model of Object.values(models)) {
          const t = model.tokens?.total;
          if (typeof t === "number") {
            total += t;
            found = true;
          }
        }
        return found ? total : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/** opencode CLI, run as a single headless prompt with JSON event output. */
function opencodeAdapter(instructionFiles: string[]): AgentAdapter {
  return {
    name: "opencode",
    instructionFiles,
    buildCommand(prompt) {
      return {
        command: "opencode",
        args: ["run", prompt, "--format", "json"],
      };
    },
    buildJudgeCommand(prompt) {
      return { command: "opencode", args: ["run", prompt, "--format", "json"] };
    },
    extractText: textFromJsonLines,
    parseTokenUsage(stdout) {
      // Assistant message parts carry a `tokens` object; the last one seen holds
      // the run's totals. cache counts are subsets, so only input/output/reasoning.
      let tokens: Record<string, unknown> | undefined;
      for (const obj of parseJsonLines(stdout)) {
        const t = (obj as { tokens?: Record<string, unknown> }).tokens;
        if (t) tokens = t;
      }
      return tokens ? sumFields(tokens, ["input", "output", "reasoning"]) : undefined;
    },
    parseCommands: commandsFromToolUses,
    parseToolCalls: toolCallCount,
  };
}

/** aider, run one-shot without auto-commits so optirule can measure the diff. */
function aiderAdapter(instructionFiles: string[]): AgentAdapter {
  return {
    name: "aider",
    instructionFiles,
    buildCommand(prompt) {
      return {
        command: "aider",
        args: ["--yes-always", "--no-auto-commits", "--message", prompt],
      };
    },
    buildJudgeCommand(prompt) {
      return { command: "aider", args: ["--no-auto-commits", "--message", prompt] };
    },
    extractText: (stdout) => stdout,
    parseTokenUsage(stdout) {
      // aider prints e.g. "Tokens: 2.7k sent, 290 received." — take the last line.
      const matches = [...stdout.matchAll(/Tokens:\s*([\d.]+[km]?)\s*sent,\s*([\d.]+[km]?)\s*received/gi)];
      const last = matches.at(-1);
      const sent = last?.[1];
      const received = last?.[2];
      if (sent === undefined || received === undefined) return undefined;
      return parseAiderCount(sent) + parseAiderCount(received);
    },
    parseFilesRead(stdout) {
      const files: string[] = [];
      for (const m of stdout.matchAll(/^Added (.+?) to the chat\.?$/gim)) {
        const path = m[1];
        if (path !== undefined && !files.includes(path)) files.push(path);
      }
      return files;
    },
  };
}

/** Parse aider's abbreviated token counts like "2.7k" or "290". */
function parseAiderCount(value: string): number {
  const suffix = value.slice(-1).toLowerCase();
  const scale = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : 1;
  return Math.round(parseFloat(value) * scale);
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
    buildJudgeCommand() {
      throw new Error(
        "A custom `command:` agent cannot be used as a judge because optirule cannot " +
          "guarantee it runs read-only. Use judge-free rules or a built-in adapter.",
      );
    },
    extractText: (stdout) => stdout,
    parseTokenUsage() {
      return undefined;
    },
  };
}

/** The built-in adapters, keyed by their `agent` name. */
const BUILTIN_ADAPTERS: Record<string, (files: string[]) => AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  opencode: opencodeAdapter,
  aider: aiderAdapter,
};

/** Names of every built-in agent, in adapter-registration order. */
export const BUILTIN_AGENT_NAMES = Object.keys(BUILTIN_ADAPTERS);

/** Wrap an adapter so `extraArgs` are appended to every command it builds. */
function withExtraArgs(adapter: AgentAdapter, extraArgs: string[]): AgentAdapter {
  if (extraArgs.length === 0) return adapter;
  return {
    ...adapter,
    buildCommand(prompt) {
      const spec = adapter.buildCommand(prompt);
      return { ...spec, args: [...spec.args, ...extraArgs] };
    },
    buildJudgeCommand(prompt) {
      const spec = adapter.buildJudgeCommand(prompt);
      return { ...spec, args: [...spec.args, ...extraArgs] };
    },
  };
}

/**
 * Resolve the configured agent to a concrete adapter. `extraArgs` (from
 * `agent_args`) are appended to every invocation of a built-in adapter, e.g.
 * `["--model", "ollama_chat/qwen"]`; they are ignored for the generic
 * command-template adapter, which bakes its arguments into the template.
 */
export function resolveAdapter(
  agent: string | { command: string },
  instructionFiles: string[],
  extraArgs: string[] = [],
): AgentAdapter {
  if (typeof agent === "object") {
    return genericAdapter(agent.command, instructionFiles);
  }
  const factory = BUILTIN_ADAPTERS[agent];
  if (factory) return withExtraArgs(factory(instructionFiles), extraArgs);
  throw new Error(
    `Unknown built-in agent "${agent}". Use one of ${BUILTIN_AGENT_NAMES.join(", ")}, ` +
      `or an object with a "command" template.`,
  );
}
