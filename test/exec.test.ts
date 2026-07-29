import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { runSpec } from "../src/exec.js";

const SESSION_VARIABLES = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_EXECPATH",
] as const;

const originalEnvironment = new Map<string, string | undefined>();

afterEach(() => {
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  originalEnvironment.clear();
});

describe("runSpec", () => {
  it("isolates Claude children from the parent session and cleans their temp directory", async () => {
    for (const name of SESSION_VARIABLES) {
      originalEnvironment.set(name, process.env[name]);
      process.env[name] = `parent-${name}`;
    }

    const script = `
      console.log(JSON.stringify({
        markers: ${JSON.stringify(SESSION_VARIABLES)}.map((name) => process.env[name]),
        tempDir: process.env.CLAUDE_CODE_TMPDIR
      }));
    `;
    const result = await runSpec(
      {
        command: process.execPath,
        args: ["-e", script],
        isolateClaudeSession: true,
      },
      process.cwd(),
    );

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      markers: (string | null)[];
      tempDir: string;
    };
    expect(output.markers).toEqual([null, null, null, null]);
    expect(output.tempDir).toContain("optirule-claude-");
    expect(existsSync(output.tempDir)).toBe(false);
  });
});
