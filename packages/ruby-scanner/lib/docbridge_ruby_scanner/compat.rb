# frozen_string_literal: true

require "prism"

module DocbridgeRubyScanner
  # Every Prism accessor whose shape differs between the Prism bundled with
  # CRuby 3.3 (0.19) and the 1.x series bundled with 3.4 and later lives here,
  # so the rest of the worker reads one stable API.
  #
  # Prism 0.19 exposes the last segment of a constant path as
  # `ConstantPathNode#child` (a ConstantReadNode); 0.28 replaced it with
  # `#name` and `#name_loc` and 1.x deprecates `#child`.
  module Compat
    module_function

    # The name of the last segment of a constant path, or nil when the parser
    # recovered from a missing segment.
    def constant_path_name(node)
      if node.respond_to?(:name_loc)
        node.name
      else
        child = node.child
        child.respond_to?(:name) ? child.name : nil
      end
    end

    # The location of the last segment of a constant path.
    def constant_path_name_loc(node)
      node.respond_to?(:name_loc) ? node.name_loc : node.child.location
    end

    # True for a `#` comment; `=begin`/`=end` blocks and `__END__` data are
    # not. The class exists in both versions, but checking the source byte is
    # independent of the comment class hierarchy.
    def inline_comment?(comment, content)
      content.byteslice(comment.location.start_offset, 1) == "#"
    end
  end
end
