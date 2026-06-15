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
    let source = SourceText(filePath: file.filePath, content: file.content)
    let declarations = collectDeclarations(source: source, visibility: visibilitySet)

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

private struct TypeScope {
  let name: String
  let closesAtDepth: Int
}

private func collectDeclarations(source: SourceText, visibility: Set<String>) -> [Declaration] {
  var declarations: [Declaration] = []
  var pendingDoc: PendingDoc?
  var scopes: [TypeScope] = []
  var braceDepth = 0
  var inBlockDoc = false
  var blockDocLines: [String] = []
  var blockDocStart = 1

  for lineNumber in 1...source.lineCount {
    let line = source.line(lineNumber)
    let trimmed = line.trimmingCharacters(in: .whitespaces)

    while let last = scopes.last, braceDepth < last.closesAtDepth {
      scopes.removeLast()
    }

    if inBlockDoc {
      blockDocLines.append(line)
      if trimmed.contains("*/") {
        pendingDoc = parseDocTargets(
          lines: blockDocLines,
          startLine: blockDocStart,
          source: source
        )
        blockDocLines = []
        inBlockDoc = false
      }
      braceDepth += braceDelta(line)
      continue
    }

    if trimmed.hasPrefix("/**") {
      inBlockDoc = !trimmed.contains("*/")
      blockDocStart = lineNumber
      blockDocLines = [line]
      if !inBlockDoc {
        pendingDoc = parseDocTargets(lines: blockDocLines, startLine: blockDocStart, source: source)
        blockDocLines = []
      }
      braceDepth += braceDelta(line)
      continue
    }

    if trimmed.hasPrefix("///") {
      let current = pendingDoc ?? PendingDoc(targets: [], startLine: lineNumber)
      let targets = current.targets + parseDocLine(line, lineNumber: lineNumber, source: source)
      pendingDoc = PendingDoc(targets: targets, startLine: current.startLine)
      braceDepth += braceDelta(line)
      continue
    }

    if trimmed.isEmpty || trimmed.hasPrefix("//") {
      braceDepth += braceDelta(line)
      continue
    }

    if let info = parseSupportedDeclaration(line: line, typeName: scopes.last?.name) {
      let doc = pendingDoc
      pendingDoc = nil
      let visible = visibility.contains(info.visibility)
      let declarationRange = source.range(
        startLine: doc?.startLine ?? lineNumber,
        startColumn: 1,
        endLine: lineNumber,
        endColumn: source.utf16ColumnAfterLine(lineNumber)
      )
      declarations.append(
        Declaration(
          symbolName: info.symbolName,
          canonicalId: info.canonicalId,
          line: lineNumber,
          column: info.nameColumn,
          visible: visible,
          unsupported: false,
          nameRange: source.range(
            startLine: lineNumber,
            startColumn: info.nameColumn,
            endLine: lineNumber,
            endColumn: info.nameColumn + info.symbolName.utf16.count
          ),
          declarationRange: declarationRange,
          signatureRange: declarationRange,
          docTargets: doc?.targets ?? []
        )
      )
      if let typeName = info.opensTypeScope, line.contains("{") {
        scopes.append(TypeScope(name: typeName, closesAtDepth: braceDepth + 1))
      }
      braceDepth += braceDelta(line)
      continue
    }

    if let extended = parseExtension(line: line), line.contains("{") {
      pendingDoc = nil
      scopes.append(TypeScope(name: extended, closesAtDepth: braceDepth + 1))
      braceDepth += braceDelta(line)
      continue
    }

    if let doc = pendingDoc {
      declarations.append(
        Declaration(
          symbolName: "",
          canonicalId: "",
          line: lineNumber,
          column: firstNonWhitespaceColumn(line),
          visible: true,
          unsupported: true,
          nameRange: nil,
          declarationRange: nil,
          signatureRange: nil,
          docTargets: doc.targets
        )
      )
      pendingDoc = nil
    }

    braceDepth += braceDelta(line)
  }

  return declarations
}

private struct DeclarationInfo {
  let symbolName: String
  let canonicalId: String
  let visibility: String
  let nameColumn: Int
  let opensTypeScope: String?
}

private func parseSupportedDeclaration(line: String, typeName: String?) -> DeclarationInfo? {
  let pattern = #"^\s*(?:(open|public|internal|fileprivate|private)\s+)?(?:(?:final|static|class|mutating|nonmutating|override|required|convenience)\s+)*(class|struct|enum|protocol|actor|func|var|let|init)\b\s*([A-Za-z_][A-Za-z0-9_]*)?"#
  guard let match = line.firstMatch(pattern: pattern) else { return nil }
  let visibility = match.group(1) ?? "internal"
  let kind = match.group(2) ?? ""
  let rawName = match.group(3)

  if ["class", "struct", "enum", "protocol", "actor"].contains(kind), let name = rawName {
    return DeclarationInfo(
      symbolName: name,
      canonicalId: typeName.map { "\($0).\(name)" } ?? name,
      visibility: visibility,
      nameColumn: utf16Column(of: name, in: line),
      opensTypeScope: name
    )
  }

  if kind == "init" {
    let labels = argumentLabels(line: line)
    let canonical = "\(typeName.map { "\($0)." } ?? "")init(\(labels))"
    return DeclarationInfo(
      symbolName: "init",
      canonicalId: canonical,
      visibility: visibility,
      nameColumn: utf16Column(of: "init", in: line),
      opensTypeScope: nil
    )
  }

  guard let name = rawName else { return nil }
  let memberPrefix = typeName.map { "\($0)." } ?? ""
  let suffix = kind == "func" ? "(\(argumentLabels(line: line)))" : ""
  return DeclarationInfo(
    symbolName: name,
    canonicalId: "\(memberPrefix)\(name)\(suffix)",
    visibility: visibility,
    nameColumn: utf16Column(of: name, in: line),
    opensTypeScope: nil
  )
}

private func parseExtension(line: String) -> String? {
  let pattern = #"^\s*(?:(?:public|internal|fileprivate|private)\s+)?extension\s+([A-Za-z_][A-Za-z0-9_\.]*)"#
  return line.firstMatch(pattern: pattern)?.group(1)
}

private func argumentLabels(line: String) -> String {
  guard let open = line.firstIndex(of: "("), let close = line[open...].firstIndex(of: ")") else {
    return ""
  }
  let params = line[line.index(after: open)..<close]
  if params.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    return ""
  }
  return params.split(separator: ",").map { raw in
    let parameter = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let parts = parameter.split(whereSeparator: { $0 == " " || $0 == "\t" })
    if parts.first == "_" {
      return "_:"
    }
    let label = (parts.first ?? "").trimmingCharacters(in: CharacterSet(charactersIn: ":"))
    return "\(label):"
  }.joined()
}

private struct PendingDoc {
  let targets: [DocTarget]
  let startLine: Int
}

private func parseDocTargets(lines: [String], startLine: Int, source: SourceText) -> PendingDoc {
  var targets: [DocTarget] = []
  for (offset, line) in lines.enumerated() {
    targets.append(contentsOf: parseDocLine(line, lineNumber: startLine + offset, source: source))
  }
  return PendingDoc(targets: targets, startLine: startLine)
}

private func parseDocLine(_ line: String, lineNumber: Int, source: SourceText) -> [DocTarget] {
  guard let range = line.range(of: #"@doc\s+(\S+)"#, options: .regularExpression) else {
    return []
  }
  let matched = String(line[range])
  let target = matched.replacingOccurrences(
    of: #"^@doc\s+"#,
    with: "",
    options: .regularExpression
  )
  let start = line.distance(from: line.startIndex, to: range.lowerBound) + matched.utf16.count - target.utf16.count + 1
  return [
    DocTarget(
      target: target,
      line: lineNumber,
      column: start,
      range: source.range(
        startLine: lineNumber,
        startColumn: start,
        endLine: lineNumber,
        endColumn: start + target.utf16.count
      )
    )
  ]
}

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

private func braceDelta(_ line: String) -> Int {
  var delta = 0
  var inString = false
  for char in line {
    if char == "\"" { inString.toggle() }
    if inString { continue }
    if char == "{" { delta += 1 }
    if char == "}" { delta -= 1 }
  }
  return delta
}

private func firstNonWhitespaceColumn(_ line: String) -> Int {
  var column = 1
  for char in line {
    if char != " " && char != "\t" { return column }
    column += String(char).utf16.count
  }
  return 1
}

private func utf16Column(of needle: String, in line: String) -> Int {
  guard let range = line.range(of: needle) else { return firstNonWhitespaceColumn(line) }
  return line[..<range.lowerBound].utf16.count + 1
}

private struct RegexMatch {
  let match: NSTextCheckingResult
  let text: NSString

  func group(_ index: Int) -> String? {
    let range = match.range(at: index)
    guard range.location != NSNotFound else { return nil }
    return text.substring(with: range)
  }
}

private extension String {
  func firstMatch(pattern: String) -> RegexMatch? {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let text = self as NSString
    let range = NSRange(location: 0, length: text.length)
    guard let match = regex.firstMatch(in: self, range: range) else { return nil }
    return RegexMatch(match: match, text: text)
  }
}

private struct SourceText {
  let filePath: String
  let lines: [String]

  init(filePath: String, content: String) {
    self.filePath = filePath
    self.lines = content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
  }

  var lineCount: Int { lines.count }

  func line(_ number: Int) -> String {
    guard number > 0 && number <= lines.count else { return "" }
    return lines[number - 1]
  }

  func utf16ColumnAfterLine(_ number: Int) -> Int {
    line(number).utf16.count + 1
  }

  func range(startLine: Int, startColumn: Int, endLine: Int, endColumn: Int) -> SourceRange {
    SourceRange(
      start: Position(line: startLine, column: startColumn),
      end: Position(line: endLine, column: endColumn)
    )
  }
}
