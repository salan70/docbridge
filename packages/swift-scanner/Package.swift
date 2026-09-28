// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "DocBridgeSwiftScanner",
  platforms: [.macOS(.v13)],
  products: [
    .executable(name: "docbridge-swift-scanner", targets: ["DocBridgeSwiftScannerCLI"])
  ],
  dependencies: [
    .package(url: "https://github.com/swiftlang/swift-syntax.git", from: "602.0.0")
  ],
  targets: [
    .target(
      name: "DocBridgeSwiftScanner",
      dependencies: [
        .product(name: "SwiftParser", package: "swift-syntax"),
        .product(name: "SwiftParserDiagnostics", package: "swift-syntax"),
        .product(name: "SwiftSyntax", package: "swift-syntax")
      ]
    ),
    .executableTarget(
      name: "DocBridgeSwiftScannerCLI",
      dependencies: ["DocBridgeSwiftScanner"]
    ),
    .testTarget(
      name: "DocBridgeSwiftScannerTests",
      dependencies: ["DocBridgeSwiftScanner"]
    )
  ]
)
