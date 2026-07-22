import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTestPatch } from "../src/runner.js";

describe("applyTestPatch", () => {
  it("writes each test file, creating missing directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-patch-apply-"));
    try {
      applyTestPatch(dir, [{ path: "test/deep/a.test.ts", content: Buffer.from("expect(1)") }]);
      expect(readFileSync(join(dir, "test/deep/a.test.ts"), "utf8")).toBe("expect(1)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("overwrites a stale version of the same test", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-patch-apply-"));
    try {
      writeFileSync(join(dir, "a.test.ts"), "old");
      applyTestPatch(dir, [{ path: "a.test.ts", content: Buffer.from("new") }]);
      expect(readFileSync(join(dir, "a.test.ts"), "utf8")).toBe("new");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op for an empty patch", () => {
    const dir = mkdtempSync(join(tmpdir(), "optirule-patch-apply-"));
    try {
      expect(() => applyTestPatch(dir, [])).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
