import { describe, it, expect } from "vitest";
import { slugify, planVariants } from "../src/variants.js";
import type { ParsedSection } from "../src/sections.js";

function section(title: string): ParsedSection {
  return { file: "CLAUDE.md", title, tokens: 10, startLine: 0, endLine: 1 };
}

describe("slugify", () => {
  it("makes titles path-safe", () => {
    expect(slugify("Testing / Style")).toBe("testing-style");
    expect(slugify("!!!")).toBe("section");
  });
});

describe("planVariants", () => {
  it("returns only baseline and current without ablation", () => {
    expect(planVariants([section("A")], false).map((v) => v.id)).toEqual(["baseline", "current"]);
  });

  it("appends one ablate variant per section with slugged ids", () => {
    const ids = planVariants([section("Testing"), section("Code Style")], true).map((v) => v.id);
    expect(ids).toEqual(["baseline", "current", "ablate-testing", "ablate-code-style"]);
  });

  it("disambiguates colliding slugs", () => {
    const ids = planVariants([section("Testing"), section("testing")], true).map((v) => v.id);
    expect(ids).toEqual(["baseline", "current", "ablate-testing", "ablate-testing-2"]);
  });
});
