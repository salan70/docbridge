/**
 * Stable semantic version parsing and comparison.
 *
 * Update notification and the `upgrade` command compare the running CLI
 * against the registry's `latest` dist-tag. Only fully stable `X.Y.Z` versions
 * participate: a prerelease is never a newer stable release, so it is rejected
 * at parse time rather than being ordered against stable versions.
 */

export type StableVersion = {
  major: number;
  minor: number;
  patch: number;
};

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Parse a stable `X.Y.Z` version. Prereleases, build metadata, `v` prefixes,
 * and any other shape return `undefined`.
 */
export function parseStableVersion(value: string): StableVersion | undefined {
  const match = STABLE_VERSION_PATTERN.exec(value.trim());
  if (match === null) {
    return undefined;
  }

  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined;
  }

  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
}

/** Order two parsed stable versions: negative, zero, or positive. */
export function compareStableVersions(left: StableVersion, right: StableVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/**
 * Report whether `candidate` is a stable release strictly newer than
 * `current`. Either side failing to parse as stable answers `false`, so a
 * prerelease build of the CLI never claims an upgrade and a prerelease on the
 * registry never triggers a notification.
 *
 * @doc docs/specs/cli.md#version-discovery
 */
export function isNewerStableVersion(candidate: string, current: string): boolean {
  const parsedCandidate = parseStableVersion(candidate);
  const parsedCurrent = parseStableVersion(current);
  if (parsedCandidate === undefined || parsedCurrent === undefined) {
    return false;
  }

  return compareStableVersions(parsedCandidate, parsedCurrent) > 0;
}
