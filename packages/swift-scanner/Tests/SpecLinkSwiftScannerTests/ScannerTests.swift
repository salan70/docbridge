import XCTest
@testable import SpecLinkSwiftScanner

final class ScannerTests: XCTestCase {
  func testScansSupportedTopLevelDeclarations() throws {
    let source = """
    /// @doc docs/auth.md#auth-service
    public struct AuthService {}

    /// @doc docs/auth.md#auth-error
    public enum AuthError {}

    /// @doc docs/auth.md#login
    public func login(email: String) {}
    """

    let file = try scan(source)

    XCTAssertEqual(file.symbols.map(\.canonicalId), ["AuthService", "AuthError", "login(email:)"])
    XCTAssertEqual(file.links.map(\.target), [
      "docs/auth.md#auth-service",
      "docs/auth.md#auth-error",
      "docs/auth.md#login",
    ])
  }

  func testScansTypeMembersWithArgumentLabels() throws {
    let source = """
    public struct AuthService {
      /// @doc docs/auth.md#login
      public func login(email: String, password: String) {}

      /// @doc docs/auth.md#refresh
      public func refresh(_ token: String) {}

      /// @doc docs/auth.md#init
      public init(email: String, password: String) {}
    }
    """

    let file = try scan(source)

    XCTAssertEqual(file.symbols.map(\.canonicalId), [
      "AuthService.login(email:password:)",
      "AuthService.refresh(_:)",
      "AuthService.init(email:password:)",
    ])
  }

  func testCanonicalizesExtensionMembersAsMembersOfTheExtendedType() throws {
    let source = """
    extension AuthService {
      /// @doc docs/auth.md#logout
      public func logout() {}
    }
    """

    let file = try scan(source)

    XCTAssertEqual(file.symbols.map(\.canonicalId), ["AuthService.logout()"])
  }

  func testReportsDuplicateCanonicalEndpoints() throws {
    let source = """
    public struct AuthService {
      /// @doc docs/auth.md#login
      public func login(email: String) {}

      /// @doc docs/auth.md#login-again
      public func login(email: String) {}
    }
    """

    let file = try scan(source)

    XCTAssertEqual(file.symbols.map(\.canonicalId), ["AuthService.login(email:)"])
    XCTAssertEqual(file.diagnostics.map(\.code), ["duplicate_code_symbol"])
    XCTAssertEqual(file.diagnostics.first?.language, "swift")
  }

  func testReportsUnsupportedAnnotatedDeclarations() throws {
    let source = """
    /// @doc docs/auth.md#import
    import Foundation
    """

    let file = try scan(source)

    XCTAssertEqual(file.symbols, [])
    XCTAssertEqual(file.diagnostics.map(\.code), ["unsupported_declaration"])
    XCTAssertEqual(file.diagnostics.first?.language, "swift")
  }

  func testReportsSwiftParseErrors() throws {
    let file = try scan("public struct Broken {\n")

    XCTAssertEqual(file.symbols, [])
    XCTAssertEqual(file.diagnostics.map(\.code), ["code_parse_error"])
    XCTAssertEqual(file.diagnostics.first?.language, "swift")
  }

  func testUsesUtf16OneBasedEndExclusiveRanges() throws {
    let source = """
    /// @doc docs/auth.md#smile
    public func smile(_ value: String = "😀") {}
    """

    let file = try scan(source)
    let symbol = try XCTUnwrap(file.symbols.first)

    XCTAssertEqual(symbol.location.line, 2)
    XCTAssertEqual(symbol.location.column, 13)
    XCTAssertEqual(symbol.nameRange?.start.line, 2)
    XCTAssertEqual(symbol.nameRange?.start.column, 13)
    XCTAssertEqual(symbol.nameRange?.end.column, 18)
    XCTAssertEqual(symbol.declarationRange?.start.line, 1)
    XCTAssertEqual(symbol.declarationRange?.start.column, 1)
    XCTAssertEqual(symbol.declarationRange?.end.line, 2)
    XCTAssertGreaterThan(symbol.declarationRange?.end.column ?? 0, 40)
  }

  func testHonorsVisibilityOptions() throws {
    let source = """
    /// @doc docs/auth.md#internal
    internal struct InternalService {}

    public struct PublicService {}
    """

    let defaultFile = try scan(source)
    let internalFile = try scan(source, visibility: ["public", "open", "internal"])

    XCTAssertEqual(defaultFile.symbols, [])
    XCTAssertEqual(defaultFile.undocumentedSymbols.map(\.canonicalId), ["PublicService"])
    XCTAssertEqual(internalFile.symbols.map(\.canonicalId), ["InternalService"])
    XCTAssertEqual(internalFile.undocumentedSymbols.map(\.canonicalId), ["PublicService"])
  }

  private func scan(
    _ source: String,
    visibility: [String] = ["public", "open"]
  ) throws -> WorkerFileResponse {
    let request = WorkerRequest(
      schemaVersion: 1,
      requestId: "test",
      language: "swift",
      projectRoot: "/project",
      files: [
        WorkerFile(filePath: "Sources/AuthService.swift", content: source)
      ],
      options: WorkerOptions(visibility: visibility)
    )
    let data = try JSONEncoder().encode(request)
    let responseData = try Scanner().scan(requestData: data)
    let response = try JSONDecoder().decode(WorkerResponse.self, from: responseData)
    return try XCTUnwrap(response.files.first)
  }
}
