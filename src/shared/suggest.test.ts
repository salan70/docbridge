import { expect, test } from "bun:test";

import { nearestMatch } from "./suggest";

test("nearestMatch returns the closest candidate within the distance threshold", () => {
  expect(nearestMatch("chek", ["check", "context", "graph"])).toBe("check");
});

test("nearestMatch prefers an ordered abbreviation over a closer edit distance", () => {
  expect(nearestMatch("ctx", ["check", "context"])).toBe("context");
});

test("nearestMatch returns undefined when no candidate is close enough", () => {
  expect(nearestMatch("zzzzzzzz", ["check", "context", "graph"])).toBeUndefined();
});

test("nearestMatch breaks ties by candidate order", () => {
  expect(nearestMatch("ab", ["ac", "ad"])).toBe("ac");
});

test("nearestMatch returns undefined for an empty candidate list", () => {
  expect(nearestMatch("check", [])).toBeUndefined();
});

test("nearestMatch requires three characters before treating input as an abbreviation", () => {
  // `ct` spells `context` in order, but is too short to be a confident guess.
  expect(nearestMatch("ct", ["context"])).toBeUndefined();
  expect(nearestMatch("cnt", ["context"])).toBe("context");
});

test("nearestMatch matches a member canonical ID against its siblings", () => {
  expect(nearestMatch("Session.find", ["Session.findSession", "Session.close"])).toBe(
    "Session.findSession",
  );
});
