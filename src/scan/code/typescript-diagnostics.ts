import ts from "typescript";

import type { DocBridgeDiagnostic, Range, SourceLocation } from "../../model/types";

/**
 * The diagnostics the in-process TypeScript scanner reports, kept apart from
 * the declaration walk in `./typescript`.
 */

const LANGUAGE = "typescript" as const;

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

  const detail =
    diagnostic === undefined
      ? "TypeScript file has a syntactic parse error."
      : ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

  return {
    severity: "error",
    code: "code_parse_error",
    language: LANGUAGE,
    target: filePath,
    message: `TypeScript parse error: ${detail}`,
    location,
  };
}

export function unsupportedDeclarationDiagnostic(
  filePath: string,
  location: SourceLocation,
): DocBridgeDiagnostic {
  return {
    severity: "warning",
    code: "unsupported_declaration",
    language: LANGUAGE,
    target: filePath,
    message:
      "@doc is attached to an unsupported declaration. Supported declarations are top-level exported function, class, interface, type, single-declarator const, enum, and named default function or class, plus the identifier-named members of a class, interface, or object type alias.",
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
    language: LANGUAGE,
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
