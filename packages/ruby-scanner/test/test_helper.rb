# frozen_string_literal: true

require "minitest/autorun"
require "json"
require "docbridge_ruby_scanner"

# Shared helpers for the worker test suite. Every test scans through the
# public `DocbridgeRubyScanner.scan_file` entry point or the executable itself.
module ScanHelpers
  FILE_PATH = "lib/auth/service.rb"

  def scan(content, visibility: nil)
    DocbridgeRubyScanner.scan_file(FILE_PATH, content, visibility)
  end

  def symbol_ids(file)
    file[:symbols].map { |symbol| symbol[:canonicalId] }
  end

  def undocumented_ids(file)
    file[:undocumentedSymbols].map { |symbol| symbol[:canonicalId] }
  end

  def codes(file)
    file[:diagnostics].map { |diagnostic| diagnostic[:code] }
  end

  def link_targets(file)
    file[:links].map { |link| link[:target] }
  end

  def position(line, column)
    { line: line, column: column }
  end

  def range(start_line, start_column, end_line, end_column)
    { start: position(start_line, start_column), end: position(end_line, end_column) }
  end
end
