import { describe, expect, test } from "bun:test";

import {
  MAX_SECTION_LENGTH,
  capSectionLength,
  extractDocSection,
} from "./section";

describe("extractDocSection", () => {
  test("includes deeper subsections and stops at the next same-or-higher heading", () => {
    const content = "## A\n\nintro\n\n### A.1\n\ndetail\n\n## B\n\nother";
    expect(extractDocSection(content, 1)).toBe(
      "## A\n\nintro\n\n### A.1\n\ndetail",
    );
  });

  test("a higher-level heading terminates a deeper section", () => {
    const content = "## A\n\nintro\n\n### A.1\n\ndetail\n\n## B\n\nother";
    // `### A.1` starts at line 5; `## B` (higher level) terminates it.
    expect(extractDocSection(content, 5)).toBe("### A.1\n\ndetail");
  });

  test("a `#` line inside a fenced code block does not end the section", () => {
    const content = [
      "## Section",
      "",
      "```sh",
      "# a comment",
      "## not a heading",
      "```",
      "",
      "after fence",
      "",
      "## Next",
      "",
      "tail",
    ].join("\n");
    expect(extractDocSection(content, 1)).toBe(
      ["## Section", "", "```sh", "# a comment", "## not a heading", "```", "", "after fence"].join(
        "\n",
      ),
    );
  });

  test("trims trailing blank lines from the returned section", () => {
    const content = "## A\n\nbody\n\n\n\n## B\n\nother";
    expect(extractDocSection(content, 1)).toBe("## A\n\nbody");
  });

  test("the last section in the document extends to end of file", () => {
    const content = "## A\n\nintro\n\n## B\n\nlast body";
    expect(extractDocSection(content, 5)).toBe("## B\n\nlast body");
  });

  test("best-effort when the start line is not a heading: reads to end of section", () => {
    const content = "intro line\n\nbody\n\n## A\n\nafter";
    // Line 1 is not a heading; the section runs until the first heading.
    expect(extractDocSection(content, 1)).toBe("intro line\n\nbody");
  });

  test("out-of-range start line returns an empty string", () => {
    const content = "## A\n\nbody";
    expect(extractDocSection(content, 99)).toBe("");
    expect(extractDocSection(content, 0)).toBe("");
  });
});

describe("capSectionLength", () => {
  test("leaves short text unchanged", () => {
    const text = "short section";
    expect(capSectionLength(text)).toBe(text);
  });

  test("truncates over-long text and appends the continuation marker", () => {
    const text = "x".repeat(MAX_SECTION_LENGTH + 100);
    const result = capSectionLength(text);
    expect(result.length).toBeLessThan(text.length);
    expect(result.endsWith("\n\n…")).toBe(true);
    expect(result.startsWith("x".repeat(10))).toBe(true);
  });

  test("text exactly at the cap is unchanged", () => {
    const text = "x".repeat(MAX_SECTION_LENGTH);
    expect(capSectionLength(text)).toBe(text);
  });
});
