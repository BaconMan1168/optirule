import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { BUILTIN_AGENT_NAMES } from "./adapters.js";

/** Instruction files optirule knows how to detect, in priority order. */
const KNOWN_INSTRUCTION_FILES = [
  "CLAUDE.md",
  ".claude/CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  "CONVENTIONS.md",
  ".cursorrules",
];

/** The instruction file each built-in agent reads by default. */
const AGENT_DEFAULT_FILE: Record<string, string> = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  gemini: "GEMINI.md",
  opencode: "AGENTS.md",
  aider: "CONVENTIONS.md",
};

/** Return the known instruction files that exist in a repo directory. */
export function detectInstructionFiles(dir: string): string[] {
  return KNOWN_INSTRUCTION_FILES.filter((f) => existsSync(`${dir}/${f}`));
}

/** True if an executable file named `bin` exists in any PATH directory. */
function onPath(bin: string, pathEnv: string): boolean {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (statSync(join(dir, bin + ext)).isFile()) return true;
      } catch {
        // Not in this directory; keep looking.
      }
    }
  }
  return false;
}

/** Built-in agents whose CLI is installed on PATH, in registration order. */
export function detectInstalledAgents(pathEnv: string = process.env.PATH ?? ""): string[] {
  return BUILTIN_AGENT_NAMES.filter((name) => onPath(name, pathEnv));
}

/**
 * Detect the agent runner from the environment, when optirule is invoked from
 * within one. Returns undefined when nothing recognizable is set.
 */
export function detectAgent(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDECODE) return "claude";
  return undefined;
}

/**
 * Pick the agent to scaffold into optirule.yml. The runner we are invoked from
 * wins (we're literally running inside it); otherwise prefer an installed CLI
 * whose default instruction file is present, then any installed CLI, and fall
 * back to `claude` when nothing is detected.
 */
export function chooseAgent(
  detectedFiles: string[],
  installed: string[],
  envAgent: string | undefined,
): string {
  if (envAgent) return envAgent;
  const byFile = installed.find((a) => detectedFiles.includes(AGENT_DEFAULT_FILE[a]!));
  if (byFile) return byFile;
  return installed[0] ?? "claude";
}
