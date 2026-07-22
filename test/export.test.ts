import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExport, isDroppable } from "../src/commands/export.js";
import type { Analysis, SectionCompliance, SectionSignal } from "../src/analyze.js";

const CLAUDE = "# Title\nintro\n## Keep\nload bearing\n## Drop\ndead weight";

function section(title: string, signal: SectionSignal): SectionCompliance {
  return {
    file: "CLAUDE.md",
    title,
    mistakesAvoided: 0,
    tasksImproved: 0,
    applicableRuns: signal === "never-exercised" ? 0 : 6,
    signal,
  };
}

function seed(dir: string, sections: SectionCompliance[]): void {
  writeFileSync(join(dir, "optirule.yml"), "agent: claude\ninstruction_files:\n  - CLAUDE.md\n");
  writeFileSync(join(dir, "CLAUDE.md"), CLAUDE);
  mkdirSync(join(dir, ".optirule"), { recursive: true });
  const analysis = { compliance: { sections } } as unknown as Analysis;
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
    seed(dir, [section("Drop", "redundant")]);
    expect(() => runExport(dir, {})).toThrow(/only supported mode/);
  });

  it("errors when no ablation data exists", () => {
    writeFileSync(join(dir, "optirule.yml"), "agent: claude\ninstruction_files:\n  - CLAUDE.md\n");
    writeFileSync(join(dir, "CLAUDE.md"), CLAUDE);
    expect(() => runExport(dir, { minimal: true })).toThrow(/optirule lint/);
  });

  it("drops inert and harmful sections but keeps load-bearing ones", () => {
    seed(dir, [section("Keep", "earns-its-keep"), section("Drop", "redundant")]);
    runExport(dir, { minimal: true });
    const out = readFileSync(join(dir, "CLAUDE.optirule.md"), "utf8");
    expect(out).toContain("## Keep");
    expect(out).not.toContain("## Drop");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true); // original untouched
  });

  it("honors a custom --out path", () => {
    seed(dir, [section("Drop", "harmful")]);
    runExport(dir, { minimal: true, out: "trimmed.md" });
    expect(readFileSync(join(dir, "trimmed.md"), "utf8")).not.toContain("## Drop");
  });
});

describe("isDroppable", () => {
  it("drops only demonstrated redundancy or harm", () => {
    expect(isDroppable("redundant")).toBe(true);
    expect(isDroppable("harmful")).toBe(true);
  });
  it("protects load-bearing, one-task, and never-exercised sections", () => {
    expect(isDroppable("earns-its-keep")).toBe(false);
    expect(isDroppable("single-task-signal")).toBe(false);
    expect(isDroppable("never-exercised")).toBe(false);
  });
});
