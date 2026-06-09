import { expect, test } from "bun:test";

import { buildLinkGraph, type LinkGraph } from "./graph";
import { scanMarkdown } from "./markdown";
import { computeRelated, normalizeChangedPaths } from "./related";
import { scanTypeScript } from "./typescript";

const LOGIN_TS = ["/**", " * @doc docs/auth.md#login-spec", " */", "export function login() {}", ""].join("\n");

const AUTH_MD = ["<!-- @code src/auth/login.ts#login -->", "## Login Spec", ""].join("\n");

function graphFrom(code: Array<[string, string]>, docs: Array<[string, string]>): LinkGraph {
  return buildLinkGraph(
    code.map(([filePath, content]) => scanTypeScript(filePath, content)),
    docs.map(([filePath, content]) => scanMarkdown(filePath, content)),
  );
}

test("computeRelated lists the doc counterpart of a changed code file", () => {
  const graph = graphFrom([["src/auth/login.ts", LOGIN_TS]], [["docs/auth.md", AUTH_MD]]);

  const result = computeRelated(graph, ["src/auth/login.ts"]);

  expect(result).toEqual({
    files: [
      {
        filePath: "src/auth/login.ts",
        endpoints: [
          {
            endpoint: "src/auth/login.ts#login",
            counterparts: [
              {
                endpoint: "docs/auth.md#login-spec",
                filePath: "docs/auth.md",
                inChangeSet: false,
              },
            ],
          },
        ],
      },
    ],
    summary: { changedFiles: 1, filesWithLinks: 1 },
  });
});

test("computeRelated marks counterparts that are themselves in the change set", () => {
  const graph = graphFrom([["src/auth/login.ts", LOGIN_TS]], [["docs/auth.md", AUTH_MD]]);

  const result = computeRelated(graph, ["src/auth/login.ts", "docs/auth.md"]);

  const codeFile = result.files.find((file) => file.filePath === "src/auth/login.ts");
  expect(codeFile?.endpoints[0]?.counterparts).toEqual([
    { endpoint: "docs/auth.md#login-spec", filePath: "docs/auth.md", inChangeSet: true },
  ]);
});
test("computeRelated excludes changed files without counterparts but counts them", () => {
  const graph = graphFrom([["src/auth/login.ts", LOGIN_TS]], [["docs/auth.md", AUTH_MD]]);

  const result = computeRelated(graph, ["src/auth/login.ts", "bun.lock", "src/other.ts"]);

  expect(result.files.map((file) => file.filePath)).toEqual(["src/auth/login.ts"]);
  expect(result.summary).toEqual({ changedFiles: 3, filesWithLinks: 1 });
});

test("computeRelated lists the code counterpart of a changed doc file", () => {
  const graph = graphFrom([["src/auth/login.ts", LOGIN_TS]], [["docs/auth.md", AUTH_MD]]);

  const result = computeRelated(graph, ["docs/auth.md"]);

  expect(result.files).toEqual([
    {
      filePath: "docs/auth.md",
      endpoints: [
        {
          endpoint: "docs/auth.md#login-spec",
          counterparts: [
            { endpoint: "src/auth/login.ts#login", filePath: "src/auth/login.ts", inChangeSet: false },
          ],
        },
      ],
    },
  ]);
});

test("computeRelated includes resolvable one-way links", () => {
  // The doc heading exists but has no @code backlink: still a counterpart.
  const oneWayDoc = "## Login Spec\n";
  const graph = graphFrom([["src/auth/login.ts", LOGIN_TS]], [["docs/auth.md", oneWayDoc]]);

  const result = computeRelated(graph, ["src/auth/login.ts"]);

  expect(result.files[0]?.endpoints[0]?.counterparts).toEqual([
    { endpoint: "docs/auth.md#login-spec", filePath: "docs/auth.md", inChangeSet: false },
  ]);
});

test("computeRelated dedupes repeated changed paths", () => {
  const graph = graphFrom([["src/auth/login.ts", LOGIN_TS]], [["docs/auth.md", AUTH_MD]]);

  const result = computeRelated(graph, ["src/auth/login.ts", "src/auth/login.ts"]);

  expect(result.files).toHaveLength(1);
  expect(result.summary).toEqual({ changedFiles: 1, filesWithLinks: 1 });
});

test("computeRelated orders files by path and endpoints by position", () => {
  const zTs = ["/**", " * @doc docs/auth.md#login-spec", " */", "export function zeta() {}", ""].join("\n");
  const multiDoc = [
    "<!-- @code src/auth/login.ts#login -->",
    "## Login Spec",
    "",
    "<!-- @code src/auth/login.ts#login -->",
    "## Another Spec",
    "",
  ].join("\n");
  const graph = graphFrom(
    [
      ["src/z.ts", zTs],
      ["src/auth/login.ts", LOGIN_TS],
    ],
    [["docs/auth.md", multiDoc]],
  );

  const result = computeRelated(graph, ["src/z.ts", "docs/auth.md", "src/auth/login.ts"]);

  expect(result.files.map((file) => file.filePath)).toEqual(["docs/auth.md", "src/auth/login.ts", "src/z.ts"]);
  expect(result.files[0]?.endpoints.map((endpoint) => endpoint.endpoint)).toEqual([
    "docs/auth.md#login-spec",
    "docs/auth.md#another-spec",
  ]);
});

test("normalizeChangedPaths keeps root-relative paths as-is", () => {
  expect(normalizeChangedPaths("/repo", ["src/a.ts", "docs/b.md"])).toEqual(["src/a.ts", "docs/b.md"]);
});

test("normalizeChangedPaths relativizes absolute paths against the root", () => {
  expect(normalizeChangedPaths("/repo", ["/repo/src/a.ts"])).toEqual(["src/a.ts"]);
});

test("normalizeChangedPaths strips leading ./ segments", () => {
  expect(normalizeChangedPaths("/repo", ["./src/a.ts"])).toEqual(["src/a.ts"]);
});

test("normalizeChangedPaths drops empty and whitespace-only entries", () => {
  expect(normalizeChangedPaths("/repo", ["", "  ", "src/a.ts"])).toEqual(["src/a.ts"]);
});
