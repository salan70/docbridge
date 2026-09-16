/**
 * npm registry discovery of the latest stable DocBridge release.
 *
 * The lookup is deliberately independent of the local npm configuration: it
 * targets the public registry directly so a project-level `.npmrc`, a proxy
 * setting, or a missing package manager cannot change what the CLI reports.
 * Every failure is non-fatal and produces an `unavailable` result rather than
 * an exception, because the caller is always on a best-effort path.
 */

import {
  isUpdateCacheFresh,
  readUpdateCache,
  resolveUpdateCachePath,
  UPDATE_CACHE_SCHEMA_VERSION,
  writeUpdateCache,
} from "./update-cache";
import { parseStableVersion } from "./version";

/** The `latest` dist-tag manifest is a few hundred bytes; the full doc is not. */
export const NPM_REGISTRY_LATEST_URL = "https://registry.npmjs.org/docbridge/latest";

/** Short enough that a hanging registry never becomes a visible stall. */
export const REGISTRY_TIMEOUT_MS = 1_500;

export type LatestVersionSource = "cache" | "network";

export type LatestVersionLookup =
  | { status: "ok"; latest: string; source: LatestVersionSource }
  | { status: "unavailable"; source: LatestVersionSource };

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

type RegistryEnv = Readonly<Record<string, string | undefined>>;

/**
 * Extract the stable version from a registry `latest` manifest. A manifest
 * whose `version` is a prerelease is treated as absent so a `latest` dist-tag
 * pointing at a release candidate never advertises an upgrade.
 */
export function selectStableVersion(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const version = (payload as Record<string, unknown>).version;
  if (typeof version !== "string") {
    return undefined;
  }

  return parseStableVersion(version) === undefined ? undefined : version.trim();
}

export function resolveRegistryUrl(env: RegistryEnv = process.env): string {
  const override = env.DOCBRIDGE_REGISTRY_URL;
  return override !== undefined && override.length > 0 ? override : NPM_REGISTRY_LATEST_URL;
}

/**
 * Request the registry once, bounded by `timeoutMs`. Returns `undefined` for
 * every failure mode: timeout, offline, non-2xx, invalid JSON, prerelease.
 */
export async function fetchLatestStableVersion(
  options: {
    url?: string;
    timeoutMs?: number;
    fetchImpl?: FetchLike;
  } = {},
): Promise<string | undefined> {
  const fetchImpl = (options.fetchImpl ?? fetch) as FetchLike;
  const url = options.url ?? resolveRegistryUrl();

  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? REGISTRY_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return undefined;
    }
    return selectStableVersion(await response.json());
  } catch {
    return undefined;
  }
}

export type ResolveLatestOptions = {
  /** Skip a fresh cache record and always request the registry. */
  forceRefresh?: boolean;
  now?: number;
  cachePath?: string;
  url?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

/**
 * Resolve the latest stable version through the daily user-level cache,
 * requesting the registry only when no fresh record exists. The result of a
 * network attempt is always written back, including a failure, so an offline
 * machine performs at most one attempt per cache window.
 *
 * @doc docs/specs/cli.md#version-discovery
 */
export async function resolveLatestStableVersion(
  options: ResolveLatestOptions = {},
): Promise<LatestVersionLookup> {
  const now = options.now ?? Date.now();
  const cachePath = options.cachePath ?? resolveUpdateCachePath();

  if (options.forceRefresh !== true) {
    const cached = readUpdateCache(cachePath);
    if (cached !== undefined && isUpdateCacheFresh(cached, now)) {
      return cached.latest === null
        ? { status: "unavailable", source: "cache" }
        : { status: "ok", latest: cached.latest, source: "cache" };
    }
  }

  const fetched = await fetchLatestStableVersion({
    ...(options.url !== undefined ? { url: options.url } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  writeUpdateCache(cachePath, {
    schema: UPDATE_CACHE_SCHEMA_VERSION,
    checkedAt: now,
    latest: fetched ?? null,
  });

  return fetched === undefined
    ? { status: "unavailable", source: "network" }
    : { status: "ok", latest: fetched, source: "network" };
}
