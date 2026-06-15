import Foundation

public struct WorkerRequest: Codable {
  public let schemaVersion: Int
  public let requestId: String
  public let language: String
  public let projectRoot: String
  public let files: [WorkerFile]
  public let options: WorkerOptions

  public init(
    schemaVersion: Int,
    requestId: String,
    language: String,
    projectRoot: String,
    files: [WorkerFile],
    options: WorkerOptions
  ) {
    self.schemaVersion = schemaVersion
    self.requestId = requestId
    self.language = language
    self.projectRoot = projectRoot
    self.files = files
    self.options = options
  }
}

public struct WorkerFile: Codable {
  public let filePath: String
  public let content: String

  public init(filePath: String, content: String) {
    self.filePath = filePath
    self.content = content
  }
}

public struct WorkerOptions: Codable {
  public let visibility: [String]?

  public init(visibility: [String]? = nil) {
    self.visibility = visibility
  }
}

public struct WorkerResponse: Codable {
  public let schemaVersion: Int
  public let requestId: String
  public let language: String
  public let files: [WorkerFileResponse]
}

public struct WorkerFileResponse: Codable {
  public let filePath: String
  public let symbols: [CodeSymbol]
  public let undocumentedSymbols: [CodeSymbol]
  public let links: [DocLink]
  public let diagnostics: [Diagnostic]
}

public struct CodeSymbol: Codable, Equatable {
  public let kind: String
  public let language: String
  public let filePath: String
  public let symbolName: String
  public let canonicalId: String
  public let endpoint: String
  public let location: SourceLocation
  public let nameRange: SourceRange?
  public let declarationRange: SourceRange?
  public let signatureRange: SourceRange?
}

public struct DocLink: Codable, Equatable {
  public let direction: String
  public let source: String
  public let target: String
  public let location: SourceLocation
  public let targetRange: SourceRange?
}

public struct Diagnostic: Codable, Equatable {
  public let severity: String
  public let code: String
  public let target: String
  public let language: String?
  public let source: String?
  public let message: String
  public let location: SourceLocation?
  public let range: SourceRange?
}

public struct SourceLocation: Codable, Equatable {
  public let filePath: String
  public let line: Int
  public let column: Int
}

public struct SourceRange: Codable, Equatable {
  public let start: Position
  public let end: Position
}

public struct Position: Codable, Equatable {
  public let line: Int
  public let column: Int
}
