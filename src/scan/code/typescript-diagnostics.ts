import ts from "typescript";

import { LANGUAGE_SUFFIXES } from "../../config/code-language";
import type { DocBridgeDiagnostic, Range, SourceLocation } from "../../model/types";

/**
 * The diagnostics the in-process TypeScript scanner reports, kept apart from
 * the declaration walk in `./typescript`. The scanner reads TypeScript and
 * JavaScript, so every diagnostic names the language of its file; the
 * scanner adds it to a JavaScript link diagnostic, and a TypeScript one keeps
 * the shape it had before JavaScript was registered, without a language.
 */

type ScriptLanguage = "typescript" | "javascript";

/** A file is JavaScript when it ends with a `javascript` suffix, else TypeScript. */
export function scriptLanguage(filePath: string): ScriptLanguage {
  return LANGUAGE_SUFFIXES.javascript.some((suffix) => filePath.endsWith(suffix))
    ? "javascript"
    : "typescript";
}

const LABEL: Readonly<Record<ScriptLanguage, string>> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
};

const SUPPORTED_DECLARATIONS: Readonly<Record<ScriptLanguage, string>> = {
  typescript:
    "Supported declarations are top-level exported function, class, interface, type, single-declarator const, enum, and named default function or class, plus the identifier-named members of a class, interface, or object type alias.",
  javascript:
    "Supported declarations are top-level ESM-exported function, class, single-declarator const, let, or var, and named default function or class, plus the identifier-named members of a class. CommonJS assignments are not declarations.",
};

export function parseErrorDiagnostic(
  filePath: string,
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic | undefined,
): DocBridgeDiagnostic {
  const location: SourceLocation = { filePath, line: 1, column: 1 };
  if (diagnostic !== undefined && diagnostic.start !== undefined && diagnostic.file !== undefined) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
    location.line = line + 1;
    location.column = character + 1;
  }

  const language = scriptLanguage(filePath);
  const detail =
    diagnostic === undefined
      ? `${LABEL[language]} file has a syntactic parse error.`
      : ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

  return {
    severity: "error",
    code: "code_parse_error",
    language,
    target: filePath,
    message: `${LABEL[language]} parse error: ${detail}`,
    location,
  };
}

export function unsupportedDeclarationDiagnostic(
  filePath: string,
  location: SourceLocation,
): DocBridgeDiagnostic {
  const language = scriptLanguage(filePath);
  return {
    severity: "warning",
    code: "unsupported_declaration",
    language,
    target: filePath,
    message: `@doc is attached to an unsupported declaration. ${SUPPORTED_DECLARATIONS[language]}`,
    location,
  };
}

export function duplicateCodeSymbolDiagnostic(
  endpoint: string,
  location: SourceLocation,
  range: Range | undefined,
): DocBridgeDiagnostic {
  const diagnostic: DocBridgeDiagnostic = {
    severity: "error",
    code: "duplicate_code_symbol",
    language: scriptLanguage(location.filePath),
    target: endpoint,
    message: `Multiple @doc-annotated declarations expose the same code endpoint ${endpoint}.`,
    location,
  };
  if (range !== undefined) {
    diagnostic.range = range;
  }
  return diagnostic;
}

export function duplicateLinkDiagnostic(
  source: string,
  target: string,
  location: SourceLocation,
  range: Range | undefined,
): DocBridgeDiagnostic {
  const diagnostic: DocBridgeDiagnostic = {
    severity: "warning",
    code: "duplicate_link",
    target,
    source,
    message: `Duplicate @doc link from ${source} to ${target}.`,
    location,
  };
  if (range !== undefined) {
    diagnostic.range = range;
  }
  return diagnostic;
}
