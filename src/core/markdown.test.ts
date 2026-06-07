import { expect, test } from "bun:test";

import { scanMarkdown } from "./markdown";

test("scanMarkdown extracts a heading anchor and a doc-to-code link", () => {
  const content = ["<!-- @code src/auth/login.ts#login -->", "## Login Spec", "", "Login flow specification.", ""].join(
    "\n",
  );

  const result = scanMarkdown("docs/auth.md", content);

  expect(result.filePath).toBe("docs/auth.md");
  expect(result.diagnostics).toEqual([]);
  expect(result.anchors).toEqual([
    {
      kind: "doc",
      filePath: "docs/auth.md",
      anchor: "login-spec",
      endpoint: "docs/auth.md#login-spec",
      headingText: "Login Spec",
      location: { filePath: "docs/auth.md", line: 2, column: 1 },
    },
  ]);
  expect(result.links).toEqual([
    {
      direction: "doc-to-code",
      source: "docs/auth.md#login-spec",
      target: "src/auth/login.ts#login",
      location: { filePath: "docs/auth.md", line: 1, column: 1 },
    },
  ]);
});

test("scanMarkdown records anchors with no annotations", () => {
  const result = scanMarkdown("docs/a.md", "# Title\n");

  expect(result.anchors).toEqual([
    {
      kind: "doc",
      filePath: "docs/a.md",
      anchor: "title",
      endpoint: "docs/a.md#title",
      headingText: "Title",
      location: { filePath: "docs/a.md", line: 1, column: 1 },
    },
  ]);
  expect(result.links).toEqual([]);
});

// --- anchor generation -----------------------------------------------------

test.each([
  ["# Hello, World!", "hello-world", "Hello, World!"],
  ["#   Lots   of   spaces   ", "lots-of-spaces", "Lots   of   spaces"],
  ["# MixedCASE Title", "mixedcase-title", "MixedCASE Title"],
  ["# foo: bar / baz", "foo-bar-baz", "foo: bar / baz"],
  ["# --leading and trailing--", "leading-and-trailing", "--leading and trailing--"],
  ["# café déjà", "café-déjà", "café déjà"],
  ["# 日本語 見出し", "日本語-見出し", "日本語 見出し"],
  ["# Version 2 point 0", "version-2-point-0", "Version 2 point 0"],
  ["# Done ##", "done", "Done"],
  ["#### Deep Heading", "deep-heading", "Deep Heading"],
])("scanMarkdown anchor for %s -> %s", (line, anchor, headingText) => {
  const result = scanMarkdown("docs/a.md", `${line}\n`);
  expect(result.anchors).toHaveLength(1);
  expect(result.anchors[0]?.anchor).toBe(anchor);
  expect(result.anchors[0]?.headingText).toBe(headingText);
});

test.each([
  ["    # Indented four spaces", "four-space indented heading is not a heading"],
  ["Setext Heading\n======", "setext heading is ignored"],
  ["Setext Heading\n------", "setext sub heading is ignored"],
  ["####### Too deep", "seven hashes is not a heading"],
  ["#NoSpace", "hash without space is not an ATX heading"],
])("scanMarkdown ignores %s (%s)", (content) => {
  const result = scanMarkdown("docs/a.md", `${content}\n`);
  expect(result.anchors).toEqual([]);
});

test("scanMarkdown allows headings indented up to three spaces", () => {
  const result = scanMarkdown("docs/a.md", "   # Three spaces\n");
  expect(result.anchors).toHaveLength(1);
  expect(result.anchors[0]?.anchor).toBe("three-spaces");
  expect(result.anchors[0]?.location.column).toBe(4);
});

// --- fenced code blocks ----------------------------------------------------

test("scanMarkdown ignores headings and comments inside backtick fences", () => {
  const content = [
    "```",
    "<!-- @code src/a.ts#foo -->",
    "# Not A Heading",
    "```",
    "# Real Heading",
  ].join("\n");

  const result = scanMarkdown("docs/a.md", content);

  expect(result.anchors).toHaveLength(1);
  expect(result.anchors[0]?.anchor).toBe("real-heading");
  expect(result.links).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test("scanMarkdown ignores content inside tilde fences", () => {
  const content = ["~~~", "# Not A Heading", "~~~"].join("\n");
  const result = scanMarkdown("docs/a.md", content);
  expect(result.anchors).toEqual([]);
});

// --- @code comment recognition ---------------------------------------------

test("scanMarkdown ignores comments indented four or more spaces", () => {
  const content = ["    <!-- @code src/a.ts#foo -->", "# Heading"].join("\n");
  const result = scanMarkdown("docs/a.md", content);

  expect(result.links).toEqual([]);
  expect(result.anchors).toHaveLength(1);
  // The heading has no pending annotation, so no dangling diagnostic.
  expect(result.diagnostics).toEqual([]);
});

test("scanMarkdown allows comments indented up to three spaces", () => {
  const content = ["   <!-- @code src/a.ts#foo -->", "# Heading"].join("\n");
  const result = scanMarkdown("docs/a.md", content);
  expect(result.links).toHaveLength(1);
  expect(result.links[0]?.location.column).toBe(4);
});

test("scanMarkdown ignores comments whose body does not start with @code", () => {
  const content = ["<!-- not an annotation -->", "# Heading"].join("\n");
  const result = scanMarkdown("docs/a.md", content);
  expect(result.links).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test("scanMarkdown takes only the first token after @code as the target", () => {
  const content = ["<!-- @code src/a.ts#foo extra words here -->", "# Heading"].join("\n");
  const result = scanMarkdown("docs/a.md", content);
  expect(result.links).toEqual([
    {
      direction: "doc-to-code",
      source: "docs/a.md#heading",
      target: "src/a.ts#foo",
      location: { filePath: "docs/a.md", line: 1, column: 1 },
    },
  ]);
});

test("scanMarkdown allows empty lines between pending comments and the heading", () => {
  const content = ["<!-- @code src/a.ts#foo -->", "", "", "# Heading"].join("\n");
  const result = scanMarkdown("docs/a.md", content);
  expect(result.links).toHaveLength(1);
  expect(result.diagnostics).toEqual([]);
});

test("scanMarkdown attaches multiple @code comments to one heading", () => {
  const content = [
    "<!-- @code src/a.ts#foo -->",
    "<!-- @code src/b.ts#bar -->",
    "# Heading",
  ].join("\n");
  const result = scanMarkdown("docs/a.md", content);

  expect(result.links).toEqual([
    {
      direction: "doc-to-code",
      source: "docs/a.md#heading",
      target: "src/a.ts#foo",
      location: { filePath: "docs/a.md", line: 1, column: 1 },
    },
    {
      direction: "doc-to-code",
      source: "docs/a.md#heading",
      target: "src/b.ts#bar",
      location: { filePath: "docs/a.md", line: 2, column: 1 },
    },
  ]);
  expect(result.diagnostics).toEqual([]);
});

// --- dangling annotations --------------------------------------------------

test("scanMarkdown reports dangling annotation before normal text", () => {
  const content = ["<!-- @code src/a.ts#foo -->", "Some normal text.", "# Heading"].join("\n");
  const result = scanMarkdown("docs/a.md", content);

  expect(result.links).toEqual([]);
  expect(result.diagnostics).toEqual([
    {
      severity: "warning",
      code: "dangling_code_annotation",
      target: "src/a.ts#foo",
      message:
        "@code annotation is not attached to a following heading.",
      location: { filePath: "docs/a.md", line: 1, column: 1 },
    },
  ]);
});

test("scanMarkdown reports dangling annotation before a non-@code comment", () => {
  const content = ["<!-- @code src/a.ts#foo -->", "<!-- other -->", "# Heading"].join("\n");
  const result = scanMarkdown("docs/a.md", content);

  expect(result.links).toEqual([]);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.code).toBe("dangling_code_annotation");
});

test("scanMarkdown reports dangling annotation at end of file", () => {
  const content = ["# Heading", "<!-- @code src/a.ts#foo -->"].join("\n");
  const result = scanMarkdown("docs/a.md", content);

  expect(result.links).toEqual([]);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.code).toBe("dangling_code_annotation");
});

test("scanMarkdown reports dangling annotation attached to an empty heading", () => {
  const content = ["<!-- @code src/a.ts#foo -->", "## ##"].join("\n");
  const result = scanMarkdown("docs/a.md", content);

  expect(result.anchors).toEqual([]);
  expect(result.links).toEqual([]);
  expect(result.diagnostics).toEqual([
    {
      severity: "warning",
      code: "dangling_code_annotation",
      target: "src/a.ts#foo",
      message: "@code annotation is attached to an empty heading that has no anchor.",
      location: { filePath: "docs/a.md", line: 1, column: 1 },
    },
  ]);
});

// --- duplicate anchors -----------------------------------------------------

test("scanMarkdown reports duplicate non-empty anchors in the same file", () => {
  const content = ["# Same Title", "# Same Title"].join("\n");
  const result = scanMarkdown("docs/a.md", content);

  expect(result.anchors).toHaveLength(2);
  expect(result.diagnostics).toEqual([
    {
      severity: "error",
      code: "duplicate_doc_anchor",
      target: "docs/a.md#same-title",
      message: "Duplicate doc anchor \"same-title\" in docs/a.md.",
      location: { filePath: "docs/a.md", line: 2, column: 1 },
    },
  ]);
});

test("scanMarkdown does not treat empty headings as duplicates", () => {
  const content = ["#", "##"].join("\n");
  const result = scanMarkdown("docs/a.md", content);
  expect(result.anchors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

// --- duplicate links -------------------------------------------------------

test("scanMarkdown reports duplicate links from the same heading to the same endpoint", () => {
  const content = [
    "<!-- @code src/a.ts#foo -->",
    "<!-- @code src/a.ts#foo -->",
    "# Heading",
  ].join("\n");
  const result = scanMarkdown("docs/a.md", content);

  expect(result.links).toHaveLength(2);
  const dup = result.diagnostics.filter((d) => d.code === "duplicate_link");
  expect(dup).toEqual([
    {
      severity: "warning",
      code: "duplicate_link",
      source: "docs/a.md#heading",
      target: "src/a.ts#foo",
      message:
        "Duplicate @code link from docs/a.md#heading to src/a.ts#foo.",
      location: { filePath: "docs/a.md", line: 2, column: 1 },
    },
  ]);
});

test("scanMarkdown does not report duplicate links to different endpoints", () => {
  const content = [
    "<!-- @code src/a.ts#foo -->",
    "<!-- @code src/a.ts#bar -->",
    "# Heading",
  ].join("\n");
  const result = scanMarkdown("docs/a.md", content);
  expect(result.diagnostics.filter((d) => d.code === "duplicate_link")).toEqual([]);
});

// --- invalid link targets --------------------------------------------------

test("scanMarkdown emits invalid_link_target for malformed @code targets", () => {
  const content = ["<!-- @code not-a-valid-target -->", "# Heading"].join("\n");
  const result = scanMarkdown("docs/a.md", content);

  expect(result.links).toEqual([]);
  expect(result.diagnostics).toEqual([
    {
      severity: "error",
      code: "invalid_link_target",
      source: "docs/a.md#heading",
      target: "not-a-valid-target",
      message:
        "Link target must be a project-root-relative file path and fragment in file#fragment form.",
      location: { filePath: "docs/a.md", line: 1, column: 1 },
    },
  ]);
});

test("scanMarkdown emits invalid_link_target without source for a dangling invalid target", () => {
  const content = ["<!-- @code not-a-valid-target -->", "Normal text."].join("\n");
  const result = scanMarkdown("docs/a.md", content);

  const invalid = result.diagnostics.filter((d) => d.code === "invalid_link_target");
  expect(invalid).toHaveLength(1);
  expect(invalid[0]?.source).toBeUndefined();
  expect(invalid[0]?.location).toEqual({ filePath: "docs/a.md", line: 1, column: 1 });
});

test("scanMarkdown emits invalid_link_target for a missing target", () => {
  const content = ["<!-- @code -->", "# Heading"].join("\n");
  const result = scanMarkdown("docs/a.md", content);

  const invalid = result.diagnostics.filter((d) => d.code === "invalid_link_target");
  expect(invalid).toHaveLength(1);
  expect(invalid[0]?.target).toBe("");
});
