import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExport, isDroppable } from "../src/commands/export.js";
import { parseSections } from "../src/sections.js";
import type { AblationClassification, SectionAblation } from "../src/analyze.js";

const CLAUDE = "# Title\nintro\n## Keep\nload bearing\n## Drop\ndead weight";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function section(
  title: string,
  classification: AblationClassification,
  content = CLAUDE,
): SectionAblation {
  const parsed = parseSections(content, "CLAUDE.md").find((candidate) => candidate.title === title)!;
  return {
    variant: `ablate-${title.toLowerCase()}`,
    file: "CLAUDE.md",
    title,
    startLine: parsed.startLine,
    endLine: parsed.endLine,
    passRate: { current: 1, ablated: 1, change: 0, confidenceInterval: [0, 0] },
    mistakes: { current: 0, ablated: 0, change: 0, confidenceInterval: [0, 0] },
    compliance: {},
    tokens: {},
    runtimeMs: { current: 10, ablated: 10, change: 0, confidenceInterval: [0, 0] },
    churn: { current: 1, ablated: 1, change: 0, confidenceInterval: [0, 0] },
    toolCalls: {},
    filesRead: {},
    staticTokensRemoved: parsed.tokens,
    currentRuns: 5,
    ablatedRuns: 5,
    pairedRuns: 5,
    confidence: classification === "inconclusive" ? "low" : "sufficient",
    classification,
  };
}

function seed(dir: string, sections: SectionAblation[], content = CLAUDE): void {
  writeFileSync(join(dir, "optirule.yml"), "agent: claude\ninstruction_files:\n  - CLAUDE.md\n");
  writeFileSync(join(dir, "CLAUDE.md"), content);
  mkdirSync(join(dir, ".optirule"), { recursive: true });
  writeFileSync(
    join(dir, ".optirule/analysis.json"),
    JSON.stringify({
      schemaVersion: 2,
      ablation: {
        valid: true,
        planFingerprint: "plan",
        instructionFileHashes: { "CLAUDE.md": hash(content) },
        sections,
      },
    }),
  );
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

  it("requires compact mode", () => {
    seed(dir, [section("Drop", "neutral")]);
    expect(() => runExport(dir, {})).toThrow(/--compact/);
  });

  it("refuses export when no valid ablation data exists", () => {
    writeFileSync(join(dir, "optirule.yml"), "agent: claude\ninstruction_files:\n  - CLAUDE.md\n");
    writeFileSync(join(dir, "CLAUDE.md"), CLAUDE);
    expect(() => runExport(dir, { compact: true })).toThrow(/valid ablation run/);
  });

  it("drops only confidently neutral or harmful sections", () => {
    seed(dir, [section("Keep", "helpful"), section("Drop", "neutral")]);
    runExport(dir, { compact: true });
    const out = readFileSync(join(dir, "CLAUDE.compact.md"), "utf8");
    expect(out).toContain("## Keep");
    expect(out).not.toContain("## Drop");
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(CLAUDE);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Removed "Drop": neutral'));
  });

  it("preserves low-confidence sections", () => {
    seed(dir, [section("Drop", "inconclusive")]);
    runExport(dir, { compact: true });
    expect(readFileSync(join(dir, "CLAUDE.compact.md"), "utf8")).toContain("## Drop");
  });

  it("honors a custom output path", () => {
    seed(dir, [section("Drop", "harmful")]);
    runExport(dir, { compact: true, out: "trimmed.md" });
    expect(readFileSync(join(dir, "trimmed.md"), "utf8")).not.toContain("## Drop");
  });

  it("refuses to overwrite the original through an equivalent path", () => {
    seed(dir, [section("Drop", "neutral")]);
    expect(() => runExport(dir, { compact: true, out: "./CLAUDE.md" })).toThrow(
      /Refusing to overwrite/,
    );
  });

  it("refuses stale ablation evidence after the source changes", () => {
    seed(dir, [section("Drop", "neutral")]);
    writeFileSync(join(dir, "CLAUDE.md"), `${CLAUDE}\nchanged`);
    expect(() => runExport(dir, { compact: true })).toThrow(/changed after the ablation run/);
    expect(existsSync(join(dir, "CLAUDE.compact.md"))).toBe(false);
  });
});

describe("isDroppable", () => {
  it("drops only confident neutrality or harm", () => {
    expect(isDroppable("neutral")).toBe(true);
    expect(isDroppable("harmful")).toBe(true);
    expect(isDroppable("helpful")).toBe(false);
    expect(isDroppable("inconclusive")).toBe(false);
  });
});
