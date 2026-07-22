import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { parseSections, removeSection } from "../sections.js";
import { readAnalysis } from "../report.js";
import type { SectionSignal } from "../analyze.js";

export interface ExportOptions {
  minimal?: boolean;
  out?: string;
}

/** The verbatim honesty caveat printed with every minimal export. */
const CAVEAT =
  "validated only against your optirule task set. Sections kept as never-exercised or " +
  "single-task-signal were not proven useless — they were never put to the test.";

/** Only demonstrated redundancy or harm is enough evidence to remove a section. */
export function isDroppable(signal: SectionSignal): boolean {
  return signal === "redundant" || signal === "harmful";
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
  if (!analysis?.compliance?.sections.length) {
    throw new Error("No compliance data found. Run `optirule lint` then `optirule run` first.");
  }

  const config = loadConfig(repoDir);
  const dropByFile = new Map<string, Set<string>>();
  for (const section of analysis.compliance.sections) {
    if (!isDroppable(section.signal)) continue;
    if (!dropByFile.has(section.file)) dropByFile.set(section.file, new Set());
    dropByFile.get(section.file)!.add(section.title);
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
