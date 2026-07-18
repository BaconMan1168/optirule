import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { detectInstalledAgents, chooseAgent } from "../src/detect.js";

describe("detectInstalledAgents", () => {
  let binDir: string;

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "optirule-bin-"));
  });
  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  function installFakeBinary(name: string): void {
    const path = join(binDir, name);
    writeFileSync(path, "#!/bin/sh\n");
    chmodSync(path, 0o755);
  }

  it("finds built-in agents present on PATH, in registration order", () => {
    installFakeBinary("aider");
    installFakeBinary("claude");
    expect(detectInstalledAgents(binDir)).toEqual(["claude", "aider"]);
  });

  it("returns nothing when no agent CLI is on PATH", () => {
    expect(detectInstalledAgents(binDir)).toEqual([]);
  });

  it("searches every PATH entry", () => {
    const other = mkdtempSync(join(tmpdir(), "optirule-bin2-"));
    try {
      writeFileSync(join(other, "codex"), "#!/bin/sh\n");
      chmodSync(join(other, "codex"), 0o755);
      expect(detectInstalledAgents([binDir, other].join(delimiter))).toEqual(["codex"]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("chooseAgent", () => {
  it("prefers the runner we are invoked from", () => {
    expect(chooseAgent(["AGENTS.md"], ["codex"], "claude")).toBe("claude");
  });

  it("prefers an installed agent whose default instruction file is present", () => {
    expect(chooseAgent(["AGENTS.md"], ["claude", "codex"], undefined)).toBe("codex");
  });

  it("falls back to the first installed agent when no file matches", () => {
    expect(chooseAgent([".cursorrules"], ["aider", "gemini"], undefined)).toBe("aider");
  });

  it("defaults to claude when nothing is installed", () => {
    expect(chooseAgent(["CLAUDE.md"], [], undefined)).toBe("claude");
  });
});
