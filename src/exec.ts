import { execa } from "execa";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnSpec } from "./adapters.js";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

const CLAUDE_SESSION_VARIABLES = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_FORCE_SESSION_PERSISTENCE",
  "CLAUDE_PID",
] as const;

/** Copy the parent environment without markers that make Claude reject nesting. */
function isolatedClaudeEnvironment(tempDir: string): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  for (const name of CLAUDE_SESSION_VARIABLES) delete env[name];
  env.CLAUDE_CODE_TMPDIR = tempDir;
  return env;
}

/** Run a spawn spec in `cwd`, never throwing on a non-zero exit. */
export async function runSpec(spec: SpawnSpec, cwd: string, timeoutMs?: number): Promise<ExecResult> {
  const start = Date.now();
  const claudeTempDir = spec.isolateClaudeSession
    ? mkdtempSync(join(tmpdir(), "optirule-claude-"))
    : undefined;
  try {
    const result = await execa(spec.command, spec.args, {
      cwd,
      reject: false,
      shell: spec.shell ?? false,
      timeout: timeoutMs,
      env: claudeTempDir ? isolatedClaudeEnvironment(claudeTempDir) : undefined,
      extendEnv: claudeTempDir ? false : true,
    });
    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      durationMs: Date.now() - start,
      timedOut: result.timedOut ?? false,
    };
  } finally {
    if (claudeTempDir) rmSync(claudeTempDir, { recursive: true, force: true });
  }
}

/** Run a shell command string in `cwd`, never throwing on a non-zero exit. */
export function runShell(command: string, cwd: string, timeoutMs?: number): Promise<ExecResult> {
  return runSpec({ command, args: [], shell: true }, cwd, timeoutMs);
}
