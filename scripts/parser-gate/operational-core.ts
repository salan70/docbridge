import { LANGUAGE_SUFFIXES } from "../../src/config/code-language";
import type { CodeLanguage } from "../../src/model/types";

/**
 * The pure parts of the operational checks: the adversarial inputs, the
 * classification of one run, and the pass rule. The runner owns the processes.
 */

export const OPERATIONAL_LANGUAGES = [
  "swift",
  "dart",
  "rust",
  "go",
  "java",
  "python",
  "ruby",
  "typescript",
  "javascript",
] as const satisfies readonly CodeLanguage[];

export type OperationalLanguage = (typeof OPERATIONAL_LANGUAGES)[number];

/** The sizes of the planned inputs, in bytes except `depth`. */
export type InputSizes = {
  depth: number;
  repeatedBytes: number;
  lineBytes: number;
  randomBytes: number;
};

export const PLANNED_SIZES: InputSizes = {
  depth: 100_000,
  repeatedBytes: 50_000_000,
  lineBytes: 10_000_000,
  randomBytes: 1_000_000,
};

/** The most an indentation-nested Python file may grow to. */
const PYTHON_BLOCK_MAX_BYTES = 10_000_000;

export type AdversarialInput = {
  name: string;
  /** What was changed from the plan, when the language cannot take the planned shape. */
  note?: string;
  generate: () => string;
};

type Template = {
  header: string;
  footer: string;
  /** One declaration with a unique name. */
  declaration: (name: string) => string;
  /** One declaration holding the string literal. */
  literal: (content: string) => string;
  /** The nested forms, wrapped in the declaration that holds them. */
  paren: (depth: number) => string;
  bracket: (depth: number) => string;
  block: (depth: number) => string;
  closure: (depth: number) => string;
};

const rep = (text: string, count: number): string => text.repeat(count);

/** `open`×depth, `core`, `close`×depth between a prefix and a suffix. */
function nest(prefix: string, open: string, core: string, close: string, suffix: string) {
  return (depth: number): string =>
    `${prefix}${rep(open, depth)}${core}${rep(close, depth)}${suffix}`;
}

const scriptLike = (keyword: string, terminator: string): Template => ({
  header: "",
  footer: "",
  declaration: (name) => `function ${name}() {}\n`,
  literal: (content) => `${keyword} s = "${content}"${terminator}\n`,
  paren: nest(`${keyword} x = `, "(", "1", ")", `${terminator}\n`),
  bracket: nest(`${keyword} x = `, "[", "", "]", `${terminator}\n`),
  block: nest("", "{", "", "}", "\n"),
  closure: (depth) => `${keyword} f = ${rep("() => ", depth)}1${terminator}\n`,
});

const TEMPLATES: Readonly<Record<OperationalLanguage, Template>> = {
  typescript: scriptLike("const", ";"),
  javascript: scriptLike("const", ";"),
  rust: {
    header: "",
    footer: "",
    declaration: (name) => `fn ${name}() {}\n`,
    literal: (content) => `const S: &str = "${content}";\n`,
    paren: nest("fn f() { let x = ", "(", "1", ")", "; }\n"),
    bracket: nest("fn f() { let x = ", "[", "", "]", "; }\n"),
    block: nest("fn f() ", "{", "", "}", "\n"),
    closure: (depth) => `fn f() { let g = ${rep("|| ", depth)}1; }\n`,
  },
  go: {
    header: "package main\n",
    footer: "",
    declaration: (name) => `func ${name}() {}\n`,
    literal: (content) => `var s = "${content}"\n`,
    paren: nest("package main\nvar x = ", "(", "1", ")", "\n"),
    bracket: nest("package main\nvar x = ", "a[", "0", "]", "\n"),
    block: nest("package main\nfunc f() ", "{", "", "}", "\n"),
    closure: (depth) =>
      `package main\nvar f = ${rep("func() { _ = ", depth)}1${rep(" }", depth)}\n`,
  },
  java: {
    header: "class A {\n",
    footer: "}\n",
    declaration: (name) => `  void ${name}() {}\n`,
    literal: (content) => `  String s = "${content}";\n`,
    paren: nest("class A { int x = ", "(", "1", ")", "; }\n"),
    bracket: nest("class A { int x = ", "a[", "0", "]", "; }\n"),
    block: nest("class A { void f() ", "{", "", "}", " }\n"),
    closure: (depth) => `class A { Object f = ${rep("() -> ", depth)}1; }\n`,
  },
  python: {
    header: "",
    footer: "",
    declaration: (name) => `def ${name}(): pass\n`,
    literal: (content) => `s = "${content}"\n`,
    paren: nest("x = ", "(", "1", ")", "\n"),
    bracket: nest("x = ", "[", "", "]", "\n"),
    // Indentation nesting grows quadratically; see `nestedPythonBlockDepth`.
    block: (depth) =>
      `${Array.from({ length: depth }, (_, level) => `${rep(" ", level)}if 1:\n`).join("")}${rep(" ", depth)}pass\n`,
    closure: (depth) => `f = ${rep("lambda: ", depth)}1\n`,
  },
  ruby: {
    header: "",
    footer: "",
    declaration: (name) => `def ${name}; end\n`,
    literal: (content) => `s = "${content}"\n`,
    paren: nest("x = ", "(", "1", ")", "\n"),
    bracket: nest("x = ", "[", "", "]", "\n"),
    block: nest("", "begin\n", "", "end\n", ""),
    closure: (depth) => `f = ${rep("-> { ", depth)}1${rep(" }", depth)}\n`,
  },
  swift: {
    header: "",
    footer: "",
    declaration: (name) => `func ${name}() {}\n`,
    literal: (content) => `let s = "${content}"\n`,
    paren: nest("let x = ", "(", "1", ")", "\n"),
    bracket: nest("let x = ", "[", "", "]", "\n"),
    block: nest("func f() ", "{", "", "}", "\n"),
    closure: (depth) => `let f = ${rep("{ ", depth)}1${rep(" }", depth)}\n`,
  },
  dart: {
    header: "",
    footer: "",
    declaration: (name) => `void ${name}() {}\n`,
    literal: (content) => `var s = "${content}";\n`,
    paren: nest("var x = ", "(", "1", ")", ";\n"),
    bracket: nest("var x = ", "[", "", "]", ";\n"),
    block: nest("void f() ", "{", "", "}", "\n"),
    closure: (depth) => `var f = ${rep("() => ", depth)}1;\n`,
  },
};

/** Level i costs i spaces and `if 1:\n`, so `depth` levels cost depth(depth-1)/2 + 6·depth bytes. */
function pythonBlockBytes(depth: number): number {
  return (depth * (depth - 1)) / 2 + 6 * depth;
}

/** The deepest indentation nesting, at most `requested`, whose file fits `maxBytes`. */
export function nestedPythonBlockDepth(requested: number, maxBytes: number): number {
  let depth = Math.min(requested, Math.floor(Math.sqrt(2 * maxBytes)));
  while (depth > 0 && pythonBlockBytes(depth) > maxBytes) {
    depth -= 1;
  }
  return depth;
}

/** Printable ASCII with a newline every 80 characters, from a fixed seed (mulberry32). */
export function randomPrintableText(bytes: number, seed: number): string {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  const characters: string[] = [];
  for (let index = 1; index <= bytes; index += 1) {
    characters.push(index % 81 === 0 ? "\n" : String.fromCharCode(0x20 + Math.floor(next() * 95)));
  }
  return characters.join("");
}

function seedOf(language: string): number {
  let hash = 2166136261;
  for (const char of language) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return hash;
}

function repeatedDeclarations(template: Template, bytes: number): string {
  const parts = [template.header];
  let size = template.header.length;
  for (let index = 0; size < bytes; index += 1) {
    const declaration = template.declaration(`f_${index}`);
    parts.push(declaration);
    size += declaration.length;
  }
  parts.push(template.footer);
  return parts.join("");
}

/** The planned inputs for one language, generated lazily so the 50 MB one is not held. */
export function adversarialInputs(
  language: OperationalLanguage,
  sizes: InputSizes,
): AdversarialInput[] {
  const template = TEMPLATES[language];
  const blockDepth =
    language === "python"
      ? nestedPythonBlockDepth(sizes.depth, PYTHON_BLOCK_MAX_BYTES)
      : sizes.depth;
  const blockNote =
    blockDepth === sizes.depth
      ? undefined
      : `indentation nesting reduced from ${sizes.depth} to ${blockDepth} levels to keep the file under ${PYTHON_BLOCK_MAX_BYTES} bytes`;
  return [
    { name: "nest-paren", generate: () => template.paren(sizes.depth) },
    { name: "nest-bracket", generate: () => template.bracket(sizes.depth) },
    {
      name: "nest-block",
      ...(blockNote === undefined ? {} : { note: blockNote }),
      generate: () => template.block(blockDepth),
    },
    { name: "nest-closure", generate: () => template.closure(sizes.depth) },
    {
      name: "repeated-declarations",
      generate: () => repeatedDeclarations(template, sizes.repeatedBytes),
    },
    {
      name: "long-line",
      generate: () =>
        `${template.header}${template.literal("a".repeat(sizes.lineBytes))}${template.footer}`,
    },
    {
      name: "random-text",
      generate: () => randomPrintableText(sizes.randomBytes, seedOf(language)),
    },
  ];
}

/** The file name of a generated input. */
export function inputFileName(language: CodeLanguage, name: string): string {
  return `${name}${LANGUAGE_SUFFIXES[language][0] ?? ""}`;
}

export type RunResult = "accepted" | "rejected" | "crash" | "timeout";

export type RunOutcome = {
  status: number | null;
  signal: string | null;
  timedOut: boolean;
  /** The verdict on the process's stdout, when it printed one. */
  accepted: boolean | undefined;
};

/** Exit 0 with a verdict is a parse; a timeout is a timeout; anything else is a crash. */
export function classifyRun({ status, timedOut, accepted }: RunOutcome): RunResult {
  if (timedOut) {
    return "timeout";
  }
  if (status !== 0 || accepted === undefined) {
    return "crash";
  }
  return accepted ? "accepted" : "rejected";
}

export type InputEntry = {
  language: OperationalLanguage;
  name: string;
  note?: string;
  result: RunResult;
  micros: number;
  /** The rerun with a 1024 MiB stack, made only after a crash. */
  retry?: { result: RunResult; micros: number };
};

export function finalResult(entry: Pick<InputEntry, "result" | "retry">): RunResult {
  return entry.retry?.result ?? entry.result;
}

export type CancelSample = { cancelled: boolean; latencyMicros: number };

export type CancelVerdict = {
  runs: number;
  cancelled: number;
  maxLatencyMicros: number;
  pass: boolean;
};

export type CancelEntry = CancelVerdict & { language: OperationalLanguage };

const CANCEL_LATENCY_LIMIT_MICROS = 100_000;

export function cancelVerdict(samples: readonly CancelSample[]): CancelVerdict {
  const cancelled = samples.filter((sample) => sample.cancelled).length;
  const maxLatencyMicros = Math.max(0, ...samples.map((sample) => sample.latencyMicros));
  return {
    runs: samples.length,
    cancelled,
    maxLatencyMicros,
    pass:
      samples.length > 0 &&
      cancelled === samples.length &&
      maxLatencyMicros <= CANCEL_LATENCY_LIMIT_MICROS,
  };
}

export function operationalFails(
  entries: readonly Pick<InputEntry, "result" | "retry">[],
  cancels: readonly { pass: boolean }[],
): boolean {
  const unusable = entries.some((entry) => {
    const result = finalResult(entry);
    return result === "crash" || result === "timeout";
  });
  return unusable || cancels.some((cancel) => !cancel.pass);
}

export function formatOperationalTable(
  entries: readonly InputEntry[],
  cancels: readonly CancelEntry[],
): string {
  const header = ["language", "input", "result", "micros", "with 1024 MiB stack"];
  const rows = [
    ...entries.map((entry) => [
      entry.language,
      entry.name,
      entry.result,
      String(entry.micros),
      entry.retry === undefined ? "-" : `${entry.retry.result} (${entry.retry.micros})`,
    ]),
    ...cancels.map((cancel) => [
      `cancel ${cancel.language}`,
      `${cancel.cancelled}/${cancel.runs} cancelled`,
      cancel.pass ? "pass" : "FAIL",
      String(cancel.maxLatencyMicros),
      "-",
    ]),
  ];
  const widths = header.map((title, index) =>
    Math.max(title.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const format = (row: readonly string[]): string =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [format(header), ...rows.map(format)].join("\n");
}
