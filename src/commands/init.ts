import { writeFileSync, existsSync } from "node:fs";
import { detectInstructionFiles, detectInstalledAgents, chooseAgent, detectAgent } from "../detect.js";
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

  const installed = detectInstalledAgents();
  const agent = chooseAgent(files, installed, detectAgent());
  writeFileSync(configPath, scaffoldConfig(files, agent));
  const found = installed.length ? installed.join(", ") : "none on PATH";
  console.log(`Wrote ${CONFIG_FILENAME} (agent: ${agent}, files: ${files.join(", ")}).`);
  console.log(`Detected agent CLIs: ${found}.`);
  console.log("Next: review the file, then run `optirule lint`.");
}
