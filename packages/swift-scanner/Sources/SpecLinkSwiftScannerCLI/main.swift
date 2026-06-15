import Foundation
import SpecLinkSwiftScanner

do {
  let input = FileHandle.standardInput.readDataToEndOfFile()
  let output = try Scanner().scan(requestData: input)
  FileHandle.standardOutput.write(output)
  FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
  FileHandle.standardError.write(Data("speclink-swift-scanner: \(error)\n".utf8))
  exit(1)
}
