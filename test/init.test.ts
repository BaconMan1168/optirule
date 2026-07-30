import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { runInit } from "../src/commands/init.js";

describe("runInit", () => {
  let repo: string | undefined;
  const originalExitCode = process.exitCode;

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
    if (repo) rmSync(repo, { recursive: true, force: true });
    repo = undefined;
  });

  it("writes only the context files selected by the user", async () => {
    repo = mkdtempSync(join(tmpdir(), "optirule-init-"));
    writeFileSync(join(repo, "CLAUDE.md"), "# Claude\n");
    writeFileSync(join(repo, "AGENTS.md"), "# Agents\n");
    const selectFiles = vi.fn().mockResolvedValue(["AGENTS.md"]);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runInit(repo, selectFiles);

    expect(selectFiles).toHaveBeenCalledWith(["CLAUDE.md", "AGENTS.md"]);
    expect(parse(readFileSync(join(repo, "optirule.yml"), "utf8"))).toMatchObject({
      instruction_files: ["AGENTS.md"],
    });
  });

  it("does not write a config when no context file is selected", async () => {
    repo = mkdtempSync(join(tmpdir(), "optirule-init-"));
    writeFileSync(join(repo, "CLAUDE.md"), "# Claude\n");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runInit(repo, async () => []);

    expect(existsSync(join(repo, "optirule.yml"))).toBe(false);
    expect(console.error).toHaveBeenCalledWith("Select at least one instruction file.");
  });
});
