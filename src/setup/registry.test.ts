import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fetchLatestStableVersion,
  NPM_REGISTRY_LATEST_URL,
  resolveLatestStableVersion,
  resolveRegistryUrl,
  selectStableVersion,
  type FetchLike,
} from "./registry";
import { readUpdateCache, UPDATE_CACHE_SCHEMA_VERSION, writeUpdateCache } from "./update-cache";

async function withTempCache(run: (cachePath: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "docbridge-registry-"));
  try {
    await run(join(directory, "update-check.json"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function stubFetch(payload: unknown, ok = true): FetchLike & { calls: number } {
  const state = { calls: 0 };
  const impl: FetchLike = async () => {
    state.calls += 1;
    return { ok, json: async () => payload };
  };
  return Object.assign(impl, {
    get calls() {
      return state.calls;
    },
  });
}

const failingFetch: FetchLike = () => Promise.reject(new Error("offline"));

const brokenBody: FetchLike = async () => ({
  ok: true,
  json: () => Promise.reject(new Error("invalid json")),
});

const neverSettles: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      reject(new Error("aborted"));
    });
  });

test("selectStableVersion reads the manifest version", () => {
  expect(selectStableVersion({ version: "0.9.0" })).toBe("0.9.0");
});

test.each([
  [{ version: "0.9.0-rc.1" }, "prerelease manifest"],
  [{ version: 9 }, "non-string version"],
  [{}, "missing version"],
  [null, "null payload"],
  ["0.9.0", "string payload"],
])("selectStableVersion ignores %o (%s)", (payload) => {
  expect(selectStableVersion(payload)).toBeUndefined();
});

test("resolveRegistryUrl defaults to the public npm registry", () => {
  expect(resolveRegistryUrl({})).toBe(NPM_REGISTRY_LATEST_URL);
});

test("resolveRegistryUrl honors an explicit override", () => {
  expect(
    resolveRegistryUrl({ DOCBRIDGE_REGISTRY_URL: "https://mirror.test/docbridge/latest" }),
  ).toBe("https://mirror.test/docbridge/latest");
});

test("fetchLatestStableVersion returns the stable version", async () => {
  await expect(
    fetchLatestStableVersion({
      url: "https://registry.test",
      fetchImpl: stubFetch({ version: "0.9.0" }),
    }),
  ).resolves.toBe("0.9.0");
});

test("fetchLatestStableVersion returns undefined for a non-2xx response", async () => {
  await expect(
    fetchLatestStableVersion({
      url: "https://registry.test",
      fetchImpl: stubFetch({ version: "0.9.0" }, false),
    }),
  ).resolves.toBeUndefined();
});

test("fetchLatestStableVersion swallows network failures", async () => {
  await expect(
    fetchLatestStableVersion({ url: "https://registry.test", fetchImpl: failingFetch }),
  ).resolves.toBeUndefined();
});

test("fetchLatestStableVersion swallows an unparsable body", async () => {
  await expect(
    fetchLatestStableVersion({ url: "https://registry.test", fetchImpl: brokenBody }),
  ).resolves.toBeUndefined();
});

test("fetchLatestStableVersion aborts through the bounded timeout signal", async () => {
  await expect(
    fetchLatestStableVersion({
      url: "https://registry.test",
      timeoutMs: 5,
      fetchImpl: neverSettles,
    }),
  ).resolves.toBeUndefined();
});

test("resolveLatestStableVersion serves a fresh cache record without a request", async () => {
  await withTempCache(async (cachePath) => {
    writeUpdateCache(cachePath, {
      schema: UPDATE_CACHE_SCHEMA_VERSION,
      checkedAt: 1_000,
      latest: "0.9.0",
    });
    const fetchImpl = stubFetch({ version: "1.0.0" });

    await expect(
      resolveLatestStableVersion({
        cachePath,
        now: 1_500,
        fetchImpl,
        url: "https://registry.test",
      }),
    ).resolves.toEqual({ status: "ok", latest: "0.9.0", source: "cache" });
    expect(fetchImpl.calls).toBe(0);
  });
});

test("resolveLatestStableVersion reports a cached lookup failure without a request", async () => {
  await withTempCache(async (cachePath) => {
    writeUpdateCache(cachePath, {
      schema: UPDATE_CACHE_SCHEMA_VERSION,
      checkedAt: 1_000,
      latest: null,
    });
    const fetchImpl = stubFetch({ version: "1.0.0" });

    await expect(
      resolveLatestStableVersion({
        cachePath,
        now: 1_500,
        fetchImpl,
        url: "https://registry.test",
      }),
    ).resolves.toEqual({ status: "unavailable", source: "cache" });
    expect(fetchImpl.calls).toBe(0);
  });
});

test("resolveLatestStableVersion refreshes a stale record and rewrites the cache", async () => {
  await withTempCache(async (cachePath) => {
    writeUpdateCache(cachePath, {
      schema: UPDATE_CACHE_SCHEMA_VERSION,
      checkedAt: 0,
      latest: "0.8.0",
    });
    const now = 5 * 24 * 60 * 60 * 1_000;

    await expect(
      resolveLatestStableVersion({
        cachePath,
        now,
        fetchImpl: stubFetch({ version: "0.9.0" }),
        url: "https://registry.test",
      }),
    ).resolves.toEqual({ status: "ok", latest: "0.9.0", source: "network" });
    expect(readUpdateCache(cachePath)).toEqual({
      schema: UPDATE_CACHE_SCHEMA_VERSION,
      checkedAt: now,
      latest: "0.9.0",
    });
  });
});

test("resolveLatestStableVersion bypasses a fresh record when forced", async () => {
  await withTempCache(async (cachePath) => {
    writeUpdateCache(cachePath, {
      schema: UPDATE_CACHE_SCHEMA_VERSION,
      checkedAt: 1_000,
      latest: "0.9.0",
    });

    await expect(
      resolveLatestStableVersion({
        cachePath,
        now: 1_500,
        forceRefresh: true,
        fetchImpl: stubFetch({ version: "1.0.0" }),
        url: "https://registry.test",
      }),
    ).resolves.toEqual({ status: "ok", latest: "1.0.0", source: "network" });
  });
});

test("resolveLatestStableVersion caches a network failure so it is retried later", async () => {
  await withTempCache(async (cachePath) => {
    await expect(
      resolveLatestStableVersion({
        cachePath,
        now: 2_000,
        fetchImpl: failingFetch,
        url: "https://registry.test",
      }),
    ).resolves.toEqual({ status: "unavailable", source: "network" });
    expect(readUpdateCache(cachePath)).toEqual({
      schema: UPDATE_CACHE_SCHEMA_VERSION,
      checkedAt: 2_000,
      latest: null,
    });
  });
});

test("resolveLatestStableVersion ignores a corrupt cache and refreshes", async () => {
  await withTempCache(async (cachePath) => {
    writeUpdateCache(cachePath, {
      schema: UPDATE_CACHE_SCHEMA_VERSION,
      checkedAt: 1_000,
      latest: "0.9.0",
    });
    writeFileSync(cachePath, "{ broken", "utf8");

    await expect(
      resolveLatestStableVersion({
        cachePath,
        now: 1_500,
        fetchImpl: stubFetch({ version: "1.0.0" }),
        url: "https://registry.test",
      }),
    ).resolves.toEqual({ status: "ok", latest: "1.0.0", source: "network" });
  });
});
