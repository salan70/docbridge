import { expect, test } from "bun:test";

import { compareStableVersions, isNewerStableVersion, parseStableVersion } from "./version";

test("parseStableVersion reads a stable release", () => {
  expect(parseStableVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
});

test("parseStableVersion tolerates surrounding whitespace", () => {
  expect(parseStableVersion(" 0.8.0\n")).toEqual({ major: 0, minor: 8, patch: 0 });
});

test.each([
  ["1.2.3-rc.1", "prerelease"],
  ["1.2.3+build.5", "build metadata"],
  ["v1.2.3", "v prefix"],
  ["1.2", "partial version"],
  ["1.2.3.4", "extra segment"],
  ["01.2.3", "leading zero"],
  ["", "empty string"],
  ["latest", "dist-tag"],
])("parseStableVersion rejects %s (%s)", (value) => {
  expect(parseStableVersion(value)).toBeUndefined();
});

function parse(value: string) {
  const parsed = parseStableVersion(value);
  if (parsed === undefined) {
    throw new Error(`Expected ${value} to parse.`);
  }
  return parsed;
}

test("compareStableVersions orders by major, then minor, then patch", () => {
  expect(compareStableVersions(parse("1.0.0"), parse("0.9.9"))).toBeGreaterThan(0);
  expect(compareStableVersions(parse("0.9.0"), parse("0.10.0"))).toBeLessThan(0);
  expect(compareStableVersions(parse("0.8.1"), parse("0.8.0"))).toBeGreaterThan(0);
  expect(compareStableVersions(parse("0.8.0"), parse("0.8.0"))).toBe(0);
});

test("isNewerStableVersion reports a newer stable release", () => {
  expect(isNewerStableVersion("0.9.0", "0.8.0")).toBe(true);
  expect(isNewerStableVersion("0.10.0", "0.9.9")).toBe(true);
});

test("isNewerStableVersion rejects same or older releases", () => {
  expect(isNewerStableVersion("0.8.0", "0.8.0")).toBe(false);
  expect(isNewerStableVersion("0.7.9", "0.8.0")).toBe(false);
});

test("isNewerStableVersion never treats a prerelease as a newer stable release", () => {
  expect(isNewerStableVersion("0.9.0-rc.1", "0.8.0")).toBe(false);
});

test("isNewerStableVersion answers false when the running version is a prerelease", () => {
  expect(isNewerStableVersion("0.9.0", "0.9.0-rc.1")).toBe(false);
});
