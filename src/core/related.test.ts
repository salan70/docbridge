import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { collectGateViolations, computeRelated, normalizeChangedPaths, related } from "./related";
import { graphFrom, makeProject } from "./test-support";

const LOGIN_TS = [
  "/**",
  " * @doc docs/auth.md#login-spec",
  " */",
  "export function login() {}",
  "",
].join("\n");

const AUTH_MD = ["<!-- @code src/auth/login.ts#login -->", "## Login Spec", ""].join("\n");
const BASIC_SOURCES = {
  code: [["src/auth/login.ts", LOGIN_TS]],
  docs: [["docs/auth.md", AUTH_MD]],
} satisfies Parameters<typeof graphFrom>[0];

test("computeRelated includes resolvable one-way links", () => {
  // The doc heading exists but has no @code backlink: still a counterpart.
  const oneWayDoc = "## Login Spec\n";
  const graph = graphFrom({
    code: [["src/auth/login.ts", LOGIN_TS]],
    docs: [["docs/auth.md", oneWayDoc]],
  });

  const result = computeRelated(graph, ["src/auth/login.ts"]);

  expect(result.files[0]?.endpoints[0]?.counterparts).toEqual([
    { endpoint: "docs/auth.md#login-spec", filePath: "docs/auth.md", inChangeSet: false },
  ]);
});

test("computeRelated dedupes repeated changed paths", () => {
  const graph = graphFrom(BASIC_SOURCES);

  const result = computeRelated(graph, ["src/auth/login.ts", "src/auth/login.ts"]);

  expect(result.files).toHaveLength(1);
  expect(result.summary).toEqual({ changedFiles: 1, filesWithLinks: 1 });
});

test("computeRelated orders files by path and endpoints by position", () => {
  const zTs = [
    "/**",
    " * @doc docs/auth.md#login-spec",
    " */",
    "export function zeta() {}",
    "",
  ].join("\n");
  const multiDoc = [
    "<!-- @code src/auth/login.ts#login -->",
    "## Login Spec",
    "",
    "<!-- @code src/auth/login.ts#login -->",
    "## Another Spec",
    "",
  ].join("\n");
  const graph = graphFrom({
    code: [
      ["src/z.ts", zTs],
      ["src/auth/login.ts", LOGIN_TS],
    ],
    docs: [["docs/auth.md", multiDoc]],
  });

  const result = computeRelated(graph, ["src/z.ts", "docs/auth.md", "src/auth/login.ts"]);

  expect(result.files.map((file) => file.filePath)).toEqual([
    "docs/auth.md",
    "src/auth/login.ts",
    "src/z.ts",
  ]);
  expect(result.files[0]?.endpoints.map((endpoint) => endpoint.endpoint)).toEqual([
    "docs/auth.md#login-spec",
    "docs/auth.md#another-spec",
  ]);
});

test("collectGateViolations reports the unchanged code counterpart of a changed doc", () => {
  const graph = graphFrom(BASIC_SOURCES);

  const result = computeRelated(graph, ["docs/auth.md"]);

  expect(collectGateViolations(result)).toEqual([
    {
      changedEndpoint: "docs/auth.md#login-spec",
      changedFilePath: "docs/auth.md",
      counterpartEndpoint: "src/auth/login.ts#login",
      counterpartFilePath: "src/auth/login.ts",
    },
  ]);
});

test("normalizeChangedPaths relativizes absolute paths against the root", () => {
  expect(normalizeChangedPaths("/repo", ["/repo/src/a.ts"])).toEqual(["src/a.ts"]);
});

test("normalizeChangedPaths drops empty and whitespace-only entries", () => {
  expect(normalizeChangedPaths("/repo", ["", "  ", "src/a.ts"])).toEqual(["src/a.ts"]);
});

test("normalizeChangedPaths dedupes paths that normalize to the same file", () => {
  expect(normalizeChangedPaths("/repo", ["src/a.ts", "./src/a.ts", "/repo/src/a.ts"])).toEqual([
    "src/a.ts",
  ]);
});

function manifestProject(): string {
  return makeProject({
    "docbridge.config.json": JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
    }),
    "docbridge.links.json": JSON.stringify({
      links: [{ code: "src/auth.ts#AuthService.login", doc: "docs/auth.md#login-flow" }],
    }),
    "src/auth.ts": "export class AuthService {\n  login() {}\n}\n",
    "docs/auth.md": "## Login Flow\n\nThe service authenticates by email.\n",
  });
}

test("related --gate reports a manifest-linked counterpart", () => {
  const root = manifestProject();

  try {
    const outcome = related({ projectRoot: root, changedFiles: ["src/auth.ts"] });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(collectGateViolations(outcome.result)).toEqual([
      {
        changedFilePath: "src/auth.ts",
        changedEndpoint: "src/auth.ts#AuthService.login",
        counterpartEndpoint: "docs/auth.md#login-flow",
        counterpartFilePath: "docs/auth.md",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
