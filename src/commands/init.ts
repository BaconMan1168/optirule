import { writeFileSync, existsSync } from "node:fs";
import { detectInstructionFiles, detectAgent } from "../detect.js";
import { scaffoldConfig, CONFIG_FILENAME } from "../config.js";

/** Detect instruction files and scaffold optirule.yml in the repo root. */
export function runInit(repoDir: string): void {
  const configPath = `${repoDir}/${CONFIG_FILENAME}`;
  if (existsSync(configPath)) {
    console.log(`${CONFIG_FILENAME} already exists — leaving it untouched.`);
    return;
  }

  const files = detectInstructionFiles(repoDir);
  if (files.length === 0) {
    console.error(
      "No instruction files found (looked for CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules).",
    );
    console.error("Create one, then run `optirule init` again.");
    process.exitCode = 1;
    return;
  }

  const agent = detectAgent() ?? "claude";
  writeFileSync(configPath, scaffoldConfig(files, agent));
  console.log(`Wrote ${CONFIG_FILENAME} (agent: ${agent}, files: ${files.join(", ")}).`);
  console.log("Next: review the file, then run `optirule run`.");
}
