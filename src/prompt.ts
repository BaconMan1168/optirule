import { createInterface } from "node:readline/promises";

/** Resolve a comma-separated checklist answer into the selected files. */
export function parseChecklistSelection(files: string[], answer: string): string[] {
  const trimmed = answer.trim();
  if (!trimmed) return files;

  const selected = new Set(
    trimmed.split(",").map((value) => {
      const number = Number(value.trim());
      if (!Number.isInteger(number) || number < 1 || number > files.length) {
        throw new Error(`Enter file numbers between 1 and ${files.length}.`);
      }
      return number - 1;
    }),
  );
  return files.filter((_, index) => selected.has(index));
}

/** Resolve a comma-separated `--files` value against the detected files. */
export function resolveFileSelection(detected: string[], requested: string): string[] {
  const names = requested
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (names.length === 0) throw new Error("--files needs at least one file name.");

  const unknown = names.filter((name) => !detected.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `Not detected: ${unknown.join(", ")}. Detected files: ${detected.join(", ")}.`,
    );
  }
  return detected.filter((file) => names.includes(file));
}

/**
 * Ask which detected instruction files should be included in the config.
 * Without a terminal there is nobody to answer, so keep every detected file
 * rather than blocking on input that will never arrive.
 */
export async function selectInstructionFiles(
  files: string[],
  interactive: boolean = process.stdin.isTTY === true,
): Promise<string[]> {
  if (!interactive) {
    console.log(`No terminal input — keeping all detected files: ${files.join(", ")}.`);
    console.log("Pass --files to choose a subset without a terminal.");
    return files;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\nSelect the instruction files to include:");
    files.forEach((file, index) => console.log(`  [${index + 1}] [x] ${file}`));

    while (true) {
      const answer = await rl.question(
        "Enter file numbers (comma-separated), or press Enter to keep all: ",
      );
      try {
        return parseChecklistSelection(files, answer);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
      }
    }
  } finally {
    rl.close();
  }
}

/** Ask a yes/no question on the terminal. Defaults to no on empty input. */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
