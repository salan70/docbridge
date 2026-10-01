# frozen_string_literal: true

module DocbridgeRubyScanner
  # Converts Prism byte offsets into 1-based lines and UTF-16 columns over the
  # original content. Lines split on "\n" only, so a CRLF file keeps its "\r"
  # inside the line, and a leading byte order mark counts as one column on
  # line 1, as the other workers report it.
  class PositionConverter
    attr_reader :content

    def initialize(content)
      @content = content
      @line_starts = [0]
      cursor = 0
      while (newline = content.byteindex("\n", cursor))
        @line_starts << newline + 1
        cursor = newline + 1
      end
    end

    def position(offset)
      offset = offset.clamp(0, @content.bytesize)
      line_index = @line_starts.bsearch_index { |start| start > offset }
      line_index = line_index.nil? ? @line_starts.size - 1 : line_index - 1
      line_start = @line_starts[line_index]
      column = 1
      @content.byteslice(line_start, offset - line_start).each_codepoint do |codepoint|
        column += codepoint > 0xFFFF ? 2 : 1
      end
      { line: line_index + 1, column: column }
    end

    def location(file_path, offset)
      { filePath: file_path }.merge(position(offset))
    end

    def range(start_offset, end_offset)
      { start: position(start_offset), end: position(end_offset) }
    end

    # The content between two byte offsets, clamped to the content.
    def slice(start_offset, end_offset)
      start_offset = [start_offset, 0].max
      end_offset = [end_offset, @content.bytesize].min
      return "" if start_offset >= end_offset

      @content.byteslice(start_offset, end_offset - start_offset)
    end
  end
end
