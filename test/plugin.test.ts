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

  it("keeps audit focused on configured baseline-vs-current evaluation", () => {
    const content = readFileSync("skills/audit/SKILL.md", "utf8");
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content);
    expect(frontmatter).not.toBeNull();
    const metadata = parse(frontmatter![1]!) as Record<string, unknown>;

    expect(metadata).toMatchObject({
      name: "audit",
      "disable-model-invocation": true,
    });
    expect(metadata.description).toEqual(expect.stringContaining("CLAUDE.md"));
    expect(content).toContain("optirule run --plan");
    expect(content).toContain("Read `max_tasks` and `reps` from `optirule.yml`");
    expect(content).toContain("explicit cheap-trial option");
    expect(content).toContain("internal `--yes` flag");
    expect(content).not.toContain("optirule run --ablate");
    expect(content).not.toContain("## export");
    expect(content).not.toContain("TODO");
  });

  it("ships a dedicated, approval-gated ablation skill", () => {
    const content = readFileSync("skills/ablate/SKILL.md", "utf8");
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content);
    expect(frontmatter).not.toBeNull();
    const metadata = parse(frontmatter![1]!) as Record<string, unknown>;

    expect(metadata).toMatchObject({
      name: "ablate",
      "disable-model-invocation": true,
    });
    expect(metadata.description).toEqual(expect.stringContaining("leave-one-section-out"));
    expect(content).toContain("optirule run --ablate --plan");
    expect(content).toContain("max_tasks");
    expect(content).toContain("reps");
    expect(content).toContain("--max-tasks 2 --reps 1");
    expect(content).toContain("internal `--yes`");
    expect(content).toContain("optirule export --compact");
    expect(content).toContain("schemaVersion: 2");
    expect(content).toContain("neutral");
    expect(content).toContain("inconclusive");
    expect(content).not.toContain("TODO");
  });
});
