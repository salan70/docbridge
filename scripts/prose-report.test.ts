import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { analyzeProse, runProseReport } from "./prose-report";

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
}

test("analyzeProse excludes frontmatter, comments, and fenced code", () => {
  const report = analyzeProse(
    [
      "---",
      "description: hidden words",
      "---",
      "",
      "<!-- hidden comment words -->",
      "Visible words.",
      "",
      "```text",
      "hidden fenced words",
      "```",
    ].join("\n"),
    "document",
  );

  expect(report.wordCount).toBe(2);
  expect(report.warnings).toEqual([]);
});

test("fences in HTML comments do not hide the following prose", () => {
  const report = analyzeProse(["<!--", "```text", "-->", "", words(801)].join("\n"), "issue");

  expect(report.wordCount).toBe(801);
  expect(report.warnings).toContainEqual({ code: "word-limit", actual: 801, limit: 800 });
});

test.each([
  ["> ```text", `> ${words(801)}`, "> ```"],
  ["1. Example:", "", "    ```text", `    ${words(801)}`, "    ```"],
  ["> - Example:", ">", ">   ~~~text", `>   ${words(801)}`, ">   ~~~"],
])("code in Markdown containers is excluded: %s", (...lines) => {
  const report = analyzeProse([...lines, "", "Visible words."].join("\n"), "issue");

  expect(report.wordCount).toBeLessThan(5);
  expect(report.warnings).toEqual([]);
});

test("an unclosed quoted fence ends with its container", () => {
  expect(analyzeProse("> ```text\n> hidden words\n\nVisible words.", "document").wordCount).toBe(2);
});

test("comment markers inside code cannot hide following prose", () => {
  const source = ["```html", "<!--", "```", "", "Visible words."].join("\n");

  expect(analyzeProse(source, "document").wordCount).toBe(2);
});

test("a fence followed by text does not close a code block", () => {
  const source = [
    "```text",
    "``` is example content",
    words(801),
    "```",
    "",
    "Visible words.",
  ].join("\n");

  expect(analyzeProse(source, "document").wordCount).toBe(2);
});

test("inline code that looks like a fence does not hide prose", () => {
  const report = analyzeProse("```inline example```\n\nVisible words.", "document");

  expect(report.wordCount).toBe(3);
});

test.each(["issue", "pull-request", "document", "plan"] as const)(
  "%s warns only above 25 words in a sentence",
  (kind) => {
    expect(analyzeProse(`${words(25)}.`, kind).warnings).not.toContainEqual(
      expect.objectContaining({ code: "long-sentence" }),
    );
    expect(analyzeProse(`${words(26)}.`, kind).warnings).toContainEqual({
      code: "long-sentence",
      line: 1,
      sentence: 1,
      actual: 26,
      limit: 25,
    });
  },
);

test("sentence warnings identify the sentence and its source paragraph after excluded Markdown", () => {
  const source = [
    "---",
    "description: hidden",
    "---",
    "",
    "> <!-- hidden -->",
    ">",
    "> Short sentence.",
    `> ${words(26)}.`,
  ].join("\n");

  expect(analyzeProse(source, "document").warnings).toContainEqual({
    code: "long-sentence",
    line: 7,
    sentence: 2,
    actual: 26,
    limit: 25,
  });
});

test("paragraph sentence warnings start at six sentences", () => {
  const sentence = "This change fixes the parser.";

  expect(analyzeProse(Array(5).fill(sentence).join(" "), "document").warnings).toEqual([]);
  expect(analyzeProse(Array(6).fill(sentence).join(" "), "document").warnings).toContainEqual({
    code: "paragraph-sentences",
    line: 1,
    actual: 6,
    limit: 5,
  });
});

test("separate list items and headings do not form one paragraph", () => {
  const source = ["# Heading.", ...Array(6).fill("- Run the test.")].join("\n");

  expect(analyzeProse(source, "document").warnings).toEqual([]);
});

test("abbreviations, versions, and inline code do not split a sentence", () => {
  const source = "Use e.g. v1.2.3 with i.e. a label and `api.call(). Retry! Done?` here.";

  expect(analyzeProse(Array(5).fill(source).join(" "), "document").warnings).toEqual([]);
});

test("inline code counts once while link targets and comments do not count", () => {
  const source =
    "Run `bun run scripts/prose-report.ts issue -` with [this input](https://example.com/a.b). <!-- hidden words -->";

  expect(analyzeProse(source, "document").wordCount).toBe(5);
});

test("different inline code does not create a duplicate paragraph warning", () => {
  const source = `${words(19)} \`firstCommand()\`.\n\n${words(19)} \`secondCommand()\`.`;

  expect(analyzeProse(source, "document").warnings).not.toContainEqual(
    expect.objectContaining({ code: "duplicate-paragraph" }),
  );
});

test("sentences starting with inline code still count as separate sentences", () => {
  const report = analyzeProse(
    Array(3).fill("Run it. `foo()` returns a value.").join(" "),
    "document",
  );

  expect(report.warnings).toContainEqual({
    code: "paragraph-sentences",
    line: 1,
    actual: 6,
    limit: 5,
  });
});

test("common abbreviations before uppercase names do not split sentences", () => {
  const report = analyzeProse(
    Array(5).fill("Use e.g. JSON or i.e. XML here.").join(" "),
    "document",
  );

  expect(report.warnings).toEqual([]);
});

test("table cells count toward total words but are not combined into prose paragraphs", () => {
  const source = [
    "| Check | Result |",
    "| --- | --- |",
    ...Array(6).fill("| Run it. | It passes. |"),
  ].join("\n");
  const report = analyzeProse(source, "document");

  expect(report.wordCount).toBe(26);
  expect(report.paragraphCount).toBe(0);
  expect(report.warnings).toEqual([]);
});

test("inline HTML comments do not join the words around them", () => {
  expect(analyzeProse("Visible <!-- hidden --> words.", "document").wordCount).toBe(2);
});

test.each([
  "See <https://github.com/salan70/docbridge/pull/135> for detail.",
  "See https://github.com/salan70/docbridge/pull/135 for detail.",
  "See [PR](https://github.com/salan70/docbridge/pull/135) for detail.",
  "See [PR] for detail.\n\n[PR]: https://github.com/salan70/docbridge/pull/135",
])("link syntax does not inflate prose counts: %s", (source) => {
  const report = analyzeProse(source, "document");

  expect(report.wordCount).toBe(4);
  expect(report.paragraphCount).toBe(1);
});

test("frontmatter and CRLF preserve the paragraph's source line", () => {
  const source = ["---", "title: hidden", "...", "", words(26)].join("\r\n");

  expect(analyzeProse(source, "document").warnings).toContainEqual({
    code: "long-sentence",
    line: 5,
    sentence: 1,
    actual: 26,
    limit: 25,
  });
});

test("empty frontmatter cannot consume prose before a later thematic break", () => {
  const report = analyzeProse("---\n---\nVisible words.\n\n---", "document");

  expect(report.wordCount).toBe(2);
});

test("a leading thematic break cannot consume prose before a later thematic break", () => {
  const source = [
    "---",
    "",
    "The check now runs in under one second on the reference project.",
    "",
    "A second paragraph that a reviewer needs to read carefully before approving.",
    "",
    "---",
    "",
    "Tail.",
  ].join("\n");

  const report = analyzeProse(source, "pull-request");

  expect(report.wordCount).toBe(25);
  expect(report.paragraphCount).toBe(3);
});

test("a sentence ending in a time unit still counts toward the paragraph limit", () => {
  const source =
    "The scan finished in 120 ms. Two words. Three words. Four words. Five words. Six words.";

  expect(analyzeProse(source, "document").warnings).toContainEqual({
    code: "paragraph-sentences",
    line: 1,
    actual: 6,
    limit: 5,
  });
});

test("new warnings include actionable locations and remain advisory at the command boundary", async () => {
  const stdout: string[] = [];
  const exitCode = await runProseReport(["document", "-"], {
    readStdin: async () => `${words(26)}. Two. Three. Four. Five. Six.`,
    readFile: async () => "",
    stdout: (message) => stdout.push(message),
    stderr: () => {},
  });

  expect(exitCode).toBe(0);
  expect(stdout.join("\n")).toContain("warning long-sentence");
  expect(stdout.join("\n")).toContain("sentence 1");
  expect(stdout.join("\n")).toContain("paragraph at line 1");
  expect(stdout.join("\n")).toContain("warning paragraph-sentences");
});

test.each([
  ["issue", 800],
  ["pull-request", 500],
  ["plan", 1_500],
] as const)("%s warns only above its word limit", (kind, limit) => {
  expect(analyzeProse(words(limit), kind).warnings).not.toContainEqual(
    expect.objectContaining({ code: "word-limit" }),
  );
  expect(analyzeProse(words(limit + 1), kind).warnings).toContainEqual(
    expect.objectContaining({ code: "word-limit", actual: limit + 1, limit }),
  );
});

test("document has no total word limit", () => {
  const report = analyzeProse(`${words(100)}\n\n${words(100)}\n\n${words(100)}`, "document");

  expect(report.warnings).not.toContainEqual(expect.objectContaining({ code: "word-limit" }));
});

test("all kinds warn about paragraphs longer than 120 words", () => {
  expect(analyzeProse(words(120), "document").warnings).not.toContainEqual(
    expect.objectContaining({ code: "long-paragraph" }),
  );
  expect(analyzeProse(words(121), "document").warnings).toContainEqual(
    expect.objectContaining({ code: "long-paragraph", line: 1, actual: 121, limit: 120 }),
  );
});

test("wrapped list items remain one paragraph", () => {
  const report = analyzeProse(`- first\n  ${words(120)}`, "document");

  expect(report.warnings).toContainEqual(
    expect.objectContaining({ code: "long-paragraph", line: 1, actual: 121 }),
  );
});

test("duplicate paragraphs require at least 20 normalized words", () => {
  const longParagraph = words(20);
  const report = analyzeProse(
    `${longParagraph}\n\n${longParagraph.toUpperCase().replaceAll(" ", "   ")}\n`,
    "document",
  );

  expect(report.warnings).toContainEqual({
    code: "duplicate-paragraph",
    line: 3,
    originalLine: 1,
    actual: 20,
    limit: 20,
  });
  expect(analyzeProse(`${words(19)}\n\n${words(19)}`, "document").warnings).toEqual([]);
});

test("representative verbose and concise pull requests produce different warnings", () => {
  const repeated = words(130);
  const verbose = ["# Summary", repeated, repeated, words(250)].join("\n\n");
  const concise = [
    "# Summary",
    "Adds the requested writing workflow.",
    "# Verification",
    "Tests pass.",
  ].join("\n\n");

  expect(analyzeProse(verbose, "pull-request").warnings.length).toBeGreaterThan(0);
  expect(analyzeProse(concise, "pull-request").warnings).toEqual([]);
});

test("runProseReport reads stdin and keeps advisory warnings non-blocking", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runProseReport(["issue", "-"], {
    readStdin: async () => words(801),
    readFile: async () => {
      throw new Error("file input was not expected");
    },
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  });

  expect(exitCode).toBe(0);
  expect(stdout.join("\n")).toContain("word-limit");
  expect(stderr).toEqual([]);
});

test("runProseReport rejects invalid arguments", async () => {
  const stderr: string[] = [];

  const exitCode = await runProseReport(["email", "draft.md"], {
    readStdin: async () => "",
    readFile: async () => "",
    stdout: () => {},
    stderr: (message) => stderr.push(message),
  });

  expect(exitCode).toBe(1);
  expect(stderr.join("\n")).toContain(
    "Usage: prose-report <issue|pull-request|document|plan> <path|->",
  );
});

test("the justfile exposes the prose report command", () => {
  const justfile = readFileSync(join(import.meta.dir, "..", "justfile"), "utf8");

  expect(justfile).toContain(
    "prose-report kind source:\n    bun run scripts/prose-report.ts {{ kind }} {{ source }}",
  );
});
