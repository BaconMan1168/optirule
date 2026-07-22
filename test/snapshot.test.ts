import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshot, destroySnapshot } from "../src/snapshot.js";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
}

describe("createSnapshot", () => {
  let repo: string;
  let snap: string;
  let parent: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "optirule-repo-"));
    snap = join(mkdtempSync(join(tmpdir(), "optirule-snap-")), "work");
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t.co");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "a.txt"), "before\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "first");
    parent = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "a.txt"), "after\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "SECRET FUTURE FIX");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(snap, { recursive: true, force: true });
  });

  it("materialises the tree at the requested ref", async () => {
    await createSnapshot(repo, parent, snap);
    expect(readFileSync(join(snap, "a.txt"), "utf8")).toBe("before\n");
  });

  it("hides all future history from the snapshot", async () => {
    await createSnapshot(repo, parent, snap);
    const log = git(snap, "log", "--all", "--oneline");
    expect(log).not.toContain("SECRET FUTURE FIX");
    expect(log.split("\n")).toHaveLength(1);
  });

  it("supports git diff so changed files can be measured", async () => {
    await createSnapshot(repo, parent, snap);
    writeFileSync(join(snap, "a.txt"), "agent edit\n");
    expect(git(snap, "diff", "--name-only")).toBe("a.txt");
  });

  it("destroys the snapshot directory", async () => {
    await createSnapshot(repo, parent, snap);
    destroySnapshot(snap);
    expect(existsSync(snap)).toBe(false);
  });
});
