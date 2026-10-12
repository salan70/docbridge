import { describe, expect, test } from "bun:test";

import {
  OPERATIONAL_LANGUAGES,
  adversarialInputs,
  cancelVerdict,
  classifyRun,
  finalResult,
  formatOperationalTable,
  nestedPythonBlockDepth,
  operationalFails,
  randomPrintableText,
  type RunResult,
} from "./operational-core";

const SIZES = { depth: 50, repeatedBytes: 2_000, lineBytes: 1_000, randomBytes: 500 };

describe("adversarialInputs", () => {
  test("every language gets the seven planned inputs", () => {
    for (const language of OPERATIONAL_LANGUAGES) {
      expect(adversarialInputs(language, SIZES).map((input) => input.name)).toEqual([
        "nest-paren",
        "nest-bracket",
        "nest-block",
        "nest-closure",
        "repeated-declarations",
        "long-line",
        "random-text",
      ]);
    }
  });

  test("is deterministic", () => {
    for (const language of OPERATIONAL_LANGUAGES) {
      const first = adversarialInputs(language, SIZES).map((input) => input.generate());
      const second = adversarialInputs(language, SIZES).map((input) => input.generate());
      expect(second).toEqual(first);
    }
  });

  test("nests to the requested depth", () => {
    const paren = adversarialInputs("swift", SIZES).find((input) => input.name === "nest-paren");
    expect((paren?.generate().split("(").length ?? 0) - 1).toBe(50);
    const closure = adversarialInputs("go", SIZES).find((input) => input.name === "nest-closure");
    expect((closure?.generate().split("func()").length ?? 0) - 1).toBe(50);
  });

  test("repeated declarations reach the size and use distinct names", () => {
    const repeated = adversarialInputs("python", SIZES).find(
      (input) => input.name === "repeated-declarations",
    );
    const text = repeated?.generate() ?? "";
    expect(text.length).toBeGreaterThanOrEqual(2_000);
    const names = text.match(/def (\w+)/g) ?? [];
    expect(new Set(names).size).toBe(names.length);
  });

  test("the long line is one line of the requested size", () => {
    const line = adversarialInputs("swift", SIZES).find((input) => input.name === "long-line");
    const text = line?.generate() ?? "";
    expect(text.trimEnd().includes("\n")).toBe(false);
    expect(text.length).toBeGreaterThanOrEqual(1_000);
  });

  test("Python indentation nesting is reduced and the change is recorded", () => {
    const sizes = { ...SIZES, depth: 100_000 };
    const block = adversarialInputs("python", sizes).find((input) => input.name === "nest-block");
    expect(block?.note).toContain("reduced");
    const other = adversarialInputs("ruby", sizes).find((input) => input.name === "nest-block");
    expect(other?.note).toBeUndefined();
  });
});

describe("nestedPythonBlockDepth", () => {
  test("keeps a small depth and caps a large one so the file fits", () => {
    expect(nestedPythonBlockDepth(10, 1_000_000)).toBe(10);
    const depth = nestedPythonBlockDepth(100_000, 1_000_000);
    expect(depth).toBeLessThan(100_000);
    const size = (depth * (depth - 1)) / 2 + 6 * depth;
    expect(size).toBeLessThanOrEqual(1_000_000);
    const next = depth + 1;
    expect((next * (next - 1)) / 2 + 6 * next).toBeGreaterThan(1_000_000);
  });
});

describe("randomPrintableText", () => {
  test("is deterministic, printable, and the requested size", () => {
    const text = randomPrintableText(1_000, 7);
    expect(text).toBe(randomPrintableText(1_000, 7));
    expect(text).not.toBe(randomPrintableText(1_000, 8));
    expect(text.length).toBe(1_000);
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
  });
});

describe("classifyRun", () => {
  const base = { status: 0 as number | null, signal: null, timedOut: false, accepted: true };

  test("maps process outcomes", () => {
    expect(classifyRun(base)).toBe("accepted");
    expect(classifyRun({ ...base, accepted: false })).toBe("rejected");
    expect(classifyRun({ ...base, status: null, signal: "SIGSEGV" })).toBe("crash");
    expect(classifyRun({ ...base, status: 134 })).toBe("crash");
    expect(classifyRun({ ...base, status: null, signal: "SIGTERM", timedOut: true })).toBe(
      "timeout",
    );
  });
});

function entry(result: RunResult, retry?: RunResult) {
  return {
    language: "go" as const,
    name: "x",
    result,
    micros: 1,
    ...(retry === undefined ? {} : { retry: { result: retry, micros: 1 } }),
  };
}

describe("finalResult and operationalFails", () => {
  const passing = { runs: 20, cancelled: 20, maxLatencyMicros: 5_000, pass: true };

  test("the retry result is final", () => {
    expect(finalResult(entry("crash", "accepted"))).toBe("accepted");
    expect(finalResult(entry("accepted"))).toBe("accepted");
  });

  test("a crash that the big stack fixes does not fail", () => {
    expect(operationalFails([entry("crash", "rejected")], [passing])).toBe(false);
  });

  test("a final crash, a timeout, or a failed cancel fails", () => {
    expect(operationalFails([entry("crash", "crash")], [])).toBe(true);
    expect(operationalFails([entry("timeout")], [])).toBe(true);
    expect(operationalFails([entry("accepted")], [{ ...passing, pass: false }])).toBe(true);
    expect(operationalFails([entry("rejected")], [passing])).toBe(false);
  });

  test("a timeout still fails when the unbounded rerun finishes", () => {
    const timedOut = {
      ...entry("timeout"),
      unbounded: { result: "accepted" as const, micros: 14 },
    };
    expect(finalResult(timedOut)).toBe("timeout");
    expect(operationalFails([timedOut], [passing])).toBe(true);
  });
});

describe("cancelVerdict", () => {
  test("passes when every run cancelled within 100 ms", () => {
    const samples = Array.from({ length: 20 }, () => ({ cancelled: true, latencyMicros: 100_000 }));
    expect(cancelVerdict(samples).pass).toBe(true);
  });

  test("fails on a run that was not cancelled or was slow", () => {
    const ok = { cancelled: true, latencyMicros: 10 };
    expect(cancelVerdict([ok, { cancelled: false, latencyMicros: 0 }]).pass).toBe(false);
    expect(cancelVerdict([ok, { cancelled: true, latencyMicros: 100_001 }]).pass).toBe(false);
    expect(cancelVerdict([]).pass).toBe(false);
  });
});

describe("formatOperationalTable", () => {
  test("shows every input row and the cancellation rows", () => {
    const table = formatOperationalTable(
      [
        {
          language: "go",
          name: "nest-paren",
          result: "crash",
          micros: 5,
          retry: { result: "accepted", micros: 9 },
        },
      ],
      [{ language: "swift", runs: 20, cancelled: 20, maxLatencyMicros: 4_000, pass: true }],
    );
    expect(table).toContain("nest-paren");
    expect(table).toContain("crash");
    expect(table).toContain("accepted");
    expect(table).toContain("cancel swift");
  });

  test("shows the time of the rerun that follows a timeout", () => {
    const table = formatOperationalTable(
      [
        {
          language: "swift",
          name: "repeated-declarations",
          result: "timeout",
          micros: 0,
          unbounded: { result: "accepted", micros: 14_200_000 },
        },
      ],
      [],
    );
    expect(table).toContain("timeout");
    expect(table).toContain("accepted (14200000)");
  });
});
