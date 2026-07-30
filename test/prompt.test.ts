import { describe, expect, it } from "vitest";
import { parseChecklistSelection } from "../src/prompt.js";

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
