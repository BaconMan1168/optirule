import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExport } from "../src/commands/export.js";
import type { Analysis, SectionImpact } from "../src/analyze.js";

const CLAUDE = "# Title\nintro\n## Keep\nload bearing\n## Drop\ndead weight";

function impact(title: string, signal: SectionImpact["signal"]): SectionImpact {
  return {
    file: "CLAUDE.md",
    title,
    staticTokens: 100,
    tokenImpact: 0,
    ablatedRuns: 6,
    tokenShare: 0.5,
    signal,
  };
}

function seed(dir: string, impacts: SectionImpact[]): void {
  writeFileSync(join(dir, "optirule.yml"), "agent: claude\ninstruction_files:\n  - CLAUDE.md\n");
  writeFileSync(join(dir, "CLAUDE.md"), CLAUDE);
  mkdirSync(join(dir, ".optirule"), { recursive: true });
  const analysis = { sectionImpacts: impacts } as unknown as Analysis;
  writeFileSync(join(dir, ".optirule/analysis.json"), JSON.stringify(analysis));
}

describe("runExport", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "optirule-export-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("requires --minimal", () => {
    seed(dir, [impact("Drop", "no-measurable-impact")]);
    expect(() => runExport(dir, {})).toThrow(/only supported mode/);
  });

  it("errors when no ablation data exists", () => {
    writeFileSync(join(dir, "optirule.yml"), "agent: claude\ninstruction_files:\n  - CLAUDE.md\n");
    writeFileSync(join(dir, "CLAUDE.md"), CLAUDE);
    expect(() => runExport(dir, { minimal: true })).toThrow(/optirule run --ablate/);
  });

  it("drops inert and harmful sections but keeps load-bearing ones", () => {
    seed(dir, [impact("Keep", "earns-its-keep"), impact("Drop", "no-measurable-impact")]);
    runExport(dir, { minimal: true });
    const out = readFileSync(join(dir, "CLAUDE.optirule.md"), "utf8");
    expect(out).toContain("## Keep");
    expect(out).not.toContain("## Drop");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true); // original untouched
  });

  it("honors a custom --out path", () => {
    seed(dir, [impact("Drop", "actively-hurts")]);
    runExport(dir, { minimal: true, out: "trimmed.md" });
    expect(readFileSync(join(dir, "trimmed.md"), "utf8")).not.toContain("## Drop");
  });
});
