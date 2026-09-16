import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isUpdateCacheFresh,
  readUpdateCache,
  resolveUpdateCachePath,
  UPDATE_CACHE_SCHEMA_VERSION,
  UPDATE_CACHE_TTL_MS,
  writeUpdateCache,
} from "./update-cache";

function withTempDir<Result>(run: (directory: string) => Result): Result {
  const directory = mkdtempSync(join(tmpdir(), "docbridge-update-cache-"));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("resolveUpdateCachePath prefers the explicit override", () => {
  expect(resolveUpdateCachePath({ DOCBRIDGE_UPDATE_CACHE: "/tmp/x.json" }, "/home/u")).toBe(
    "/tmp/x.json",
  );
});

test("resolveUpdateCachePath uses XDG_CACHE_HOME when set", () => {
  expect(resolveUpdateCachePath({ XDG_CACHE_HOME: "/cache" }, "/home/u")).toBe(
    "/cache/docbridge/update-check.json",
  );
});

test("resolveUpdateCachePath falls back to the home cache directory", () => {
  expect(resolveUpdateCachePath({}, "/home/u")).toBe("/home/u/.cache/docbridge/update-check.json");
});

test("resolveUpdateCachePath ignores empty environment values", () => {
  expect(
    resolveUpdateCachePath({ XDG_CACHE_HOME: "", DOCBRIDGE_UPDATE_CACHE: "" }, "/home/u"),
  ).toBe("/home/u/.cache/docbridge/update-check.json");
});

test("writeUpdateCache creates missing parent directories and round-trips", () => {
  withTempDir((directory) => {
    const path = join(directory, "nested", "update-check.json");
    writeUpdateCache(path, { schema: UPDATE_CACHE_SCHEMA_VERSION, checkedAt: 42, latest: "0.9.0" });

    expect(readUpdateCache(path)).toEqual({
      schema: UPDATE_CACHE_SCHEMA_VERSION,
      checkedAt: 42,
      latest: "0.9.0",
    });
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
  });
});

test("writeUpdateCache records a failed lookup as null", () => {
  withTempDir((directory) => {
    const path = join(directory, "update-check.json");
    writeUpdateCache(path, { schema: UPDATE_CACHE_SCHEMA_VERSION, checkedAt: 1, latest: null });

    expect(readUpdateCache(path)?.latest).toBeNull();
  });
});

test("writeUpdateCache swallows filesystem failures", () => {
  withTempDir((directory) => {
    const blocker = join(directory, "blocker");
    writeFileSync(blocker, "not a directory\n", "utf8");

    expect(() => {
      writeUpdateCache(join(blocker, "update-check.json"), {
        schema: UPDATE_CACHE_SCHEMA_VERSION,
        checkedAt: 1,
        latest: "0.9.0",
      });
    }).not.toThrow();
  });
});

test("readUpdateCache returns undefined for a missing file", () => {
  withTempDir((directory) => {
    expect(readUpdateCache(join(directory, "absent.json"))).toBeUndefined();
  });
});

test("readUpdateCache returns undefined for a directory", () => {
  withTempDir((directory) => {
    mkdirSync(join(directory, "as-directory"));
    expect(readUpdateCache(join(directory, "as-directory"))).toBeUndefined();
  });
});

test.each([
  ["not json at all", "corrupt text"],
  ["null", "json null"],
  ['"0.9.0"', "json string"],
  ['{"checkedAt":1,"latest":"0.9.0"}', "missing schema"],
  ['{"schema":99,"checkedAt":1,"latest":"0.9.0"}', "unknown schema"],
  ['{"schema":1,"latest":"0.9.0"}', "missing checkedAt"],
  ['{"schema":1,"checkedAt":"1","latest":"0.9.0"}', "non-numeric checkedAt"],
  ['{"schema":1,"checkedAt":1,"latest":9}', "non-string latest"],
])("readUpdateCache ignores %s (%s)", (content) => {
  withTempDir((directory) => {
    const path = join(directory, "update-check.json");
    writeFileSync(path, content, "utf8");

    expect(readUpdateCache(path)).toBeUndefined();
  });
});

test("isUpdateCacheFresh accepts a record inside the window", () => {
  const record = { schema: UPDATE_CACHE_SCHEMA_VERSION, checkedAt: 1_000, latest: "0.9.0" };
  expect(isUpdateCacheFresh(record, 1_000 + UPDATE_CACHE_TTL_MS - 1)).toBe(true);
});

test("isUpdateCacheFresh rejects a record at or past the window", () => {
  const record = { schema: UPDATE_CACHE_SCHEMA_VERSION, checkedAt: 1_000, latest: "0.9.0" };
  expect(isUpdateCacheFresh(record, 1_000 + UPDATE_CACHE_TTL_MS)).toBe(false);
});

test("isUpdateCacheFresh rejects a record stamped in the future", () => {
  const record = { schema: UPDATE_CACHE_SCHEMA_VERSION, checkedAt: 5_000, latest: "0.9.0" };
  expect(isUpdateCacheFresh(record, 1_000)).toBe(false);
});
