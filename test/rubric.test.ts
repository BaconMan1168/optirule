import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRubric, saveRubric, RUBRIC_FILENAME } from "../src/rubric.js";
import type { Rubric } from "../src/rubric.js";

const sample: Rubric = {
  rules: [{ id: "test-command", file: "CLAUDE.md", section: "Testing", text: "Always run tests with `npm test`", check: { kind: "command-used", require: "npm test" } }],
  unmeasurable: [{ file: "CLAUDE.md", section: "Philosophy", text: "Be an expert engineer", reason: "not an instruction" }],
  conflicts: [],
};

describe("rubric persistence", () => {
  it("round-trips through YAML", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-rubric-"));
    try {
      saveRubric(dir, sample);
      expect(existsSync(join(dir, RUBRIC_FILENAME))).toBe(true);
      expect(loadRubric(dir)).toEqual(sample);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("returns undefined when no rubric exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-rubric-"));
    try { expect(loadRubric(dir)).toBeUndefined(); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("defaults missing sections so a hand-edited rubric still loads", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-rubric-"));
    try {
      writeFileSync(join(dir, RUBRIC_FILENAME), "rules: []\n");
      expect(loadRubric(dir)).toEqual({ rules: [], unmeasurable: [], conflicts: [] });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
