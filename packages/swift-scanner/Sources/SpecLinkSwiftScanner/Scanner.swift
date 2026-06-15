import Foundation
import SwiftParser
import SwiftSyntax

public final class Scanner {
  public init() {}

  public func scan(requestData: Data) throws -> Data {
    let request = try JSONDecoder().decode(WorkerRequest.self, from: requestData)
    let files = request.files.map { scanFile($0, visibility: request.options.visibility) }
    let response = WorkerResponse(
      schemaVersion: 1,
      requestId: request.requestId,
      language: "swift",
      files: files
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(response)
  }

  private func scanFile(_ file: WorkerFile, visibility: [String]?) -> WorkerFileResponse {
    let tree = Parser.parse(source: file.content)
    if tree.hasError {
      return WorkerFileResponse(
        filePath: file.filePath,
        symbols: [],
        undocumentedSymbols: [],
        links: [],
        diagnostics: [
          diagnostic(
            code: "code_parse_error",
            target: file.filePath,
            message: "Swift parser reported syntax errors.",
            filePath: file.filePath,
            line: 1,
            column: 1
          )
        ]
      )
    }

    let visibilitySet = Set(visibility ?? ["public", "open"])
    let converter = PositionConverter(content: file.content)
    let declarations = collectDeclarations(
      tree: tree,
      converter: converter,
      visibility: visibilitySet
    )

    var symbols: [CodeSymbol] = []
    var undocumentedSymbols: [CodeSymbol] = []
    var links: [DocLink] = []
    var diagnostics: [Diagnostic] = []
    var seenEndpoints = Set<String>()
    var duplicateEndpoints = Set<String>()

    for declaration in declarations {
      if declaration.unsupported {
        diagnostics.append(
          diagnostic(
            code: "unsupported_declaration",
            target: file.filePath,
            message: "Swift declaration annotated with @doc is not supported.",
            filePath: file.filePath,
            line: declaration.line,
            column: declaration.column,
            range: declaration.nameRange
          )
        )
        continue
      }

      guard declaration.visible else { continue }

      let symbol = makeSymbol(filePath: file.filePath, declaration: declaration)
      if declaration.docTargets.isEmpty {
        if !undocumentedSymbols.contains(where: { $0.endpoint == symbol.endpoint }) {
          undocumentedSymbols.append(symbol)
        }
        continue
      }

      if seenEndpoints.contains(symbol.endpoint) {
        if !duplicateEndpoints.contains(symbol.endpoint) {
          diagnostics.append(
            diagnostic(
              code: "duplicate_code_symbol",
              target: symbol.endpoint,
              message: "Duplicate Swift code symbol endpoint: \(symbol.endpoint)",
              filePath: file.filePath,
              line: declaration.line,
              column: declaration.column,
              range: declaration.nameRange
            )
          )
          duplicateEndpoints.insert(symbol.endpoint)
        }
        continue
      }
      seenEndpoints.insert(symbol.endpoint)
      symbols.append(symbol)

      var seenTargets = Set<String>()
      for docTarget in declaration.docTargets where !seenTargets.contains(docTarget.target) {
        seenTargets.insert(docTarget.target)
        links.append(
          DocLink(
            direction: "code-to-doc",
            source: symbol.endpoint,
            target: docTarget.target,
            location: SourceLocation(
              filePath: file.filePath,
              line: docTarget.line,
              column: docTarget.column
            ),
            targetRange: docTarget.range
          )
        )
      }
    }

    return WorkerFileResponse(
      filePath: file.filePath,
      symbols: symbols,
      undocumentedSymbols: undocumentedSymbols,
      links: links,
      diagnostics: diagnostics
    )
  }
}

private struct Declaration {
  let symbolName: String
  let canonicalId: String
  let line: Int
  let column: Int
  let visible: Bool
  let unsupported: Bool
  let nameRange: SourceRange?
  let declarationRange: SourceRange?
  let signatureRange: SourceRange?
  let docTargets: [DocTarget]
}

private struct DocTarget {
  let target: String
  let line: Int
  let column: Int
  let range: SourceRange?
}

// MARK: - AST-based declaration collection

/// Walk the parsed syntax tree and emit one `Declaration` per supported
/// declaration, plus an `unsupported` marker for `@doc`-annotated declarations
/// that SpecLink does not canonicalize. Scope qualification, argument labels,
/// and `@doc` extraction all come from the AST so multi-line signatures and
/// braces inside comments or string literals cannot perturb the result.
private func collectDeclarations(
  tree: SourceFileSyntax,
  converter: PositionConverter,
  visibility: Set<String>
) -> [Declaration] {
  var collector = DeclarationCollector(converter: converter, visibility: visibility)
  collector.walkTopLevel(tree.statements)
  return collector.declarations
}

private let SUPPORTED_VISIBILITY_KEYWORDS: Set<String> = [
  "open", "public", "internal", "fileprivate", "private",
]

private struct DeclarationCollector {
  let converter: PositionConverter
  let visibility: Set<String>
  var declarations: [Declaration] = []

  mutating func walkTopLevel(_ statements: CodeBlockItemListSyntax) {
    for statement in statements {
      switch statement.item {
      case .decl(let decl):
        handle(decl: decl, typeQualifier: nil)
      case .stmt(let stmt):
        markUnsupportedIfAnnotated(Syntax(stmt))
      case .expr(let expr):
        markUnsupportedIfAnnotated(Syntax(expr))
      }
    }
  }

  mutating func walkMembers(_ members: MemberBlockItemListSyntax, typeQualifier: String?) {
    for member in members {
      handle(decl: member.decl, typeQualifier: typeQualifier)
    }
  }

  mutating func handle(decl: DeclSyntax, typeQualifier: String?) {
    if let typeDecl = decl.asTypeDeclaration {
      let name = typeDecl.name
      let canonicalId = qualify(typeQualifier, name)
      record(
        decl: decl,
        symbolName: name,
        canonicalId: canonicalId,
        nameToken: typeDecl.nameToken,
        signatureEnd: typeDecl.signatureEnd
      )
      walkMembers(typeDecl.members, typeQualifier: name)
      return
    }

    if let ext = decl.as(ExtensionDeclSyntax.self) {
      // Extensions do not produce a symbol; their members canonicalize against
      // the extended type. A `@doc` on the extension itself is ignored, matching
      // the previous scanner behavior.
      walkMembers(ext.memberBlock.members, typeQualifier: ext.extendedType.trimmedDescription)
      return
    }

    if let function = decl.as(FunctionDeclSyntax.self) {
      let name = function.name.text
      let labels = argumentLabels(function.signature.parameterClause.parameters)
      let prefix = typeQualifier.map { "\($0)." } ?? ""
      record(
        decl: decl,
        symbolName: name,
        canonicalId: "\(prefix)\(name)(\(labels))",
        nameToken: function.name,
        signatureEnd: function.signature.endPositionBeforeTrailingTrivia
      )
      return
    }

    if let initializer = decl.as(InitializerDeclSyntax.self) {
      let labels = argumentLabels(initializer.signature.parameterClause.parameters)
      let prefix = typeQualifier.map { "\($0)." } ?? ""
      record(
        decl: decl,
        symbolName: "init",
        canonicalId: "\(prefix)init(\(labels))",
        nameToken: initializer.initKeyword,
        signatureEnd: initializer.signature.endPositionBeforeTrailingTrivia
      )
      return
    }

    if let variable = decl.as(VariableDeclSyntax.self) {
      guard
        let binding = variable.bindings.first,
        let identifier = binding.pattern.as(IdentifierPatternSyntax.self)?.identifier
      else {
        markUnsupportedIfAnnotated(Syntax(decl))
        return
      }
      let name = identifier.text
      let prefix = typeQualifier.map { "\($0)." } ?? ""
      record(
        decl: decl,
        symbolName: name,
        canonicalId: "\(prefix)\(name)",
        nameToken: identifier,
        signatureEnd: variable.endPositionBeforeTrailingTrivia
      )
      return
    }

    markUnsupportedIfAnnotated(Syntax(decl))
  }

  private func qualify(_ typeQualifier: String?, _ name: String) -> String {
    typeQualifier.map { "\($0).\(name)" } ?? name
  }

  /// Record a supported declaration. Visibility filtering and the documented vs
  /// undocumented split happen downstream in `scanFile`.
  private mutating func record(
    decl: DeclSyntax,
    symbolName: String,
    canonicalId: String,
    nameToken: TokenSyntax,
    signatureEnd: AbsolutePosition
  ) {
    let doc = docTargets(for: decl)
    let visible = visibility.contains(accessLevel(of: decl))
    let namePosition = nameToken.positionAfterSkippingLeadingTrivia
    let (nameLine, nameColumn) = converter.lineColumn(at: namePosition)

    let declarationStart = doc.startOffset ?? decl.positionAfterSkippingLeadingTrivia.utf8Offset

    declarations.append(
      Declaration(
        symbolName: symbolName,
        canonicalId: canonicalId,
        line: nameLine,
        column: nameColumn,
        visible: visible,
        unsupported: false,
        nameRange: converter.range(
          from: namePosition,
          to: nameToken.endPositionBeforeTrailingTrivia
        ),
        declarationRange: converter.range(
          fromOffset: declarationStart,
          to: decl.endPositionBeforeTrailingTrivia
        ),
        signatureRange: converter.range(fromOffset: declarationStart, to: signatureEnd),
        docTargets: doc.targets
      )
    )
  }

  private mutating func markUnsupportedIfAnnotated(_ node: Syntax) {
    let doc = docTargets(for: node)
    guard !doc.targets.isEmpty else { return }
    let position = node.positionAfterSkippingLeadingTrivia
    let (line, column) = converter.lineColumn(at: position)
    declarations.append(
      Declaration(
        symbolName: "",
        canonicalId: "",
        line: line,
        column: column,
        visible: true,
        unsupported: true,
        nameRange: nil,
        declarationRange: nil,
        signatureRange: nil,
        docTargets: doc.targets
      )
    )
  }

  private func accessLevel(of decl: DeclSyntax) -> String {
    let modifiers = decl.asProtocol(WithModifiersSyntax.self)?.modifiers ?? []
    for modifier in modifiers {
      // Ignore `private(set)` and similar setter-scoped modifiers; they do not
      // determine the declaration's own access level.
      if modifier.detail != nil { continue }
      let name = modifier.name.text
      if SUPPORTED_VISIBILITY_KEYWORDS.contains(name) {
        return name
      }
    }
    return "internal"
  }

  /// Extract `@doc` targets from the leading doc comments (`///` and `/** */`)
  /// of a node, with source positions for each target.
  private func docTargets(for node: some SyntaxProtocol) -> (targets: [DocTarget], startOffset: Int?) {
    var targets: [DocTarget] = []
    var startOffset: Int? = nil
    var offset = node.position.utf8Offset
    for piece in node.leadingTrivia {
      let length = piece.sourceLength.utf8Length
      let text: String?
      switch piece {
      case .docLineComment(let value), .docBlockComment(let value):
        text = value
      default:
        text = nil
      }
      if let text {
        if startOffset == nil {
          startOffset = offset
        }
        for match in docMatches(in: text) {
          let absoluteOffset = offset + match.byteOffset
          let (line, column) = converter.lineColumn(atOffset: absoluteOffset)
          targets.append(
            DocTarget(
              target: match.target,
              line: line,
              column: column,
              range: SourceRange(
                start: Position(line: line, column: column),
                end: Position(line: line, column: column + match.target.utf16.count)
              )
            )
          )
        }
      }
      offset += length
    }
    return (targets, startOffset)
  }
}

private struct DocMatch {
  let target: String
  /// UTF-8 byte offset of the target within the comment text.
  let byteOffset: Int
}

private let DOC_REGEX = try! NSRegularExpression(pattern: #"@doc\s+(\S+)"#)

private func docMatches(in text: String) -> [DocMatch] {
  let ns = text as NSString
  let matches = DOC_REGEX.matches(in: text, range: NSRange(location: 0, length: ns.length))
  return matches.compactMap { match in
    let group = match.range(at: 1)
    guard group.location != NSNotFound else { return nil }
    let target = ns.substring(with: group)
    guard
      let utf16Index = text.utf16.index(
        text.utf16.startIndex,
        offsetBy: group.location,
        limitedBy: text.utf16.endIndex
      ),
      let stringIndex = utf16Index.samePosition(in: text)
    else {
      return nil
    }
    let byteOffset = text.utf8.distance(from: text.utf8.startIndex, to: stringIndex)
    return DocMatch(target: target, byteOffset: byteOffset)
  }
}

private func argumentLabels(_ parameters: FunctionParameterListSyntax) -> String {
  parameters.map { parameter in
    let label = parameter.firstName.text
    return label == "_" ? "_:" : "\(label):"
  }.joined()
}

// MARK: - Type declaration abstraction

/// Uniform view over the type-like declarations SpecLink scopes against.
private struct TypeDeclaration {
  let name: String
  let nameToken: TokenSyntax
  let members: MemberBlockItemListSyntax
  let signatureEnd: AbsolutePosition
}

private extension DeclSyntax {
  var asTypeDeclaration: TypeDeclaration? {
    if let node = self.as(StructDeclSyntax.self) {
      return TypeDeclaration(
        name: node.name.text,
        nameToken: node.name,
        members: node.memberBlock.members,
        signatureEnd: typeSignatureEnd(name: node.name, inheritance: node.inheritanceClause)
      )
    }
    if let node = self.as(ClassDeclSyntax.self) {
      return TypeDeclaration(
        name: node.name.text,
        nameToken: node.name,
        members: node.memberBlock.members,
        signatureEnd: typeSignatureEnd(name: node.name, inheritance: node.inheritanceClause)
      )
    }
    if let node = self.as(EnumDeclSyntax.self) {
      return TypeDeclaration(
        name: node.name.text,
        nameToken: node.name,
        members: node.memberBlock.members,
        signatureEnd: typeSignatureEnd(name: node.name, inheritance: node.inheritanceClause)
      )
    }
    if let node = self.as(ProtocolDeclSyntax.self) {
      return TypeDeclaration(
        name: node.name.text,
        nameToken: node.name,
        members: node.memberBlock.members,
        signatureEnd: typeSignatureEnd(name: node.name, inheritance: node.inheritanceClause)
      )
    }
    if let node = self.as(ActorDeclSyntax.self) {
      return TypeDeclaration(
        name: node.name.text,
        nameToken: node.name,
        members: node.memberBlock.members,
        signatureEnd: typeSignatureEnd(name: node.name, inheritance: node.inheritanceClause)
      )
    }
    return nil
  }
}

private func typeSignatureEnd(
  name: TokenSyntax,
  inheritance: InheritanceClauseSyntax?
) -> AbsolutePosition {
  inheritance?.endPositionBeforeTrailingTrivia ?? name.endPositionBeforeTrailingTrivia
}

// MARK: - Symbol/diagnostic construction

private func makeSymbol(filePath: String, declaration: Declaration) -> CodeSymbol {
  CodeSymbol(
    kind: "code",
    language: "swift",
    filePath: filePath,
    symbolName: declaration.symbolName,
    canonicalId: declaration.canonicalId,
    endpoint: "\(filePath)#\(declaration.canonicalId)",
    location: SourceLocation(filePath: filePath, line: declaration.line, column: declaration.column),
    nameRange: declaration.nameRange,
    declarationRange: declaration.declarationRange,
    signatureRange: declaration.signatureRange
  )
}

private func diagnostic(
  code: String,
  target: String,
  message: String,
  filePath: String,
  line: Int,
  column: Int,
  range: SourceRange? = nil
) -> Diagnostic {
  Diagnostic(
    severity: "error",
    code: code,
    target: target,
    language: "swift",
    source: nil,
    message: message,
    location: SourceLocation(filePath: filePath, line: line, column: column),
    range: range
  )
}

// MARK: - Position conversion

/// Converts SwiftSyntax UTF-8 byte offsets into SpecLink's 1-based line numbers
/// and 1-based UTF-16 columns, matching the TypeScript scanner's convention.
private struct PositionConverter {
  private let utf8: [UInt8]
  /// UTF-8 byte offset at which each line begins.
  private let lineStarts: [Int]

  init(content: String) {
    let bytes = Array(content.utf8)
    self.utf8 = bytes
    var starts = [0]
    for (index, byte) in bytes.enumerated() where byte == 0x0A {
      starts.append(index + 1)
    }
    self.lineStarts = starts
  }

  func lineColumn(at position: AbsolutePosition) -> (line: Int, column: Int) {
    lineColumn(atOffset: position.utf8Offset)
  }

  func lineColumn(atOffset offset: Int) -> (line: Int, column: Int) {
    let clamped = max(0, min(offset, utf8.count))
    var low = 0
    var high = lineStarts.count - 1
    var lineIndex = 0
    while low <= high {
      let mid = (low + high) / 2
      if lineStarts[mid] <= clamped {
        lineIndex = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    let lineStart = lineStarts[lineIndex]
    let prefix = utf8[lineStart..<clamped]
    let column = String(decoding: prefix, as: UTF8.self).utf16.count + 1
    return (lineIndex + 1, column)
  }

  func range(from start: AbsolutePosition, to end: AbsolutePosition) -> SourceRange {
    range(fromOffset: start.utf8Offset, toOffset: end.utf8Offset)
  }

  func range(fromOffset start: Int, to end: AbsolutePosition) -> SourceRange {
    range(fromOffset: start, toOffset: end.utf8Offset)
  }

  func range(fromOffset start: Int, toOffset end: Int) -> SourceRange {
    let (startLine, startColumn) = lineColumn(atOffset: start)
    let (endLine, endColumn) = lineColumn(atOffset: end)
    return SourceRange(
      start: Position(line: startLine, column: startColumn),
      end: Position(line: endLine, column: endColumn)
    )
  }
}
