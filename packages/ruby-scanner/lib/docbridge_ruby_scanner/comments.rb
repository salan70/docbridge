# frozen_string_literal: true

require "docbridge_ruby_scanner/compat"
require "docbridge_ruby_scanner/links"

module DocbridgeRubyScanner
  # The contiguous run of full-line `#` comments that ends on the line directly
  # above a declaration. Trailing comments (code before the `#` on the same
  # line), `=begin`/`=end` blocks, and blank lines break the run.
  CommentBlock = Struct.new(:start_offset, :targets)

  class CommentIndex
    def initialize(parse_result, converter)
      @converter = converter
      @by_line = {}
      content = converter.content
      parse_result.comments.each do |comment|
        next unless Compat.inline_comment?(comment, content)

        location = comment.location
        next unless full_line?(location.start_offset)

        @by_line[converter.position(location.start_offset)[:line]] = location
      end
    end

    # The comment block attached to a declaration that starts at
    # `start_offset`, or nil when the line above it is not a comment.
    def block_above(start_offset)
      line = @converter.position(start_offset)[:line] - 1
      return nil unless @by_line.key?(line)

      line -= 1 while @by_line.key?(line - 1)
      lines = []
      while (location = @by_line[line])
        lines << location
        line += 1
      end
      targets = lines.flat_map do |location|
        body_start = location.start_offset + 1
        Links.doc_targets(@converter.slice(body_start, location.end_offset), body_start)
      end
      CommentBlock.new(lines.first.start_offset, targets)
    end

    private

    def full_line?(offset)
      content = @converter.content
      line_start = content.byterindex("\n", offset)
      line_start = line_start.nil? ? 0 : line_start + 1
      @converter.slice(line_start, offset).match?(/\A[ \t﻿]*\z/)
    end
  end
end
