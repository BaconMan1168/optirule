import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

export const RUBRIC_FILENAME = "optirule.rubric.yml";

export type CheckKind =
  | "files-touched"
  | "command-used"
  | "public-api-preserved"
  | "no-new-env-vars"
  | "judge";

export interface Check {
  kind: CheckKind;
  forbid?: string[];
  allow?: string[];
  require?: string;
  banned?: string[];
  question?: string;
}

export interface Rule {
  id: string;
  file: string;
  section: string;
  text: string;
  check: Check;
}

export interface UnmeasurableRule {
  file: string;
  section: string;
  text: string;
  reason: string;
}

export interface RuleConflict {
  a: string;
  b: string;
  reason: string;
}

export interface Rubric {
  rules: Rule[];
  unmeasurable: UnmeasurableRule[];
  conflicts: RuleConflict[];
}

export function loadRubric(dir: string): Rubric | undefined {
  const path = join(dir, RUBRIC_FILENAME);
  if (!existsSync(path)) return undefined;
  const raw = (parse(readFileSync(path, "utf8")) ?? {}) as Partial<Rubric>;
  return {
    rules: raw.rules ?? [],
    unmeasurable: raw.unmeasurable ?? [],
    conflicts: raw.conflicts ?? [],
  };
}

export function saveRubric(dir: string, rubric: Rubric): void {
  writeFileSync(join(dir, RUBRIC_FILENAME), stringify(rubric));
}
