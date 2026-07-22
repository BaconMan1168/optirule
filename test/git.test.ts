import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filesChangedBetween, fileAtRef } from "../src/git.js";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
}

describe("git ref helpers", () => {
  let dir: string;
  let parent: string;
  let head: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "optirule-git-"));
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@t.co");
    git(dir, "config", "user.name", "t");
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(join(dir, "src.ts"), "export const x = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "init");
    parent = git(dir, "rev-parse", "HEAD");

    writeFileSync(join(dir, "src.ts"), "export const x = 2;\n");
    writeFileSync(join(dir, "test/x.test.ts"), "assert(x === 2);\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "fix: correct x");
    head = git(dir, "rev-parse", "HEAD");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lists files changed between two commits", async () => {
    const changed = await filesChangedBetween(parent, head, dir);
    expect(changed.sort()).toEqual(["src.ts", "test/x.test.ts"]);
  });

  it("reads a file's content at a ref", async () => {
    expect(await fileAtRef(head, "src.ts", dir)).toBe("export const x = 2;\n");
    expect(await fileAtRef(parent, "src.ts", dir)).toBe("export const x = 1;\n");
  });

  it("returns undefined for a file absent at that ref", async () => {
    expect(await fileAtRef(parent, "test/x.test.ts", dir)).toBeUndefined();
  });
});
