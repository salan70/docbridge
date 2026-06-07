import { expect, test } from "bun:test";

import { parseLinkTarget } from "./links";

test("parseLinkTarget accepts project-root-relative file and raw fragment", () => {
  expect(parseLinkTarget("docs/specs/cli.md#check-command")).toEqual({
    ok: true,
    target: {
      filePath: "docs/specs/cli.md",
      fragment: "check-command",
    },
  });
});

test.each([
  ["#check-command", "fragment-only target"],
  ["docs/specs/cli.md", "file-only target"],
  ["docs/specs/cli.md#", "empty fragment"],
  ["#anchor", "empty file path"],
  ["/docs/specs/cli.md#check-command", "absolute path"],
  ["./docs/specs/cli.md#check-command", "current directory path"],
  ["../docs/specs/cli.md#check-command", "parent directory path"],
  ["docs/../specs/cli.md#check-command", "nested traversal"],
  ["docs\\specs\\cli.md#check-command", "backslash separator"],
  ["docs/specs/cli.md#check command", "whitespace"],
  ["docs/specs/cli.md#check#command", "multiple fragments"],
])("parseLinkTarget rejects %s as %s", (rawTarget) => {
  const result = parseLinkTarget(rawTarget, {
    source: "src/cli/index.ts#main",
    location: {
      filePath: "src/cli/index.ts",
      line: 12,
      column: 3,
    },
  });

  expect(result).toEqual({
    ok: false,
    diagnostic: {
      severity: "error",
      code: "invalid_link_target",
      source: "src/cli/index.ts#main",
      target: rawTarget,
      message:
        "Link target must be a project-root-relative file path and fragment in file#fragment form.",
      location: {
        filePath: "src/cli/index.ts",
        line: 12,
        column: 3,
      },
    },
  });
});

test("parseLinkTarget rejects same-file targets when the source file is provided", () => {
  const result = parseLinkTarget("docs/specs/cli.md#check-command", {
    sourceFilePath: "docs/specs/cli.md",
  });

  expect(result).toEqual({
    ok: false,
    diagnostic: {
      severity: "error",
      code: "invalid_link_target",
      target: "docs/specs/cli.md#check-command",
      message:
        "Link target must be a project-root-relative file path and fragment in file#fragment form.",
    },
  });
});
