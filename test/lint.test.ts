import { describe, it, expect } from "vitest";
import { buildLintPrompt, parseLintResponse } from "../src/commands/lint.js";
import type { ParsedSection } from "../src/sections.js";

const sections: ParsedSection[] = [
  { file: "CLAUDE.md", title: "Testing", tokens: 20, startLine: 0, endLine: 3 },
];

describe("buildLintPrompt", () => {
  it("includes the section text and every supported check kind", () => {
    const prompt = buildLintPrompt(sections, "## Testing\nAlways run `npm test`.\n");
    expect(prompt).toContain("## Testing");
    expect(prompt).toContain("Source file: CLAUDE.md");
    for (const kind of ["files-touched", "command-used", "public-api-preserved", "no-new-env-vars", "judge"]) {
      expect(prompt).toContain(kind);
    }
  });

  it("asks for unmeasurable instructions to be separated out", () => {
    expect(buildLintPrompt(sections, "Be an expert.").toLowerCase()).toContain("unmeasurable");
  });
});

describe("parseLintResponse", () => {
  it("extracts a rubric from a fenced JSON reply", () => {
    const value = { rules: [{ id: "test-command", file: "CLAUDE.md", section: "Testing", text: "Always run tests", check: { kind: "command-used", require: "npm test" } }], unmeasurable: [{ file: "CLAUDE.md", section: "Philosophy", text: "Be an expert", reason: "no observable action" }], conflicts: [] };
    const rubric = parseLintResponse(`Here:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``);
    expect(rubric.rules).toHaveLength(1);
    expect(rubric.unmeasurable).toHaveLength(1);
  });

  it("drops rules whose check kind is not supported", () => {
    const reply = JSON.stringify({ rules: [{ id: "a", file: "f", section: "s", text: "t", check: { kind: "vibes" } }, { id: "b", file: "f", section: "s", text: "t", check: { kind: "judge", question: "ok?" } }] });
    expect(parseLintResponse(reply).rules.map((rule) => rule.id)).toEqual(["b"]);
  });

  it("throws on a reply with no JSON at all", () => {
    expect(() => parseLintResponse("I could not do that.")).toThrow(/no JSON/i);
  });
});
