import { describe, it, expect } from "vitest";
import { resolveAdapter } from "../src/adapters.js";

describe("claude adapter", () => {
  const adapter = resolveAdapter("claude", ["CLAUDE.md"]);

  it("runs headless with autonomous edits and streaming json output", () => {
    const spec = adapter.buildCommand("fix the bug");
    expect(spec.command).toBe("claude");
    expect(spec.args).toEqual([
      "-p",
      "fix the bug",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
    ]);
  });

  it("sums token usage fields from the final result event", () => {
    const stdout = [
      `{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}`,
      `{"type":"result","usage":{"input_tokens":100,"output_tokens":40,"cache_read_input_tokens":10}}`,
    ].join("\n");
    expect(adapter.parseTokenUsage(stdout)).toBe(150);
  });

  it("returns undefined for unparseable output", () => {
    expect(adapter.parseTokenUsage("not json")).toBeUndefined();
  });

  it("lists files read via Read tool calls", () => {
    const stdout = [
      `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"src/a.ts"}}]}}`,
      `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"src/b.ts"}},{"type":"tool_use","name":"Edit","input":{"file_path":"src/a.ts"}}]}}`,
      `{"type":"result","usage":{"input_tokens":1}}`,
    ].join("\n");
    expect(adapter.parseFilesRead?.(stdout)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("codex adapter", () => {
  const adapter = resolveAdapter("codex", ["AGENTS.md"]);

  it("runs exec non-interactively with workspace-write sandbox and json output", () => {
    const spec = adapter.buildCommand("fix the bug");
    expect(spec.command).toBe("codex");
    expect(spec.args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "fix the bug",
    ]);
  });

  it("sums input and output tokens from the turn.completed event", () => {
    const stdout = [
      `{"type":"turn.started"}`,
      `{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122,"reasoning_output_tokens":0}}`,
    ].join("\n");
    expect(adapter.parseTokenUsage(stdout)).toBe(24885);
  });

  it("returns undefined when no usage is present", () => {
    expect(adapter.parseTokenUsage(`{"type":"turn.started"}`)).toBeUndefined();
  });
});

describe("gemini adapter", () => {
  const adapter = resolveAdapter("gemini", ["GEMINI.md"]);

  it("runs headless with yolo auto-approve and json output", () => {
    const spec = adapter.buildCommand("fix the bug");
    expect(spec.command).toBe("gemini");
    expect(spec.args).toEqual(["-p", "fix the bug", "--output-format", "json", "--yolo"]);
  });

  it("sums per-model total tokens from stats", () => {
    const stdout = JSON.stringify({
      stats: {
        models: {
          "gemini-2.5-pro": {
            tokens: { prompt: 24939, candidates: 20, total: 25113, cached: 21263, thoughts: 154, tool: 0 },
          },
        },
      },
    });
    expect(adapter.parseTokenUsage(stdout)).toBe(25113);
  });

  it("returns undefined for unparseable output", () => {
    expect(adapter.parseTokenUsage("boom")).toBeUndefined();
  });
});

describe("opencode adapter", () => {
  const adapter = resolveAdapter("opencode", ["AGENTS.md"]);

  it("runs a single prompt with json output", () => {
    const spec = adapter.buildCommand("fix the bug");
    expect(spec.command).toBe("opencode");
    expect(spec.args).toEqual(["run", "fix the bug", "--format", "json"]);
  });

  it("sums tokens from the last assistant message part", () => {
    const stdout = [
      `{"type":"message","tokens":{"input":10,"output":5,"reasoning":0,"cache":{"read":0,"write":0}}}`,
      `{"type":"message","tokens":{"input":100,"output":40,"reasoning":8,"cache":{"read":90,"write":0}}}`,
    ].join("\n");
    expect(adapter.parseTokenUsage(stdout)).toBe(148);
  });

  it("returns undefined when no tokens are present", () => {
    expect(adapter.parseTokenUsage(`{"type":"message"}`)).toBeUndefined();
  });
});

describe("aider adapter", () => {
  const adapter = resolveAdapter("aider", ["CONVENTIONS.md"]);

  it("runs a one-shot message without auto-commits", () => {
    const spec = adapter.buildCommand("fix the bug");
    expect(spec.command).toBe("aider");
    expect(spec.args).toEqual([
      "--yes-always",
      "--no-auto-commits",
      "--message",
      "fix the bug",
    ]);
  });

  it("sums sent and received tokens from the last Tokens line", () => {
    const stdout = [
      "Tokens: 1.0k sent, 50 received.",
      "Tokens: 2.7k sent, 290 received. Cost: $0.01 message, $0.01 session.",
    ].join("\n");
    expect(adapter.parseTokenUsage(stdout)).toBe(2990);
  });

  it("returns undefined when no Tokens line is present", () => {
    expect(adapter.parseTokenUsage("done")).toBeUndefined();
  });

  it("lists files added to the chat", () => {
    const stdout = ["Added src/foo.ts to the chat.", "Added src/bar.ts to the chat."].join("\n");
    expect(adapter.parseFilesRead?.(stdout)).toEqual(["src/foo.ts", "src/bar.ts"]);
  });
});

describe("claude transcript parsing", () => {
  const stdout = [
    JSON.stringify({ message: { content: [
      { type: "tool_use", name: "Bash", input: { command: "npm test" } },
      { type: "tool_use", name: "Read", input: { file_path: "src/a.ts" } },
    ] } }),
    JSON.stringify({ message: { content: [
      { type: "tool_use", name: "Bash", input: { command: "git status" } },
    ] } }),
  ].join("\n");

  it("lists the shell commands the agent ran", () => {
    expect(resolveAdapter("claude", ["CLAUDE.md"]).parseCommands!(stdout)).toEqual([
      "npm test",
      "git status",
    ]);
  });

  it("counts every tool call", () => {
    expect(resolveAdapter("claude", ["CLAUDE.md"]).parseToolCalls!(stdout)).toBe(3);
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

  it("appends agent_args to a built-in adapter's command", () => {
    const adapter = resolveAdapter("aider", ["CONVENTIONS.md"], ["--model", "ollama_chat/qwen"]);
    const spec = adapter.buildCommand("fix it");
    expect(spec.command).toBe("aider");
    expect(spec.args).toEqual([
      "--yes-always",
      "--no-auto-commits",
      "--message",
      "fix it",
      "--model",
      "ollama_chat/qwen",
    ]);
  });

  it("leaves token parsing intact when extra args are appended", () => {
    const adapter = resolveAdapter("aider", ["CONVENTIONS.md"], ["--model", "openai/x"]);
    expect(adapter.parseTokenUsage("Tokens: 2.0k sent, 500 received.")).toBe(2500);
  });

  it("ignores empty agent_args", () => {
    const plain = resolveAdapter("aider", ["CONVENTIONS.md"]);
    const withEmpty = resolveAdapter("aider", ["CONVENTIONS.md"], []);
    expect(withEmpty.buildCommand("x").args).toEqual(plain.buildCommand("x").args);
  });
});
