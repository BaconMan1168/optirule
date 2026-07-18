import { describe, it, expect } from "vitest";
import { parseSections, estimateTokens } from "../src/sections.js";

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
});
