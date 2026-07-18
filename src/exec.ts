import { execa } from "execa";
import type { SpawnSpec } from "./adapters.js";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/** Run a spawn spec in `cwd`, never throwing on a non-zero exit. */
export async function runSpec(spec: SpawnSpec, cwd: string, timeoutMs?: number): Promise<ExecResult> {
  const start = Date.now();
  const result = await execa(spec.command, spec.args, {
    cwd,
    reject: false,
    shell: spec.shell ?? false,
    timeout: timeoutMs,
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs: Date.now() - start,
    timedOut: result.timedOut ?? false,
  };
}

/** Run a shell command string in `cwd`, never throwing on a non-zero exit. */
export function runShell(command: string, cwd: string, timeoutMs?: number): Promise<ExecResult> {
  return runSpec({ command, args: [], shell: true }, cwd, timeoutMs);
}
