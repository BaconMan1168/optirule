import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { parseSections, removeSection } from "../sections.js";
import { readAnalysis } from "../report.js";
import type { AblationClassification, SectionAblation } from "../analyze.js";
import { instructionFileHashes } from "../runplan.js";

export interface ExportOptions {
  compact?: boolean;
  /** Backward-compatible alias for `compact`. */
  minimal?: boolean;
  out?: string;
}

/** The verbatim honesty caveat printed with every compact export. */
const CAVEAT =
  "validated only against your OptiRule task set. Helpful and inconclusive sections were " +
  "preserved; inconclusive evidence is not evidence of uselessness.";

/** Only confident neutrality or harm is enough ablation evidence to remove a section. */
export function isDroppable(classification: AblationClassification): boolean {
  return classification === "neutral" || classification === "harmful";
}

/** Default output path for a file: `CLAUDE.md` → `CLAUDE.compact.md`. */
function defaultOut(file: string): string {
  return file.endsWith(".md") ? file.replace(/\.md$/, ".compact.md") : `${file}.compact.md`;
}

function removalReason(section: SectionAblation): string {
  const measured = [
    ["pass", section.passRate.change],
    ["mistakes", section.mistakes.change],
    ["compliance", section.compliance.change],
    ["tokens", section.tokens.change],
    ["runtime", section.runtimeMs.change],
    ["churn", section.churn.change],
    ["tools", section.toolCalls.change],
    ["reads", section.filesRead.change],
  ]
    .filter((entry): entry is [string, number] => entry[1] !== undefined)
    .map(([name, value]) => `${name} ${value >= 0 ? "+" : ""}${value.toFixed(2)}`)
    .join(", ");
  return `${section.classification}; current − ablated: ${measured || "no optional metrics"}; ` +
    `${section.pairedRuns} paired runs; ${section.staticTokensRemoved} static tokens removed`;
}

/** Write ablation-backed compact copies without changing the originals. */
export function runExport(repoDir: string, options: ExportOptions): void {
  if (!options.compact && !options.minimal) {
    throw new Error("Nothing to do. Use `optirule export --compact`.");
  }

  const analysis = readAnalysis(repoDir);
  if (
    analysis?.schemaVersion !== 2 ||
    !analysis.ablation?.valid ||
    analysis.ablation.sections.length === 0
  ) {
    throw new Error(
      "No valid ablation run found. Run `optirule run --ablate` before compact export.",
    );
  }

  const config = loadConfig(repoDir);
  const currentHashes = instructionFileHashes(repoDir, config.instruction_files);
  for (const file of config.instruction_files) {
    if (currentHashes[file] !== analysis.ablation.instructionFileHashes[file]) {
      throw new Error(
        `${file} changed after the ablation run. Run \`optirule run --ablate\` again before exporting.`,
      );
    }
  }

  if (options.out && config.instruction_files.length > 1) {
    throw new Error(
      `--out cannot target ${config.instruction_files.length} files at once; omit it to write <file>.compact.md per file.`,
    );
  }

  for (const file of config.instruction_files) {
    const path = `${repoDir}/${file}`;
    if (!existsSync(path)) continue;

    const content = readFileSync(path, "utf8");
    const drop = analysis.ablation.sections.filter(
      (section) => section.file === file && isDroppable(section.classification),
    );
    const toRemove = parseSections(content, file)
      .flatMap((parsed) => {
        const evidence = drop.find(
          (section) =>
            section.title === parsed.title &&
            section.startLine === parsed.startLine &&
            section.endLine === parsed.endLine,
        );
        return evidence ? [{ parsed, evidence }] : [];
      })
      .sort((a, b) => b.parsed.startLine - a.parsed.startLine);
    let trimmed = content;
    for (const { parsed } of toRemove) trimmed = removeSection(trimmed, parsed);

    const outFile = options.out ?? defaultOut(file);
    const outPath = `${repoDir}/${outFile}`;
    if (resolve(outPath) === resolve(path)) {
      throw new Error(`Refusing to overwrite the original ${file}; choose a different --out.`);
    }
    writeFileSync(outPath, trimmed);
    console.log(`Wrote ${outFile}; original ${file} is unchanged.`);
    if (toRemove.length === 0) {
      console.log("  Removed nothing: no section was confidently neutral or harmful.");
    }
    for (const { evidence } of toRemove.reverse()) {
      console.log(`  Removed "${evidence.title}": ${removalReason(evidence)}.`);
    }
  }
  console.log(`\nCaveat: ${CAVEAT}`);
}
