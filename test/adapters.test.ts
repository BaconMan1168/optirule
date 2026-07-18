import { describe, it, expect } from "vitest";
import { resolveAdapter } from "../src/adapters.js";

describe("claude adapter", () => {
  const adapter = resolveAdapter("claude", ["CLAUDE.md"]);

  it("runs headless with autonomous edits and json output", () => {
    const spec = adapter.buildCommand("fix the bug");
    expect(spec.command).toBe("claude");
    expect(spec.args).toEqual([
      "-p",
      "fix the bug",
      "--output-format",
      "json",
      "--permission-mode",
      "acceptEdits",
    ]);
  });

  it("sums token usage fields from json output", () => {
    const stdout = JSON.stringify({ usage: { input_tokens: 100, output_tokens: 40 } });
    expect(adapter.parseTokenUsage(stdout)).toBe(140);
  });

  it("returns undefined for unparseable output", () => {
    expect(adapter.parseTokenUsage("not json")).toBeUndefined();
  });
});

describe("generic adapter", () => {
  it("shell-quotes the interpolated prompt", () => {
    const adapter = resolveAdapter({ command: "aider --yes {prompt}" }, ["AGENTS.md"]);
    const spec = adapter.buildCommand("it's broken");
    expect(spec.shell).toBe(true);
    expect(spec.command).toBe("aider --yes 'it'\\''s broken'");
  });
});

describe("resolveAdapter", () => {
  it("rejects unknown built-in agents", () => {
    expect(() => resolveAdapter("nope", [])).toThrow(/Unknown built-in agent/);
  });
});
