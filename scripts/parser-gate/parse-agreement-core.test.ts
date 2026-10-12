import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  AGREEMENT_LANGUAGES,
  agreementFails,
  classify,
  computeDigest,
  executablePath,
  formatAgreementTable,
  formatDigestTable,
  isExcludedPath,
  languageOfPath,
  parseCandidateLine,
  scannedPathOf,
  selectSourceFiles,
  summarizeAgreement,
  toPosixPath,
} from "./parse-agreement-core";

describe("languageOfPath", () => {
  test("maps suffixes to languages", () => {
    expect(languageOfPath("a/b.tsx")).toBe("typescript");
    expect(languageOfPath("a/b.mjs")).toBe("javascript");
    expect(languageOfPath("a/B.java")).toBe("java");
    expect(languageOfPath("a/b.py")).toBe("python");
  });

  test("rejects declaration files and unknown suffixes", () => {
    expect(languageOfPath("a/b.d.ts")).toBeUndefined();
    expect(languageOfPath("a/b.md")).toBeUndefined();
  });
});

describe("isExcludedPath", () => {
  test("excludes build and dependency directories at any depth", () => {
    expect(isExcludedPath("node_modules/x/index.js")).toBe(true);
    expect(isExcludedPath("packages/p/target/debug/x.rs")).toBe(true);
    expect(isExcludedPath(".tmp/parser-gate/corpus/a.go")).toBe(true);
  });

  test("keeps ordinary paths, including names that only contain an excluded name", () => {
    expect(isExcludedPath("src/scan/code/dispatch.ts")).toBe(false);
    expect(isExcludedPath("src/targets/a.ts")).toBe(false);
  });
});

describe("selectSourceFiles", () => {
  test("keeps the language's files outside excluded directories, sorted and unique", () => {
    const paths = ["z.py", "node_modules/a.py", "a.py", "a.rb", "z.py", "x/dist/b.py"];
    expect(selectSourceFiles(paths, "python")).toEqual(["a.py", "z.py"]);
  });
});

describe("scannedPathOf", () => {
  test("gives an input.txt the language's suffix", () => {
    expect(scannedPathOf("c/rust/input.txt", "rust")).toBe("c/rust/input.rs");
    expect(scannedPathOf("c/java/input.txt", "java")).toBe("c/java/input.java");
  });

  test("keeps other paths", () => {
    expect(scannedPathOf("src/a.ts", "typescript")).toBe("src/a.ts");
  });
});

describe("classify", () => {
  test("names the four combinations", () => {
    expect(classify(false, true)).toBe("bothAccept");
    expect(classify(true, false)).toBe("bothReject");
    expect(classify(false, false)).toBe("shippedOnly");
    expect(classify(true, true)).toBe("candidateOnly");
  });
});

describe("parseCandidateLine", () => {
  test("reads accepted, rejected and unreadable lines", () => {
    expect(parseCandidateLine('{"path":"a","accepted":true,"error":null,"micros":3}')).toEqual({
      path: "a",
      accepted: true,
    });
    expect(
      parseCandidateLine('{"path":"b","accepted":false,"error":{"line":1,"column":2},"micros":3}'),
    ).toEqual({ path: "b", accepted: false });
    expect(parseCandidateLine('{"path":"c","unreadable":true}')).toEqual({
      path: "c",
      unreadable: true,
    });
  });

  test("throws on a line that is not a result", () => {
    expect(() => parseCandidateLine("{}")).toThrow();
  });
});

describe("summarizeAgreement", () => {
  const rows = [
    { language: "go" as const, path: "a.go", outcome: "bothAccept" as const },
    { language: "go" as const, path: "b.go", outcome: "candidateOnly" as const },
    { language: "rust" as const, path: "a.rs", outcome: "shippedOnly" as const },
  ];

  test("counts per language and lists the disagreements", () => {
    const summary = summarizeAgreement(rows);
    expect(summary.languages.go).toEqual({
      files: 2,
      bothAccept: 1,
      bothReject: 0,
      shippedOnly: 0,
      candidateOnly: 1,
    });
    expect(summary.languages.python.files).toBe(0);
    expect(summary.shippedOnly).toEqual(["a.rs"]);
    expect(summary.candidateOnly).toEqual(["b.go"]);
  });

  test("fails only on a shipped-only file", () => {
    expect(agreementFails(summarizeAgreement(rows))).toBe(true);
    expect(agreementFails(summarizeAgreement(rows.slice(0, 2)))).toBe(false);
  });

  test("table has a row per language and a total", () => {
    const table = formatAgreementTable(summarizeAgreement(rows));
    for (const language of AGREEMENT_LANGUAGES) {
      expect(table).toContain(language);
    }
    expect(table).toContain("TOTAL");
  });
});

describe("toPosixPath", () => {
  test("replaces the platform separator with a slash", () => {
    expect(toPosixPath("a\\b\\c.go", "\\")).toBe("a/b/c.go");
    expect(toPosixPath("a/b/c.go", "/")).toBe("a/b/c.go");
  });
});

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

describe("computeDigest", () => {
  const entries = [
    { language: "go" as const, path: "b.go", accepted: false },
    { language: "rust" as const, path: "a.rs", accepted: true },
    { language: "go" as const, path: "a.go", accepted: true },
  ];

  test("hashes sorted path-tab-verdict lines per language", () => {
    const digest = computeDigest(entries);
    expect(digest.languages.go).toEqual({
      files: 2,
      accepted: 1,
      rejected: 1,
      sha256: sha("a.go\taccept\nb.go\treject"),
    });
    expect(digest.languages.rust.sha256).toBe(sha("a.rs\taccept"));
    expect(digest.languages.python).toEqual({
      files: 0,
      accepted: 0,
      rejected: 0,
      sha256: sha(""),
    });
  });

  test("hashes all languages' lines together in path order", () => {
    expect(computeDigest(entries).sha256).toBe(sha("a.go\taccept\na.rs\taccept\nb.go\treject"));
  });

  test("does not depend on the input order", () => {
    expect(computeDigest(entries.toReversed())).toEqual(computeDigest(entries));
  });

  test("orders paths by code unit, not by locale", () => {
    const digest = computeDigest([
      { language: "go", path: "a_b.go", accepted: true },
      { language: "go", path: "a/b.go", accepted: true },
      { language: "go", path: "B.go", accepted: true },
    ]);
    expect(digest.languages.go.sha256).toBe(sha("B.go\taccept\na/b.go\taccept\na_b.go\taccept"));
  });

  test("table has a row per language and the overall digest", () => {
    const table = formatDigestTable(computeDigest(entries));
    for (const language of AGREEMENT_LANGUAGES) {
      expect(table).toContain(language);
    }
    expect(table).toContain("ALL");
    expect(table).toContain(computeDigest(entries).sha256);
  });
});

describe("executablePath", () => {
  test("adds the .exe suffix on Windows only", () => {
    expect(executablePath("/a/parser-gate", "win32")).toBe("/a/parser-gate.exe");
    expect(executablePath("/a/parser-gate", "linux")).toBe("/a/parser-gate");
  });
});
