#!/usr/bin/env bun

import { readProseBlocks } from "./prose-markdown";

const PROSE_KINDS = ["issue", "pull-request", "document", "plan"] as const;

export type ProseKind = (typeof PROSE_KINDS)[number];

export type ProseWarning =
  | {
      code: "word-limit";
      actual: number;
      limit: number;
    }
  | {
      code: "long-paragraph";
      line: number;
      actual: number;
      limit: number;
    }
  | {
      code: "long-sentence";
      line: number;
      sentence: number;
      actual: number;
      limit: number;
    }
  | {
      code: "paragraph-sentences";
      line: number;
      actual: number;
      limit: number;
    }
  | {
      code: "duplicate-paragraph";
      line: number;
      originalLine: number;
      actual: number;
      limit: number;
    };

export type ProseReport = {
  kind: ProseKind;
  wordCount: number;
  paragraphCount: number;
  warnings: ProseWarning[];
};

type ProseReportIo = {
  readStdin: () => Promise<string>;
  readFile: (path: string) => Promise<string>;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

type Paragraph = {
  line: number;
  words: string[];
  text: string;
  countableText: string;
};

const WORD_LIMITS: Partial<Record<ProseKind, number>> = {
  issue: 800,
  "pull-request": 500,
  plan: 1_500,
};
const PARAGRAPH_WORD_LIMIT = 120;
const SENTENCE_WORD_LIMIT = 25;
const PARAGRAPH_SENTENCE_LIMIT = 5;
const DUPLICATE_PARAGRAPH_MINIMUM = 20;
const USAGE = "Usage: prose-report <issue|pull-request|document|plan> <path|->";

export function analyzeProse(source: string, kind: ProseKind): ProseReport {
  const blocks = readProseBlocks(source);
  const allWords = blocks.flatMap((block) => extractWords(block.countableText));
  const paragraphs: Paragraph[] = blocks
    .filter((block) => block.paragraph)
    .map((block) => ({ ...block, words: extractWords(block.countableText) }))
    .filter((paragraph) => paragraph.words.length > 0);
  const warnings: ProseWarning[] = [];
  const wordLimit = WORD_LIMITS[kind];

  if (wordLimit !== undefined && allWords.length > wordLimit) {
    warnings.push({ code: "word-limit", actual: allWords.length, limit: wordLimit });
  }

  for (const paragraph of paragraphs) {
    if (paragraph.words.length > PARAGRAPH_WORD_LIMIT) {
      warnings.push({
        code: "long-paragraph",
        line: paragraph.line,
        actual: paragraph.words.length,
        limit: PARAGRAPH_WORD_LIMIT,
      });
    }
    warnings.push(...sentenceWarnings(paragraph));
  }

  const firstLines = new Map<string, number>();
  for (const paragraph of paragraphs) {
    if (paragraph.words.length < DUPLICATE_PARAGRAPH_MINIMUM) {
      continue;
    }
    const normalized = extractWords(paragraph.text).join(" ").toLowerCase();
    const originalLine = firstLines.get(normalized);
    if (originalLine === undefined) {
      firstLines.set(normalized, paragraph.line);
      continue;
    }
    warnings.push({
      code: "duplicate-paragraph",
      line: paragraph.line,
      originalLine,
      actual: paragraph.words.length,
      limit: DUPLICATE_PARAGRAPH_MINIMUM,
    });
  }

  return {
    kind,
    wordCount: allWords.length,
    paragraphCount: paragraphs.length,
    warnings,
  };
}

function extractWords(source: string): string[] {
  return source.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? [];
}

function sentenceWarnings(paragraph: Paragraph): ProseWarning[] {
  const sentences = sentenceWords(paragraph.countableText);
  const warnings: ProseWarning[] = [];
  for (const [index, words] of sentences.entries()) {
    if (words.length > SENTENCE_WORD_LIMIT) {
      warnings.push({
        code: "long-sentence",
        line: paragraph.line,
        sentence: index + 1,
        actual: words.length,
        limit: SENTENCE_WORD_LIMIT,
      });
    }
  }
  if (sentences.length > PARAGRAPH_SENTENCE_LIMIT) {
    warnings.push({
      code: "paragraph-sentences",
      line: paragraph.line,
      actual: sentences.length,
      limit: PARAGRAPH_SENTENCE_LIMIT,
    });
  }
  return warnings;
}

function sentenceWords(source: string): string[][] {
  const segments: string[] = [];
  let start = 0;
  for (const match of source.matchAll(/[.!?]+["'”’)\]]*(?:\s+|$)/g)) {
    const prefix = source.slice(Math.max(0, match.index - 8), match.index + 1);
    if (/\b(?:e\.g|i\.e|mr|mrs|dr|prof)\.$/i.test(prefix)) {
      continue;
    }
    const end = match.index + match[0].length;
    segments.push(source.slice(start, end));
    start = end;
  }
  segments.push(source.slice(start));
  return segments.map(extractWords).filter((words) => words.length > 0);
}

function formatReport(report: ProseReport): string {
  const lines = [
    `Prose report (${report.kind}): ${report.wordCount} words, ${report.paragraphCount} paragraphs`,
  ];
  if (report.warnings.length === 0) {
    lines.push("No advisory warnings.");
    return lines.join("\n");
  }

  for (const warning of report.warnings) {
    if (warning.code === "word-limit") {
      lines.push(
        `warning ${warning.code}: ${warning.actual} words exceeds advisory limit ${warning.limit}.`,
      );
    } else if (warning.code === "long-paragraph") {
      lines.push(
        `warning ${warning.code}: line ${warning.line} has ${warning.actual} words; advisory limit is ${warning.limit}.`,
      );
    } else if (warning.code === "long-sentence") {
      lines.push(
        `warning ${warning.code}: sentence ${warning.sentence} in the paragraph at line ${warning.line} has ${warning.actual} words; advisory limit is ${warning.limit}.`,
      );
    } else if (warning.code === "paragraph-sentences") {
      lines.push(
        `warning ${warning.code}: paragraph at line ${warning.line} has ${warning.actual} sentences; advisory limit is ${warning.limit}.`,
      );
    } else {
      lines.push(
        `warning ${warning.code}: line ${warning.line} repeats the ${warning.actual}-word paragraph from line ${warning.originalLine}.`,
      );
    }
  }
  return lines.join("\n");
}

function isProseKind(value: string | undefined): value is ProseKind {
  return value !== undefined && PROSE_KINDS.includes(value as ProseKind);
}

export async function runProseReport(args: string[], io: ProseReportIo): Promise<number> {
  const [kind, source] = args;
  if (args.length !== 2 || !isProseKind(kind) || source === undefined) {
    io.stderr(USAGE);
    return 1;
  }

  try {
    const content = source === "-" ? await io.readStdin() : await io.readFile(source);
    io.stdout(formatReport(analyzeProse(content, kind)));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`prose-report: ${message}`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await runProseReport(Bun.argv.slice(2), {
    readStdin: () => Bun.stdin.text(),
    readFile: (path) => Bun.file(path).text(),
    stdout: console.log,
    stderr: console.error,
  });
  process.exitCode = exitCode;
}
