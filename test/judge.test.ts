import { describe, it, expect } from "vitest";
import { buildJudgePrompt, parseJudgeResponse } from "../src/judge.js";
import type { Rule } from "../src/rubric.js";
import type { RunContext } from "../src/checks.js";

const rules: Rule[] = [{
  id: "adapter-registered",
  file: "CLAUDE.md",
  section: "Adapters",
  text: "New adapters must be registered",
  check: { kind: "judge", question: "If an adapter was added, is it registered?" },
}];
const ctx: RunContext = {
  filesChanged: ["src/adapters.ts"],
  diff: "+function fooAdapter() {}\n",
  commands: ["npm test"],
  timedOut: false,
};

describe("buildJudgePrompt", () => {
  it("includes task evidence and questions", () => {
    const prompt = buildJudgePrompt("add a foo adapter", rules, ctx);
    expect(prompt).toContain("add a foo adapter");
    expect(prompt).toContain("+function fooAdapter() {}");
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("If an adapter was added, is it registered?");
    expect(prompt).toContain("not-applicable");
  });
  it("never reveals the producing condition", () => {
    const prompt = buildJudgePrompt("add a foo adapter", rules, ctx).toLowerCase();
    for (const leak of ["baseline", "variant", "current", "claude.md", "instruction file"]) {
      expect(prompt, leak).not.toContain(leak);
    }
  });
});

describe("parseJudgeResponse", () => {
  it("maps fenced verdicts onto rule ids", () => {
    expect(parseJudgeResponse('```json\n[{"id":"adapter-registered","verdict":"violated"}]\n```', rules)).toEqual([
      { ruleId: "adapter-registered", verdict: "violated" },
    ]);
  });
  it("defaults missing or unparseable answers to not-applicable", () => {
    const expected = [{ ruleId: "adapter-registered", verdict: "not-applicable" }];
    expect(parseJudgeResponse("[]", rules)).toEqual(expected);
    expect(parseJudgeResponse("refused", rules)).toEqual(expected);
  });
  it("ignores unknown ids", () => {
    const reply = '[{"id":"ghost","verdict":"violated"},{"id":"adapter-registered","verdict":"followed"}]';
    expect(parseJudgeResponse(reply, rules)).toEqual([
      { ruleId: "adapter-registered", verdict: "followed" },
    ]);
  });
});
