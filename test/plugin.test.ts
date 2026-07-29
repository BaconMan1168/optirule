import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("Claude Code plugin", () => {
  it("keeps package, plugin, and marketplace versions aligned", () => {
    const pkg = json("package.json");
    const plugin = json(".claude-plugin/plugin.json");
    const marketplace = json(".claude-plugin/marketplace.json");
    const entries = marketplace.plugins as Record<string, unknown>[];

    expect(plugin.version).toBe(pkg.version);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "optirule",
      source: ".",
      version: pkg.version,
    });
  });

  it("ships a complete, user-invoked audit skill with cost gating", () => {
    const content = readFileSync("skills/audit/SKILL.md", "utf8");
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content);
    expect(frontmatter).not.toBeNull();
    const metadata = parse(frontmatter![1]!) as Record<string, unknown>;

    expect(metadata).toMatchObject({
      name: "audit",
      "disable-model-invocation": true,
    });
    expect(metadata.description).toEqual(expect.stringContaining("CLAUDE.md"));
    expect(content).toContain("run --max-tasks 2 --reps 1 --plan");
    expect(content).toContain("without `--plan` and with `--yes`");
    expect(content).not.toContain("TODO");
  });
});
