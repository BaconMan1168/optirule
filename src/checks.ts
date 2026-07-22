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
