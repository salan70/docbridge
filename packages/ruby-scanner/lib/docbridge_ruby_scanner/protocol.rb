# frozen_string_literal: true

require "docbridge_ruby_scanner/compat"
require "docbridge_ruby_scanner/declarations"
require "docbridge_ruby_scanner/links"
require "docbridge_ruby_scanner/positions"

module DocbridgeRubyScanner
  LANGUAGE = "ruby"
  DEFAULT_VISIBILITY = ["public"].freeze

  # Builds schemaVersion 1 responses. Hash keys are symbols in the order the
  # other workers emit them; optional fields are omitted, never nil.
  module Protocol
    module_function

    def scan_request(request)
      visibility = request.fetch("options", {})["visibility"]
      files = request.fetch("files").map do |file|
        scan_file(file.fetch("filePath"), file.fetch("content"), visibility)
      end
      { schemaVersion: 1, requestId: request.fetch("requestId"), language: LANGUAGE, files: files }
    end

    # A nil visibility means the default, public-only set; an empty list
    # includes nothing.
    def scan_file(file_path, content, visibility)
      content = content.dup.force_encoding(Encoding::UTF_8)
      converter = PositionConverter.new(content)
      parse_result = Prism.parse(content, filepath: file_path)
      return parse_error_response(file_path, parse_result.errors, converter) unless parse_result.errors.empty?

      declarations = DeclarationCollector.collect(parse_result, converter)
      ResponseBuilder.new(file_path, converter, visibility || DEFAULT_VISIBILITY).build(declarations)
    end

    def parse_error_response(file_path, errors, converter)
      first = errors.min_by.with_index { |error, index| [error.location.start_offset, index] }
      {
        filePath: file_path, symbols: [], undocumentedSymbols: [], links: [],
        diagnostics: [{
          severity: "error", code: "code_parse_error", target: file_path, language: LANGUAGE,
          message: "Ruby parse error: #{sentence(first.message)}",
          location: converter.location(file_path, first.location.start_offset),
        }],
      }
    end

    def sentence(message)
      message.end_with?(".") ? message : "#{message}."
    end
  end

  # Turns collected declarations into one file response, applying the
  # visibility filter and the duplicate rules.
  class ResponseBuilder
    def initialize(file_path, converter, visibility)
      @file_path = file_path
      @converter = converter
      @visible = visibility.to_a
      @response = { filePath: file_path, symbols: [], undocumentedSymbols: [], links: [], diagnostics: [] }
      @seen_endpoints = {}
      @duplicate_endpoints = {}
      @undocumented_endpoints = {}
    end

    def build(declarations)
      # An endpoint that any emitted declaration documents is never also
      # undocumented, whichever comes first in the file.
      documented = declarations.select { |declaration| emitted?(declaration) && !declaration.targets.empty? }
      @documented_ids = documented.to_h { |declaration| [declaration.canonical_id, true] }
      declarations.each { |declaration| add(declaration) }
      @response
    end

    private

    def emitted?(declaration)
      !declaration.unsupported && @visible.include?(declaration.visibility)
    end

    def add(declaration)
      unless emitted?(declaration)
        unsupported(declaration) unless declaration.targets.empty?
        return
      end

      symbol = make_symbol(declaration)
      endpoint = symbol[:endpoint]
      if declaration.targets.empty?
        return if @documented_ids[declaration.canonical_id] || @undocumented_endpoints[endpoint]

        @undocumented_endpoints[endpoint] = true
        @response[:undocumentedSymbols] << symbol
        return
      end

      if @seen_endpoints[endpoint]
        duplicate_symbol(declaration, symbol) unless @duplicate_endpoints[endpoint]
        @duplicate_endpoints[endpoint] = true
        return
      end
      @seen_endpoints[endpoint] = true
      @response[:symbols] << symbol
      add_links(declaration, endpoint)
    end

    def add_links(declaration, endpoint)
      seen_targets = {}
      declaration.targets.each do |target|
        location = @converter.location(@file_path, target.start_offset)
        target_range = @converter.range(target.start_offset, target.end_offset)
        if !Links.valid_target?(target.target, @file_path)
          @response[:diagnostics] << {
            severity: "error", code: "invalid_link_target", target: target.target, language: LANGUAGE,
            source: endpoint,
            message: "Link target must be a project-root-relative file path and fragment in file#fragment form.",
            location: location, range: target_range,
          }
        elsif seen_targets[target.target]
          @response[:diagnostics] << {
            severity: "warning", code: "duplicate_link", target: target.target, language: LANGUAGE,
            source: endpoint, message: "Duplicate @doc link from #{endpoint} to #{target.target}.",
            location: location, range: target_range,
          }
        else
          seen_targets[target.target] = true
          @response[:links] << { source: endpoint, target: target.target, location: location, targetRange: target_range }
        end
      end
    end

    def unsupported(declaration)
      @response[:diagnostics] << {
        severity: "warning", code: "unsupported_declaration", target: @file_path, language: LANGUAGE,
        message: "Ruby declaration annotated with @doc is not supported.",
        location: @converter.location(@file_path, declaration.name_start),
        range: @converter.range(declaration.name_start, declaration.name_end),
      }
    end

    def duplicate_symbol(declaration, symbol)
      @response[:diagnostics] << {
        severity: "error", code: "duplicate_code_symbol", target: symbol[:endpoint], language: LANGUAGE,
        message: "Duplicate Ruby code symbol endpoint: #{symbol[:endpoint]}",
        location: @converter.location(@file_path, declaration.name_start), range: symbol[:nameRange],
      }
    end

    def make_symbol(declaration)
      {
        kind: "code", language: LANGUAGE, filePath: @file_path, symbolName: declaration.symbol_name,
        canonicalId: declaration.canonical_id, endpoint: "#{@file_path}##{declaration.canonical_id}",
        location: @converter.location(@file_path, declaration.name_start),
        nameRange: @converter.range(declaration.name_start, declaration.name_end),
        declarationRange: @converter.range(declaration.decl_start, declaration.decl_end),
        signatureRange: @converter.range(declaration.sig_start, declaration.sig_end),
      }
    end
  end
end
