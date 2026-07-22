import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createSnapshot, destroySnapshot, stageDependencies } from "../src/snapshot.js";

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

describe("stageDependencies + createSnapshot node_modules handling", () => {
  let repo: string;
  let session: string;
  let snap: string;
  let parent: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "optirule-repo-"));
    session = mkdtempSync(join(tmpdir(), "optirule-session-"));
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
    rmSync(session, { recursive: true, force: true });
    rmSync(snap, { recursive: true, force: true });
  });

  it("closes the node_modules/.. traversal to the parent repo's history", async () => {
    mkdirSync(join(repo, "node_modules"));
    writeFileSync(join(repo, "node_modules", "marker.txt"), "dep\n");

    const modulesDir = stageDependencies(repo, session);
    expect(modulesDir).toBe(join(session, "node_modules"));

    await createSnapshot(repo, parent, snap, modulesDir);

    // Resolving node_modules/.. must land in the session dir (where the
    // staged copy lives), never in the parent repo.
    const resolvedParent = dirname(realpathSync(join(snap, "node_modules")));
    expect(resolvedParent).toBe(realpathSync(session));
    expect(resolvedParent).not.toBe(realpathSync(repo));

    // The distinctive future content and the parent's .git must not be
    // reachable by walking up through the symlink. Built by raw string
    // concatenation, not path.join: path.join collapses "node_modules/.."
    // lexically before the OS ever sees it, which would make this assertion
    // pass without actually exercising symlink resolution.
    expect(existsSync(`${snap}/node_modules/../.git`)).toBe(false);
    expect(existsSync(`${snap}/node_modules/../a.txt`)).toBe(false);

    // Reproduce the reviewer's exact repro: `git -C node_modules/.. log` must
    // not reach a git repository at all (it should fail outright), and must
    // never show the future commit either way.
    let gitLogOutput: string;
    try {
      gitLogOutput = execFileSync(
        "sh",
        ["-c", `git -C ${snap}/node_modules/.. log --oneline --all 2>&1`],
        { cwd: snap },
      ).toString();
    } catch (e) {
      gitLogOutput = String((e as { stdout?: Buffer }).stdout ?? e);
    }
    expect(gitLogOutput).not.toContain("SECRET FUTURE FIX");
  });

  it("creates no node_modules entry when modulesDir is omitted", async () => {
    await createSnapshot(repo, parent, snap);
    expect(existsSync(join(snap, "node_modules"))).toBe(false);
  });

  it("keeps node_modules invisible to git status and diff inside the snapshot", async () => {
    mkdirSync(join(repo, "node_modules"));
    writeFileSync(join(repo, "node_modules", "marker.txt"), "dep\n");
    const modulesDir = stageDependencies(repo, session);

    await createSnapshot(repo, parent, snap, modulesDir);

    expect(git(snap, "status", "--porcelain")).toBe("");
    expect(git(snap, "diff", "--name-only")).toBe("");
  });

  it("does not delete the staged dependency copy when destroying a snapshot", async () => {
    mkdirSync(join(repo, "node_modules"));
    writeFileSync(join(repo, "node_modules", "marker.txt"), "dep\n");
    const modulesDir = stageDependencies(repo, session)!;

    await createSnapshot(repo, parent, snap, modulesDir);
    destroySnapshot(snap);

    expect(existsSync(join(modulesDir, "marker.txt"))).toBe(true);
  });

  it("stages dependencies once per session and returns undefined without node_modules", () => {
    expect(stageDependencies(repo, session)).toBeUndefined();

    mkdirSync(join(repo, "node_modules"));
    writeFileSync(join(repo, "node_modules", "marker.txt"), "dep\n");
    const first = stageDependencies(repo, session);
    expect(first).toBe(join(session, "node_modules"));
    expect(readFileSync(join(first!, "marker.txt"), "utf8")).toBe("dep\n");

    // Idempotent: a second call reuses the existing staged copy rather than
    // re-copying, even if the source has since changed.
    writeFileSync(join(repo, "node_modules", "marker.txt"), "changed\n");
    const second = stageDependencies(repo, session);
    expect(second).toBe(first);
    expect(readFileSync(join(second!, "marker.txt"), "utf8")).toBe("dep\n");
  });

  it("has no alternates file, so the object database cannot be extended", async () => {
    await createSnapshot(repo, parent, snap);
    expect(existsSync(join(snap, ".git", "objects", "info", "alternates"))).toBe(false);
  });
});
