import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { parseSections, removeSection } from "../sections.js";
import { readAnalysis } from "../report.js";
import type { SectionImpact } from "../analyze.js";

export interface ExportOptions {
  minimal?: boolean;
  out?: string;
}

/** The verbatim honesty caveat printed with every minimal export. */
const CAVEAT =
  "validated only against your optirule task set — sections removed here may matter for tasks not in your benchmark.";

/** Signals whose sections are safe to drop: measured, and removal did not hurt. */
function isDroppable(signal: SectionImpact["signal"]): boolean {
  return signal === "no-measurable-impact" || signal === "actively-hurts";
}

/** Default output path for a file: `CLAUDE.md` → `CLAUDE.optirule.md`. */
function defaultOut(file: string): string {
  return file.endsWith(".md") ? file.replace(/\.md$/, ".optirule.md") : `${file}.optirule.md`;
}

/** Write a trimmed copy of each instruction file, dropping non-load-bearing sections. */
export function runExport(repoDir: string, options: ExportOptions): void {
  if (!options.minimal) {
    throw new Error("Nothing to do. `optirule export --minimal` is the only supported mode.");
  }

  const analysis = readAnalysis(repoDir);
  if (!analysis?.sectionImpacts?.length) {
    throw new Error("No ablation data found. Run `optirule run --ablate` first.");
  }

  const config = loadConfig(repoDir);
  const dropByFile = new Map<string, Set<string>>();
  for (const impact of analysis.sectionImpacts) {
    if (!isDroppable(impact.signal)) continue;
    if (!dropByFile.has(impact.file)) dropByFile.set(impact.file, new Set());
    dropByFile.get(impact.file)!.add(impact.title);
  }

  const filesWithDrops = config.instruction_files.filter((f) => (dropByFile.get(f)?.size ?? 0) > 0);
  if (options.out && filesWithDrops.length > 1) {
    throw new Error(
      `--out cannot target ${filesWithDrops.length} files at once; omit it to write <file>.optirule.md per file.`,
    );
  }

  let wrote = false;
  for (const file of config.instruction_files) {
    const drop = dropByFile.get(file);
    if (!drop?.size) continue;
    const path = `${repoDir}/${file}`;
    if (!existsSync(path)) continue;

    const content = readFileSync(path, "utf8");
    // Remove from the bottom up so earlier line spans stay valid.
    const toRemove = parseSections(content, file)
      .filter((s) => drop.has(s.title))
      .sort((a, b) => b.startLine - a.startLine);
    let trimmed = content;
    for (const section of toRemove) trimmed = removeSection(trimmed, section);

    const outFile = options.out ?? defaultOut(file);
    const outPath = `${repoDir}/${outFile}`;
    if (outPath === path) {
      throw new Error(`Refusing to overwrite the original ${file}; choose a different --out.`);
    }
    writeFileSync(outPath, trimmed);
    console.log(`Wrote ${outFile} — dropped ${toRemove.length} section(s): ${[...drop].join(", ")}.`);
    wrote = true;
  }

  if (!wrote) {
    console.log("No sections were safe to drop; every section earns its keep or is unmeasured.");
    return;
  }
  console.log(`\nCaveat: ${CAVEAT}`);
}
