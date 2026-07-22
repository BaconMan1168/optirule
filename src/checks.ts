import type { Check } from "./rubric.js";
import type { Verdict } from "./types.js";

export interface RunContext {
  filesChanged: string[];
  diff: string;
  commands: string[];
  timedOut: boolean;
}

export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

export function checkFilesTouched(check: Check, ctx: RunContext): Verdict {
  if (ctx.filesChanged.length === 0) return "not-applicable";
  if (check.forbid?.length && ctx.filesChanged.some((file) => matchesAny(file, check.forbid!))) {
    return "violated";
  }
  if (check.allow?.length && !ctx.filesChanged.every((file) => matchesAny(file, check.allow!))) {
    return "violated";
  }
  return "followed";
}

export function checkCommandUsed(check: Check, ctx: RunContext): Verdict {
  if (ctx.commands.length === 0) return "not-applicable";
  if (check.banned?.length) {
    const banned = ctx.commands.some((command) =>
      check.banned!.some((fragment) => command.includes(fragment)),
    );
    if (banned) return "violated";
  }
  if (check.require) {
    return ctx.commands.some((command) => command.includes(check.require!))
      ? "followed"
      : "violated";
  }
  return "followed";
}

function diffLines(diff: string): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { added, removed };
}

export function checkPublicApiPreserved(ctx: RunContext): Verdict {
  const { added, removed } = diffLines(ctx.diff);
  const removedExports = removed.filter((line) => /^\s*export\b/.test(line));
  if (removedExports.length === 0) return "not-applicable";
  const addedSet = new Set(added.map((line) => line.trim()));
  return removedExports.every((line) => addedSet.has(line.trim())) ? "followed" : "violated";
}

function envNames(lines: string[]): Set<string> {
  const names = new Set<string>();
  const patterns = [
    /process\.env\.([A-Z_][A-Z0-9_]*)/gi,
    /process\.env\[\s*["'`]([^"'`]+)["'`]\s*\]/gi,
    /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/gi,
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) names.add(match[1]!);
    }
  }
  return names;
}

export function checkNoNewEnvVars(ctx: RunContext): Verdict {
  const { added, removed } = diffLines(ctx.diff);
  const introduced = envNames(added);
  if (introduced.size === 0) return "not-applicable";
  const existing = envNames(removed);
  for (const name of introduced) {
    if (!existing.has(name)) return "violated";
  }
  return "followed";
}
