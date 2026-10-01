# frozen_string_literal: true

module DocbridgeRubyScanner
  # One `@doc` annotation with the byte offsets of its target in the content.
  DocTarget = Struct.new(:target, :start_offset, :end_offset)

  # `@doc\s+(\S+)` matching and target validation shared with the other
  # workers.
  module Links
    DOC_PATTERN = /@doc[ \t\r\n\f\v]+([^ \t\r\n\f\v]+)/

    module_function

    # Finds every `@doc <target>` in a comment body that starts at
    # `body_offset` in the content. Offsets are bytes into the content.
    def doc_targets(body, body_offset)
      targets = []
      body.scan(DOC_PATTERN) do
        match = Regexp.last_match
        start_offset = body_offset + match.byteoffset(1)[0]
        target = match[1]
        targets << DocTarget.new(target, start_offset, start_offset + target.bytesize)
      end
      targets
    end

    # A project-root-relative `file#fragment` that is not the source file.
    def valid_target?(target, source_file_path)
      file_path, fragment, *rest = target.split("#", -1)
      return false unless rest.empty? && fragment && !file_path.empty? && !fragment.empty?
      return false if file_path.start_with?("/", "./", "../")
      return false if file_path.include?("\\") || file_path.match?(/[ \t\r\n]/) || fragment.match?(/[ \t\r\n]/)
      return false if file_path.split("/").include?("..")

      file_path != source_file_path
    end
  end
end
