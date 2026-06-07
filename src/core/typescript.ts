import ts from "typescript";

import { parseLinkTarget } from "./links";
import type {
  CodeSymbolEndpoint,
  DocLinkAnnotation,
  SourceLocation,
  SpecLinkDiagnostic,
} from "./types";

export type TypeScriptScanResult = {
  filePath: string;
  symbols: CodeSymbolEndpoint[];
  /**
   * Supported, top-level exported declarations whose `file#name` endpoint has no
   * `@doc` annotation. Used by audit mode to emit `undocumented_symbol`.
   */
  undocumentedSymbols: CodeSymbolEndpoint[];
  links: DocLinkAnnotation[];
  diagnostics: SpecLinkDiagnostic[];
};

type DocTag = {
  rawTarget: string;
  location: SourceLocation;
};

type SupportedDeclaration = {
  symbolName: string;
  location: SourceLocation;
  docTags: DocTag[];
};

/**
 * @doc docs/specs/scanning.md#typescript-scanning
 */
export function scanTypeScript(
  filePath: string,
  content: string,
): TypeScriptScanResult {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const parseDiagnostics = getParseDiagnostics(sourceFile);
  if (parseDiagnostics.length > 0) {
    const first = parseDiagnostics[0];
    return {
      filePath,
      symbols: [],
      undocumentedSymbols: [],
      links: [],
      diagnostics: [parseErrorDiagnostic(filePath, sourceFile, first)],
    };
  }

  const diagnostics: SpecLinkDiagnostic[] = [];
  const symbols: CodeSymbolEndpoint[] = [];
  const undocumentedSymbols: CodeSymbolEndpoint[] = [];
  const links: DocLinkAnnotation[] = [];

  // Collect every supported, top-level exported declaration in source order.
  // Unsupported declarations are diagnosed (when annotated) but not recorded.
  const declarations: SupportedDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    const docTags = collectDocTags(filePath, sourceFile, statement);

    const supported = describeSupportedDeclaration(
      filePath,
      sourceFile,
      statement,
      docTags,
    );

    if (supported === null) {
      // Only annotated unsupported declarations are reported; bare ones are
      // ignored entirely.
      if (docTags.length > 0) {
        diagnostics.push(
          unsupportedDeclarationDiagnostic(filePath, docTags[0].location),
        );
      }
      continue;
    }

    declarations.push(supported);
  }

  // An endpoint is documented when any of its declarations carries @doc.
  const documentedEndpoints = new Set<string>();
  for (const declaration of declarations) {
    if (declaration.docTags.length > 0) {
      documentedEndpoints.add(`${filePath}#${declaration.symbolName}`);
    }
  }

  // Track endpoints that already exposed a @doc-annotated declaration so we can
  // emit duplicate_code_symbol when a second one appears.
  const endpointSeen = new Set<string>();
  const duplicateReported = new Set<string>();
  const undocumentedSeen = new Set<string>();

  for (const declaration of declarations) {
    const endpoint = `${filePath}#${declaration.symbolName}`;

    if (!documentedEndpoints.has(endpoint)) {
      if (!undocumentedSeen.has(endpoint)) {
        undocumentedSeen.add(endpoint);
        undocumentedSymbols.push({
          kind: "code",
          filePath,
          symbolName: declaration.symbolName,
          endpoint,
          location: declaration.location,
        });
      }
      continue;
    }

    // Non-annotated declarations of a documented endpoint are subsumed by the
    // annotated one and produce nothing.
    if (declaration.docTags.length === 0) {
      continue;
    }

    if (endpointSeen.has(endpoint)) {
      if (!duplicateReported.has(endpoint)) {
        diagnostics.push(
          duplicateCodeSymbolDiagnostic(endpoint, declaration.location),
        );
        duplicateReported.add(endpoint);
      }
      // The endpoint is duplicated; do not emit a second symbol or its links.
      continue;
    }
    endpointSeen.add(endpoint);

    symbols.push({
      kind: "code",
      filePath,
      symbolName: declaration.symbolName,
      endpoint,
      location: declaration.location,
    });

    const linkTargetsSeen = new Set<string>();
    for (const docTag of declaration.docTags) {
      const parsed = parseLinkTarget(docTag.rawTarget, {
        source: endpoint,
        sourceFilePath: filePath,
        location: docTag.location,
      });

      if (!parsed.ok) {
        diagnostics.push(parsed.diagnostic);
        continue;
      }

      if (linkTargetsSeen.has(docTag.rawTarget)) {
        diagnostics.push(
          duplicateLinkDiagnostic(endpoint, docTag.rawTarget, docTag.location),
        );
        continue;
      }
      linkTargetsSeen.add(docTag.rawTarget);

      links.push({
        direction: "code-to-doc",
        source: endpoint,
        target: docTag.rawTarget,
        location: docTag.location,
      });
    }
  }

  return { filePath, symbols, undocumentedSymbols, links, diagnostics };
}

function getParseDiagnostics(sourceFile: ts.SourceFile): ts.Diagnostic[] {
  // parseDiagnostics is not part of the public typings but is populated by
  // ts.createSourceFile and is the only source of syntactic parse errors here.
  const withDiagnostics = sourceFile as ts.SourceFile & {
    parseDiagnostics?: ts.DiagnosticWithLocation[];
  };
  return withDiagnostics.parseDiagnostics ?? [];
}

function collectDocTags(
  filePath: string,
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
): DocTag[] {
  const node = jsDocCarrier(statement);
  const location = locationOf(filePath, sourceFile, statement);

  const tags: DocTag[] = [];
  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.escapedText !== "doc") {
      continue;
    }
    const rawTarget = firstToken(commentText(tag.comment));
    if (rawTarget === undefined) {
      continue;
    }
    tags.push({ rawTarget, location });
  }
  return tags;
}

// For a VariableStatement the JSDoc attaches to the statement, while
// ts.getJSDocTags resolves tags via the node and its relevant parents.
function jsDocCarrier(statement: ts.Statement): ts.Node {
  if (ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations[0];
    if (declaration !== undefined) {
      return declaration;
    }
  }
  return statement;
}

function describeSupportedDeclaration(
  filePath: string,
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
  docTags: DocTag[],
): SupportedDeclaration | null {
  const symbolName = supportedSymbolName(statement);
  if (symbolName === null) {
    return null;
  }
  return {
    symbolName,
    location: locationOf(filePath, sourceFile, statement),
    docTags,
  };
}

function supportedSymbolName(statement: ts.Statement): string | null {
  const isExported = hasExportModifier(statement);
  const isDefault = hasDefaultModifier(statement);

  if (ts.isFunctionDeclaration(statement)) {
    if (!isExported || statement.name === undefined) {
      return null;
    }
    return statement.name.text;
  }

  if (ts.isClassDeclaration(statement)) {
    if (!isExported || statement.name === undefined) {
      return null;
    }
    return statement.name.text;
  }

  if (ts.isInterfaceDeclaration(statement)) {
    return isExported && !isDefault ? statement.name.text : null;
  }

  if (ts.isTypeAliasDeclaration(statement)) {
    return isExported && !isDefault ? statement.name.text : null;
  }

  if (ts.isEnumDeclaration(statement)) {
    return isExported && !isDefault ? statement.name.text : null;
  }

  if (ts.isVariableStatement(statement)) {
    if (!isExported) {
      return null;
    }
    const declarations = statement.declarationList.declarations;
    if (declarations.length !== 1) {
      return null;
    }
    const name = declarations[0].name;
    return ts.isIdentifier(name) ? name.text : null;
  }

  return null;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return hasModifier(statement, ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(statement: ts.Statement): boolean {
  return hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
}

function hasModifier(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(statement)
    ? ts.getModifiers(statement)
    : undefined;
  return modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function locationOf(
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): SourceLocation {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { filePath, line: line + 1, column: character + 1 };
}

function commentText(
  comment: string | ts.NodeArray<ts.JSDocComment> | undefined,
): string {
  if (comment === undefined) {
    return "";
  }
  if (typeof comment === "string") {
    return comment;
  }
  return comment.map((part) => part.text).join("");
}

function firstToken(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.split(/\s+/)[0];
}

function parseErrorDiagnostic(
  filePath: string,
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic | undefined,
): SpecLinkDiagnostic {
  const location: SourceLocation = { filePath, line: 1, column: 1 };
  if (
    diagnostic !== undefined &&
    diagnostic.start !== undefined &&
    diagnostic.file !== undefined
  ) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      diagnostic.start,
    );
    location.line = line + 1;
    location.column = character + 1;
  }

  const detail =
    diagnostic === undefined
      ? "TypeScript file has a syntactic parse error."
      : ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

  return {
    severity: "error",
    code: "typescript_parse_error",
    target: filePath,
    message: `TypeScript parse error: ${detail}`,
    location,
  };
}

function unsupportedDeclarationDiagnostic(
  filePath: string,
  location: SourceLocation,
): SpecLinkDiagnostic {
  return {
    severity: "warning",
    code: "unsupported_declaration",
    target: filePath,
    message:
      "@doc is attached to an unsupported declaration. Supported declarations are top-level exported function, class, interface, type, single-declarator const, enum, and named default function or class.",
    location,
  };
}

function duplicateCodeSymbolDiagnostic(
  endpoint: string,
  location: SourceLocation,
): SpecLinkDiagnostic {
  return {
    severity: "error",
    code: "duplicate_code_symbol",
    target: endpoint,
    message: `Multiple @doc-annotated declarations expose the same code endpoint ${endpoint}.`,
    location,
  };
}

function duplicateLinkDiagnostic(
  source: string,
  target: string,
  location: SourceLocation,
): SpecLinkDiagnostic {
  return {
    severity: "warning",
    code: "duplicate_link",
    target,
    source,
    message: `Duplicate @doc link from ${source} to ${target}.`,
    location,
  };
}
