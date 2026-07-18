import { describe, it, expect } from "vitest";
import { parseSections, estimateTokens, removeSection } from "../src/sections.js";

describe("estimateTokens", () => {
  it("approximates ~4 characters per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("parseSections", () => {
  it("splits on ## headings and records token cost", () => {
    const md = "# Title\nintro line\n\n## Testing\nrun tests\n\n## Style\nuse tabs";
    const sections = parseSections(md);
    expect(sections.map((s) => s.title)).toEqual(["(intro)", "Testing", "Style"]);
    expect(sections.every((s) => s.tokens > 0)).toBe(true);
  });

  it("omits an empty intro", () => {
    const sections = parseSections("## Only\nbody");
    expect(sections.map((s) => s.title)).toEqual(["Only"]);
  });

  it("records the file name and contiguous line spans", () => {
    const md = "# Title\nintro\n## Testing\nrun tests\n## Style\nuse tabs";
    const sections = parseSections(md, "CLAUDE.md");
    expect(sections.map((s) => s.file)).toEqual(["CLAUDE.md", "CLAUDE.md", "CLAUDE.md"]);
    expect(sections.map((s) => [s.startLine, s.endLine])).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });
});

describe("removeSection", () => {
  it("drops exactly the section's line span, keeping the rest", () => {
    const md = "# Title\nintro\n## Testing\nrun tests\n## Style\nuse tabs";
    const testing = parseSections(md, "CLAUDE.md").find((s) => s.title === "Testing")!;
    expect(removeSection(md, testing)).toBe("# Title\nintro\n## Style\nuse tabs");
  });
});
