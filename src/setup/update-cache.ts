/**
 * User-level cache for the npm registry `latest` lookup.
 *
 * The cache exists so a human-readable invocation costs at most one registry
 * request per day and nothing at all on the other invocations. It is advisory:
 * every read failure, parse failure, schema mismatch, and write failure is
 * swallowed, and the caller simply behaves as if no record existed.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Roughly one day. Refreshing more often adds latency without adding signal. */
export const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Bumped whenever the record shape changes; older records are ignored. */
export const UPDATE_CACHE_SCHEMA_VERSION = 1;

export type UpdateCacheRecord = {
  schema: number;
  /** Epoch milliseconds of the lookup that produced this record. */
  checkedAt: number;
  /** Latest stable version, or `null` when the lookup itself failed. */
  latest: string | null;
};

/** Only the variables read here; `process.env` satisfies it structurally. */
type CacheEnv = Readonly<Record<string, string | undefined>>;

/**
 * Resolve the cache file path. `DOCBRIDGE_UPDATE_CACHE` names the file
 * directly, `XDG_CACHE_HOME` names the cache root, and the fallback is
 * `~/.cache/`. The path never depends on the project root, so the daily budget
 * is per user rather than per repository.
 *
 * @doc docs/specs/cli.md#update-check-cache
 */
export function resolveUpdateCachePath(
  env: CacheEnv = process.env,
  home: string = homedir(),
): string {
  const explicit = env.DOCBRIDGE_UPDATE_CACHE;
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }

  const cacheRoot =
    env.XDG_CACHE_HOME !== undefined && env.XDG_CACHE_HOME.length > 0
      ? env.XDG_CACHE_HOME
      : join(home, ".cache");
  return join(cacheRoot, "docbridge", "update-check.json");
}

/** Read a well-formed record, or `undefined` for a missing or unusable file. */
export function readUpdateCache(path: string): UpdateCacheRecord | undefined {
  let rawText: string;
  try {
    rawText = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return undefined;
  }

  return toUpdateCacheRecord(parsed);
}

/** Persist a record, ignoring every filesystem failure. */
export function writeUpdateCache(path: string, record: UpdateCacheRecord): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  } catch {
    // The cache is advisory; an unwritable home directory must not fail a command.
  }
}

/** Report whether a record is recent enough to be used without a new lookup. */
export function isUpdateCacheFresh(
  record: UpdateCacheRecord,
  now: number,
  ttlMs: number = UPDATE_CACHE_TTL_MS,
): boolean {
  const age = now - record.checkedAt;
  return age >= 0 && age < ttlMs;
}

function toUpdateCacheRecord(value: unknown): UpdateCacheRecord | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.schema !== UPDATE_CACHE_SCHEMA_VERSION) {
    return undefined;
  }
  if (typeof candidate.checkedAt !== "number" || !Number.isFinite(candidate.checkedAt)) {
    return undefined;
  }
  if (candidate.latest !== null && typeof candidate.latest !== "string") {
    return undefined;
  }

  return {
    schema: UPDATE_CACHE_SCHEMA_VERSION,
    checkedAt: candidate.checkedAt,
    latest: candidate.latest,
  };
}
