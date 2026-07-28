import ts from "typescript";

import type { CodeLanguageAdapter, CodeScanOptions, CodeScanResult } from "./code-scanner";
import { parseLinkTarget, type ParseLinkTargetOptions } from "./links";
import type {
  CodeSymbolEndpoint,
  DocLinkAnnotation,
  Range,
  SourceLocation,
  DocBridgeDiagnostic,
} from "./types";

const LANGUAGE = "typescript" as const;

/**
 * The in-process TypeScript code language adapter. Visibility options are not
 * used: TypeScript scope stays exported top-level declarations.
 */
export const typeScriptAdapter: CodeLanguageAdapter = {
  language: LANGUAGE,
  scanFile(filePath: string, content: string, _options: CodeScanOptions) {
    return scanTypeScript(filePath, content);
  },
};

type DocTag = {
  rawTarget: string;
  location: SourceLocation;
  targetRange?: Range;
};

type SupportedDeclaration = {
  symbolName: string;
  canonicalId: string;
  /**
   * Type members are linkable but never required to be documented, so they stay
   * out of the audit symbol set. See
   * `docs/decisions/typescript-member-endpoints.md`.
   */
  isMember: boolean;
  location: SourceLocation;
  nameRange?: Range;
  declarationRange?: Range;
  signatureRange?: Range;
  docTags: DocTag[];
};

/**
 * @doc docs/specs/scanning.md#typescript-scanning
 */
export function scanTypeScript(filePath: string, content: string): CodeScanResult {
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
      language: LANGUAGE,
      filePath,
      symbols: [],
      undocumentedSymbols: [],
      links: [],
      diagnostics: [parseErrorDiagnostic(filePath, sourceFile, first)],
    };
  }

  const diagnostics: DocBridgeDiagnostic[] = [];
  const symbols: CodeSymbolEndpoint[] = [];
  const undocumentedSymbols: CodeSymbolEndpoint[] = [];
  const links: DocLinkAnnotation[] = [];

  // Collect every supported, top-level exported declaration in source order.
  // Unsupported declarations are diagnosed (when annotated) but not recorded.
  const declarations: SupportedDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    const docTags = collectDocTags(filePath, sourceFile, statement);

    const supported = describeSupportedDeclaration(filePath, sourceFile, statement, docTags);

    if (supported === null) {
      // Only annotated unsupported declarations are reported; bare ones are
      // ignored entirely.
      const firstDocTag = docTags[0];
      if (firstDocTag) {
        diagnostics.push(unsupportedDeclarationDiagnostic(filePath, firstDocTag.location));
      }
    } else {
      declarations.push(supported);
    }

    // Members are collected whether or not their container is itself an
    // endpoint, so an annotated member of a non-exported type is diagnosed the
    // same way an annotated non-exported top-level declaration already is.
    collectMemberDeclarations(filePath, sourceFile, statement, declarations, diagnostics);
  }

  // An endpoint is documented when any of its declarations carries @doc.
  const documentedEndpoints = new Set<string>();
  for (const declaration of declarations) {
    if (declaration.docTags.length > 0) {
      documentedEndpoints.add(`${filePath}#${declaration.canonicalId}`);
    }
  }

  // Track endpoints that already exposed a @doc-annotated declaration so we can
  // emit duplicate_code_symbol when a second one appears.
  const endpointSeen = new Set<string>();
  const duplicateReported = new Set<string>();
  const undocumentedSeen = new Set<string>();

  for (const declaration of declarations) {
    const endpoint = `${filePath}#${declaration.canonicalId}`;

    if (!documentedEndpoints.has(endpoint)) {
      if (!declaration.isMember && !undocumentedSeen.has(endpoint)) {
        undocumentedSeen.add(endpoint);
        undocumentedSymbols.push(makeCodeSymbol(filePath, endpoint, declaration));
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
          duplicateCodeSymbolDiagnostic(endpoint, declaration.location, declaration.nameRange),
        );
        duplicateReported.add(endpoint);
      }
      // The endpoint is duplicated; do not emit a second symbol or its links.
      continue;
    }
    endpointSeen.add(endpoint);

    symbols.push(makeCodeSymbol(filePath, endpoint, declaration));

    const linkTargetsSeen = new Set<string>();
    for (const docTag of declaration.docTags) {
      const parseOptions: ParseLinkTargetOptions = {
        source: endpoint,
        sourceFilePath: filePath,
        location: docTag.location,
      };
      if (docTag.targetRange !== undefined) {
        parseOptions.targetRange = docTag.targetRange;
      }
      const parsed = parseLinkTarget(docTag.rawTarget, parseOptions);

      if (!parsed.ok) {
        diagnostics.push(parsed.diagnostic);
        continue;
      }

      if (linkTargetsSeen.has(docTag.rawTarget)) {
        diagnostics.push(
          duplicateLinkDiagnostic(endpoint, docTag.rawTarget, docTag.location, docTag.targetRange),
        );
        continue;
      }
      linkTargetsSeen.add(docTag.rawTarget);

      const link: DocLinkAnnotation = {
        direction: "code-to-doc",
        source: endpoint,
        target: docTag.rawTarget,
        location: docTag.location,
      };
      if (docTag.targetRange !== undefined) {
        link.targetRange = docTag.targetRange;
      }
      links.push(link);
    }
  }

  return {
    language: LANGUAGE,
    filePath,
    symbols,
    undocumentedSymbols,
    links,
    diagnostics,
  };
}

function getParseDiagnostics(sourceFile: ts.SourceFile): ts.Diagnostic[] {
  // parseDiagnostics is not part of the public typings but is populated by
  // ts.createSourceFile and is the only source of syntactic parse errors here.
  const withDiagnostics = sourceFile as ts.SourceFile & {
    parseDiagnostics?: ts.DiagnosticWithLocation[];
  };
  return withDiagnostics.parseDiagnostics ?? [];
}

function collectDocTags(filePath: string, sourceFile: ts.SourceFile, statement: ts.Node): DocTag[] {
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
    const docTag: DocTag = { rawTarget, location };
    const targetRange = targetRangeOf(sourceFile, tag, rawTarget);
    if (targetRange !== undefined) {
      docTag.targetRange = targetRange;
    }
    tags.push(docTag);
  }
  return tags;
}

// For a VariableStatement the JSDoc attaches to the statement, while
// ts.getJSDocTags resolves tags via the node and its relevant parents.
function jsDocCarrier(statement: ts.Node): ts.Node {
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
  const nameNode = supportedNameNode(statement);
  if (nameNode === null) {
    return null;
  }
  const declaration: SupportedDeclaration = {
    symbolName: nameNode.text,
    canonicalId: nameNode.text,
    isMember: false,
    location: locationOf(filePath, sourceFile, statement),
    docTags,
  };
  declaration.nameRange = rangeOfNode(sourceFile, nameNode);
  const declarationStart = statement.getStart(sourceFile, /* includeJsDocComment */ true);
  declaration.declarationRange = rangeFromOffsets(sourceFile, declarationStart, statement.getEnd());
  declaration.signatureRange = rangeFromOffsets(
    sourceFile,
    declarationStart,
    signatureEndOffset(sourceFile, statement),
  );
  return declaration;
}

/**
 * Collect the type members of a top-level container. Annotated members that are
 * not endpoints are diagnosed here rather than ignored, so the scope limit is
 * visible to whoever hits it.
 */
function collectMemberDeclarations(
  filePath: string,
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
  declarations: SupportedDeclaration[],
  diagnostics: DocBridgeDiagnostic[],
): void {
  const container = describeContainer(statement);
  if (container === null) {
    return;
  }

  for (const member of container.members) {
    diagnoseParameterProperties(filePath, sourceFile, member, diagnostics);

    const docTags = collectDocTags(filePath, sourceFile, member);
    const described =
      container.name === null
        ? null
        : describeMember(filePath, sourceFile, container.name, member, docTags);

    if (described === null) {
      const firstDocTag = docTags[0];
      if (firstDocTag) {
        diagnostics.push(unsupportedDeclarationDiagnostic(filePath, firstDocTag.location));
      }
      continue;
    }

    declarations.push(described);
  }
}

/**
 * A parameter property declares a class property from inside the constructor
 * signature. It is out of scope, so an annotation on one is diagnosed rather
 * than ignored. `ts.getJSDocTags` on a parameter does not resolve the enclosing
 * constructor's JSDoc, so this cannot double-report the constructor's own tag.
 */
function diagnoseParameterProperties(
  filePath: string,
  sourceFile: ts.SourceFile,
  member: ts.Node,
  diagnostics: DocBridgeDiagnostic[],
): void {
  if (!ts.isConstructorDeclaration(member)) {
    return;
  }

  for (const parameter of member.parameters) {
    const firstDocTag = collectDocTags(filePath, sourceFile, parameter)[0];
    if (firstDocTag) {
      diagnostics.push(unsupportedDeclarationDiagnostic(filePath, firstDocTag.location));
    }
  }
}

type MemberContainer = {
  /**
   * The qualifier of every member's canonical ID, or `null` when the container
   * cannot host endpoints at all. A `null` name still visits the members, so an
   * annotation on one is diagnosed rather than silently ignored.
   */
  name: string | null;
  members: readonly ts.Node[];
};

/**
 * Return the member container a top-level statement exposes, or `null` when it
 * has none.
 *
 * The qualifier is the statement's own top-level endpoint name, so a container
 * that is not an endpoint — a non-exported class, an anonymous default-exported
 * class — hosts no endpoints either. `enum` is visited despite never hosting an
 * endpoint, because visiting is what makes `unsupported_declaration` reachable
 * on an annotated enum member.
 */
function describeContainer(statement: ts.Statement): MemberContainer | null {
  const members = containerMembers(statement);
  if (members === null) {
    return null;
  }
  return { name: supportedNameNode(statement)?.text ?? null, members };
}

function containerMembers(statement: ts.Statement): readonly ts.Node[] | null {
  if (ts.isClassDeclaration(statement)) {
    return statement.members;
  }

  if (ts.isInterfaceDeclaration(statement)) {
    return statement.members;
  }

  if (ts.isEnumDeclaration(statement)) {
    return statement.members;
  }

  // Only a type alias written directly as an object type literal has members of
  // its own. In a union or a mapped type, a property's provenance is ambiguous.
  if (ts.isTypeAliasDeclaration(statement)) {
    return ts.isTypeLiteralNode(statement.type) ? statement.type.members : null;
  }

  if (ts.isVariableStatement(statement)) {
    const declarations = statement.declarationList.declarations;
    const initializer = declarations.length === 1 ? declarations[0]?.initializer : undefined;
    return initializer !== undefined && ts.isClassExpression(initializer)
      ? initializer.members
      : null;
  }

  return null;
}

/**
 * Describe one type member, or return `null` when it is not an endpoint.
 */
function describeMember(
  filePath: string,
  sourceFile: ts.SourceFile,
  containerName: string,
  member: ts.Node,
  docTags: DocTag[],
): SupportedDeclaration | null {
  const identity = memberIdentity(sourceFile, member);
  if (identity === null) {
    return null;
  }

  const start = member.getStart(sourceFile, /* includeJsDocComment */ true);
  return {
    symbolName: identity.name,
    canonicalId: `${containerName}.${identity.name}`,
    isMember: true,
    location: locationOf(filePath, sourceFile, member),
    nameRange: identity.nameRange,
    declarationRange: rangeFromOffsets(sourceFile, start, member.getEnd()),
    signatureRange: rangeFromOffsets(
      sourceFile,
      start,
      memberSignatureEndOffset(sourceFile, member),
    ),
    docTags,
  };
}

type MemberIdentity = { name: string; nameRange: Range };

/**
 * Return the endpoint name of a member and the range that navigation triggers
 * on, or `null` when the member is not an endpoint.
 *
 * Only identifier-named members qualify. A link target is split on `#` into
 * exactly two parts and its fragment may not contain whitespace, so a private
 * identifier (`#secret`), a string-literal name, a numeric name, and a computed
 * name are all inexpressible as endpoints. Getters and setters carry no marker:
 * a `get`/`set` pair is one property in TypeScript and collapses to one
 * endpoint.
 */
function memberIdentity(sourceFile: ts.SourceFile, member: ts.Node): MemberIdentity | null {
  if (hasModifier(member, ts.SyntaxKind.PrivateKeyword)) {
    return null;
  }

  if (ts.isConstructorDeclaration(member)) {
    const keyword = member
      .getChildren(sourceFile)
      .find((child) => child.kind === ts.SyntaxKind.ConstructorKeyword);
    return keyword === undefined
      ? null
      : { name: "constructor", nameRange: rangeOfNode(sourceFile, keyword) };
  }

  if (
    !ts.isMethodDeclaration(member) &&
    !ts.isPropertyDeclaration(member) &&
    !ts.isGetAccessorDeclaration(member) &&
    !ts.isSetAccessorDeclaration(member) &&
    !ts.isMethodSignature(member) &&
    !ts.isPropertySignature(member)
  ) {
    return null;
  }

  const name = member.name;
  return ts.isIdentifier(name)
    ? { name: name.text, nameRange: rangeOfNode(sourceFile, name) }
    : null;
}

/**
 * A member's public surface ends where its implementation body begins. Members
 * without a body, such as properties, expose their whole declaration; a
 * property's initializer is part of what callers depend on.
 */
function memberSignatureEndOffset(sourceFile: ts.SourceFile, member: ts.Node): number {
  const body = (member as { body?: ts.Node }).body;
  return body?.getStart(sourceFile) ?? member.getEnd();
}

/**
 * Return the name identifier of a supported, top-level exported declaration, or
 * `null` when the statement is unsupported. The identifier node backs both the
 * symbol name and its navigation `nameRange`.
 */
function supportedNameNode(statement: ts.Statement): ts.Identifier | null {
  const isExported = hasExportModifier(statement);
  const isDefault = hasDefaultModifier(statement);

  if (ts.isFunctionDeclaration(statement)) {
    if (!isExported || statement.name === undefined) {
      return null;
    }
    return statement.name;
  }

  if (ts.isClassDeclaration(statement)) {
    if (!isExported || statement.name === undefined) {
      return null;
    }
    return statement.name;
  }

  if (ts.isInterfaceDeclaration(statement)) {
    return isExported && !isDefault ? statement.name : null;
  }

  if (ts.isTypeAliasDeclaration(statement)) {
    return isExported && !isDefault ? statement.name : null;
  }

  if (ts.isEnumDeclaration(statement)) {
    return isExported && !isDefault ? statement.name : null;
  }

  if (ts.isVariableStatement(statement)) {
    if (!isExported) {
      return null;
    }
    const declarations = statement.declarationList.declarations;
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    if (!declaration) {
      return null;
    }
    const name = declaration.name;
    return ts.isIdentifier(name) ? name : null;
  }

  return null;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return hasModifier(statement, ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(statement: ts.Statement): boolean {
  return hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function locationOf(filePath: string, sourceFile: ts.SourceFile, node: ts.Node): SourceLocation {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { filePath, line: line + 1, column: character + 1 };
}

/** Build a 1-based, end-exclusive range from absolute UTF-16 offsets. */
function rangeFromOffsets(sourceFile: ts.SourceFile, start: number, end: number): Range {
  const startPos = sourceFile.getLineAndCharacterOfPosition(start);
  const endPos = sourceFile.getLineAndCharacterOfPosition(end);
  return {
    start: { line: startPos.line + 1, column: startPos.character + 1 },
    end: { line: endPos.line + 1, column: endPos.character + 1 },
  };
}

function rangeOfNode(sourceFile: ts.SourceFile, node: ts.Node): Range {
  return rangeFromOffsets(sourceFile, node.getStart(sourceFile), node.getEnd());
}

function signatureEndOffset(sourceFile: ts.SourceFile, statement: ts.Statement): number {
  if (ts.isFunctionDeclaration(statement) && statement.body !== undefined) {
    return statement.body.getStart(sourceFile);
  }

  if (ts.isClassDeclaration(statement)) {
    return classBodyStartOffset(sourceFile, statement) ?? statement.getEnd();
  }

  if (ts.isVariableStatement(statement)) {
    return variableSignatureEndOffset(sourceFile, statement) ?? statement.getEnd();
  }

  return statement.getEnd();
}

function classBodyStartOffset(
  sourceFile: ts.SourceFile,
  statement: ts.ClassDeclaration | ts.ClassExpression,
): number | undefined {
  const searchStart =
    statement.heritageClauses?.at(-1)?.getEnd() ??
    statement.typeParameters?.at(-1)?.getEnd() ??
    statement.name?.getEnd() ??
    statement.getStart(sourceFile);
  const bodyStart = sourceFile.text.indexOf("{", searchStart);
  return bodyStart !== -1 && bodyStart < statement.getEnd() ? bodyStart : undefined;
}

function variableSignatureEndOffset(
  sourceFile: ts.SourceFile,
  statement: ts.VariableStatement,
): number | undefined {
  const declaration = statement.declarationList.declarations[0];
  const initializer = declaration?.initializer;
  if (initializer === undefined) {
    return undefined;
  }

  if (
    (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
    ts.isBlock(initializer.body)
  ) {
    return initializer.body.getStart(sourceFile);
  }

  if (ts.isObjectLiteralExpression(initializer)) {
    return initializer.getStart(sourceFile);
  }

  if (ts.isClassExpression(initializer)) {
    return classBodyStartOffset(sourceFile, initializer);
  }

  return undefined;
}

/**
 * Locate the literal target string inside a JSDoc `@doc` tag. The target is a
 * whitespace-free token, so the first occurrence at or after the tag's start is
 * the annotation target. Returns `undefined` when it cannot be located.
 */
function targetRangeOf(
  sourceFile: ts.SourceFile,
  tag: ts.JSDocTag,
  rawTarget: string,
): Range | undefined {
  const start = sourceFile.text.indexOf(rawTarget, tag.pos);
  if (start === -1) {
    return undefined;
  }
  return rangeFromOffsets(sourceFile, start, start + rawTarget.length);
}

function makeCodeSymbol(
  filePath: string,
  endpoint: string,
  declaration: SupportedDeclaration,
): CodeSymbolEndpoint {
  const symbol: CodeSymbolEndpoint = {
    kind: "code",
    language: LANGUAGE,
    filePath,
    symbolName: declaration.symbolName,
    canonicalId: declaration.canonicalId,
    endpoint,
    location: declaration.location,
  };
  if (declaration.nameRange !== undefined) {
    symbol.nameRange = declaration.nameRange;
  }
  if (declaration.declarationRange !== undefined) {
    symbol.declarationRange = declaration.declarationRange;
  }
  if (declaration.signatureRange !== undefined) {
    symbol.signatureRange = declaration.signatureRange;
  }
  return symbol;
}

function commentText(comment: string | ts.NodeArray<ts.JSDocComment> | undefined): string {
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

function unsupportedDeclarationDiagnostic(
  filePath: string,
  location: SourceLocation,
): DocBridgeDiagnostic {
  return {
    severity: "warning",
    code: "unsupported_declaration",
    language: LANGUAGE,
    target: filePath,
    message:
      "@doc is attached to an unsupported declaration. Supported declarations are top-level exported function, class, interface, type, single-declarator const, enum, and named default function or class.",
    location,
  };
}

function duplicateCodeSymbolDiagnostic(
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

function duplicateLinkDiagnostic(
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
