import { describe, it, expect } from "vitest";
import { isTestFile } from "../src/testfiles.js";

describe("isTestFile", () => {
  it("recognises common test locations and filenames", () => {
    const paths = [
      "test/tasks.test.ts",
      "tests/test_thing.py",
      "__tests__/widget.jsx",
      "spec/models/user_spec.rb",
      "src/foo.test.ts",
      "src/foo.spec.js",
      "pkg/handler_test.go",
    ];
    for (const path of paths) expect(isTestFile(path), path).toBe(true);
  });

  it("does not mistake ordinary source files for tests", () => {
    const paths = [
      "src/latest.ts",
      "src/contestant.ts",
      "src/protest/index.ts",
      "docs/testing.md",
      "src/runner.ts",
    ];
    for (const path of paths) expect(isTestFile(path), path).toBe(false);
  });
});
