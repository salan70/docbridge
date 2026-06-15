// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "SpecLinkSwiftScanner",
  platforms: [.macOS(.v13)],
  products: [
    .executable(name: "speclink-swift-scanner", targets: ["SpecLinkSwiftScannerCLI"])
  ],
  dependencies: [
    .package(url: "https://github.com/swiftlang/swift-syntax.git", from: "602.0.0")
  ],
  targets: [
    .target(
      name: "SpecLinkSwiftScanner",
      dependencies: [
        .product(name: "SwiftParser", package: "swift-syntax"),
        .product(name: "SwiftSyntax", package: "swift-syntax")
      ]
    ),
    .executableTarget(
      name: "SpecLinkSwiftScannerCLI",
      dependencies: ["SpecLinkSwiftScanner"]
    ),
    .testTarget(
      name: "SpecLinkSwiftScannerTests",
      dependencies: ["SpecLinkSwiftScanner"]
    )
  ]
)
