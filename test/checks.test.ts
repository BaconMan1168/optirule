import { describe, it, expect } from "vitest";
import {
  globToRegExp,
  checkFilesTouched,
  checkCommandUsed,
  checkPublicApiPreserved,
  checkNoNewEnvVars,
} from "../src/checks.js";
import type { RunContext } from "../src/checks.js";

function ctx(overrides: Partial<RunContext> = {}): RunContext {
  return { filesChanged: [], diff: "", commands: [], timedOut: false, ...overrides };
}

describe("globToRegExp", () => {
  it("matches ** across directory separators", () => {
    expect(globToRegExp("dist/**").test("dist/a/b.js")).toBe(true);
    expect(globToRegExp("dist/**").test("src/a.js")).toBe(false);
  });
  it("keeps * within a single segment", () => {
    expect(globToRegExp("*.lock").test("pnpm.lock")).toBe(true);
    expect(globToRegExp("*.lock").test("sub/pnpm.lock")).toBe(false);
  });
  it("escapes regex metacharacters", () => {
    expect(globToRegExp("a.b").test("a.b")).toBe(true);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
  });
});

describe("checkFilesTouched", () => {
  it("is not-applicable without changes", () => {
    expect(checkFilesTouched({ kind: "files-touched", forbid: ["dist/**"] }, ctx())).toBe("not-applicable");
  });
  it("rejects forbidden and out-of-allowlist paths", () => {
    expect(checkFilesTouched({ kind: "files-touched", forbid: ["dist/**"] }, ctx({ filesChanged: ["dist/a.js"] }))).toBe("violated");
    expect(checkFilesTouched({ kind: "files-touched", allow: ["src/**"] }, ctx({ filesChanged: ["scripts/a.sh"] }))).toBe("violated");
  });
  it("follows an allowlist when every change matches", () => {
    expect(checkFilesTouched({ kind: "files-touched", allow: ["src/**"] }, ctx({ filesChanged: ["src/a.ts"] }))).toBe("followed");
  });
});

describe("checkCommandUsed", () => {
  it("is not-applicable without visible commands", () => {
    expect(checkCommandUsed({ kind: "command-used", require: "npm test" }, ctx())).toBe("not-applicable");
  });
  it("requires the configured substring", () => {
    expect(checkCommandUsed({ kind: "command-used", require: "npm test" }, ctx({ commands: ["npm test -- --run"] }))).toBe("followed");
    expect(checkCommandUsed({ kind: "command-used", require: "npm test" }, ctx({ commands: ["npx jest"] }))).toBe("violated");
  });
  it("lets a banned command override a required command", () => {
    expect(checkCommandUsed({ kind: "command-used", require: "npm test", banned: ["jest"] }, ctx({ commands: ["npm test", "npx jest"] }))).toBe("violated");
  });
});

describe("checkPublicApiPreserved", () => {
  it("is not-applicable when no export is removed", () => {
    expect(checkPublicApiPreserved(ctx({ diff: "+export function added() {}\n" }))).toBe("not-applicable");
  });
  it("detects a removed exported signature", () => {
    expect(checkPublicApiPreserved(ctx({ diff: "-export function gone() {}\n+function gone() {}\n" }))).toBe("violated");
  });
  it("accepts an export line re-added verbatim", () => {
    expect(checkPublicApiPreserved(ctx({ diff: "-export function same() {}\n+export function same() {}\n" }))).toBe("followed");
  });
});

describe("checkNoNewEnvVars", () => {
  it("is not-applicable without environment reads", () => {
    expect(checkNoNewEnvVars(ctx({ diff: "+const x = 1;\n" }))).toBe("not-applicable");
  });
  it("detects new dot, bracket, and import.meta names", () => {
    expect(checkNoNewEnvVars(ctx({ diff: "+process.env.NEW_KEY\n" }))).toBe("violated");
    expect(checkNoNewEnvVars(ctx({ diff: "+process.env['NEW_ONE']\n+import.meta.env.ALSO_NEW\n" }))).toBe("violated");
  });
  it("accepts names already present in removed lines", () => {
    expect(checkNoNewEnvVars(ctx({ diff: "-process.env.API_KEY\n+process.env.API_KEY ?? ''\n" }))).toBe("followed");
  });
});
