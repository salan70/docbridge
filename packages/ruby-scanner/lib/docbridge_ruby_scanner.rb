# frozen_string_literal: true

# DocBridge Ruby scanner worker: Prism-based `@doc` extraction for
# schemaVersion 1 of the shared worker protocol. `Protocol` and the
# declaration collector do the work; `CLI` wraps them for the executable.
require "docbridge_ruby_scanner/protocol"
require "docbridge_ruby_scanner/cli"

module DocbridgeRubyScanner
  module_function

  # Scans one parsed worker request (string keys) and returns the response.
  def scan_request(request)
    Protocol.scan_request(request)
  end

  # Scans one file; a nil visibility means the default `["public"]`.
  def scan_file(file_path, content, visibility = nil)
    Protocol.scan_file(file_path, content, visibility)
  end
end
