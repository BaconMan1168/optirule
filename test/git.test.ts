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

  it("preserves non-ASCII filenames exactly, rather than git's quoted-octal form", async () => {
    writeFileSync(join(dir, "日本語.txt"), "x");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "add unicode file");
    const unicodeHead = git(dir, "rev-parse", "HEAD");

    const changed = await filesChangedBetween(head, unicodeHead, dir);
    expect(changed).toEqual(["日本語.txt"]);
  });

  it("reads a file's content at a ref", async () => {
    expect((await fileAtRef(head, "src.ts", dir))?.toString()).toBe("export const x = 2;\n");
    expect((await fileAtRef(parent, "src.ts", dir))?.toString()).toBe("export const x = 1;\n");
  });

  it("round-trips content that is not valid UTF-8, byte for byte", async () => {
    const bytes = Buffer.from([0x48, 0x69, 0xff, 0xfe, 0x0a]);
    writeFileSync(join(dir, "binary.bin"), bytes);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "add binary file");
    const binHead = git(dir, "rev-parse", "HEAD");

    expect(await fileAtRef(binHead, "binary.bin", dir)).toEqual(bytes);
  });

  it("returns undefined for a file absent at that ref", async () => {
    expect(await fileAtRef(parent, "test/x.test.ts", dir)).toBeUndefined();
  });

  it("rethrows when the ref itself is invalid, rather than treating it as a missing path", async () => {
    await expect(fileAtRef("not-a-real-branch", "src.ts", dir)).rejects.toThrow(
      /invalid object name/i,
    );
  });

  it("still returns undefined for a missing path when the caller's environment sets a non-English locale", async () => {
    // French is one of git's translated locales; if this system doesn't have it
    // installed, git silently falls back to English and the test is a no-op
    // assertion rather than a false pass — still valid, just less informative.
    const prevLang = process.env.LANG;
    const prevLanguage = process.env.LANGUAGE;
    const prevLcAll = process.env.LC_ALL;
    process.env.LANG = "fr_FR.UTF-8";
    process.env.LANGUAGE = "fr";
    process.env.LC_ALL = "fr_FR.UTF-8";
    try {
      expect(await fileAtRef(parent, "test/x.test.ts", dir)).toBeUndefined();
    } finally {
      if (prevLang === undefined) delete process.env.LANG;
      else process.env.LANG = prevLang;
      if (prevLanguage === undefined) delete process.env.LANGUAGE;
      else process.env.LANGUAGE = prevLanguage;
      if (prevLcAll === undefined) delete process.env.LC_ALL;
      else process.env.LC_ALL = prevLcAll;
    }
  });
});
