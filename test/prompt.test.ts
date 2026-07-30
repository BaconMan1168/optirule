import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseChecklistSelection,
  resolveFileSelection,
  selectInstructionFiles,
} from "../src/prompt.js";

describe("parseChecklistSelection", () => {
  const files = ["CLAUDE.md", "AGENTS.md", "GEMINI.md"];

  it("keeps all files when the user accepts the defaults", () => {
    expect(parseChecklistSelection(files, "")).toEqual(files);
  });

  it("returns the files matching the entered checklist numbers", () => {
    expect(parseChecklistSelection(files, "1, 3")).toEqual(["CLAUDE.md", "GEMINI.md"]);
  });

  it("rejects invalid and empty selections", () => {
    expect(() => parseChecklistSelection(files, "0")).toThrow(/between 1 and 3/);
    expect(() => parseChecklistSelection(files, "2, nope")).toThrow(/between 1 and 3/);
  });
});

describe("resolveFileSelection", () => {
  const files = ["CLAUDE.md", "AGENTS.md", "GEMINI.md"];

  it("keeps the requested files in detection order", () => {
    expect(resolveFileSelection(files, "GEMINI.md, CLAUDE.md")).toEqual([
      "CLAUDE.md",
      "GEMINI.md",
    ]);
  });

  it("rejects files that were not detected", () => {
    expect(() => resolveFileSelection(files, "CLAUDE.md, README.md")).toThrow(/README\.md/);
  });

  it("rejects an empty request", () => {
    expect(() => resolveFileSelection(files, " , ")).toThrow(/at least one/);
  });
});

describe("selectInstructionFiles without a terminal", () => {
  const files = ["CLAUDE.md", "AGENTS.md"];

  afterEach(() => vi.restoreAllMocks());

  it("keeps every detected file instead of blocking on input", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(selectInstructionFiles(files, false)).resolves.toEqual(files);
  });
});
