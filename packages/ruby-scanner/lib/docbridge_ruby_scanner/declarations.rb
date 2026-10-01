# frozen_string_literal: true

require "docbridge_ruby_scanner/compat"
require "docbridge_ruby_scanner/comments"

module DocbridgeRubyScanner
  # One declaration found in a file, in source order. An unsupported
  # declaration is recorded only when its comment block carries `@doc`, so it
  # can be reported; supported declarations are recorded whether or not they
  # are documented, so audit mode can list them.
  Declaration = Struct.new(
    :kind, :symbol_name, :canonical_id, :visibility, :unsupported,
    :name_start, :name_end, :decl_start, :decl_end, :sig_start, :sig_end, :targets,
    keyword_init: true,
  ) do
    def container?
      kind == :container
    end
  end

  # The lexical state of one class, module, or `class << self` body.
  Scope = Struct.new(:container, :singleton, :dynamic, :default_visibility, keyword_init: true) do
    # The canonical ID a method named `name` gets in this scope.
    def method_id(name, singleton_method)
      prefix = container ? "#{container}." : ""
      singleton_method ? "#{prefix}self.#{name}" : "#{prefix}#{name}"
    end

    def constant_id(name)
      container ? "#{container}::#{name}" : name.to_s
    end
  end

  # Walks the Prism tree and collects declarations from the top level and
  # class or module bodies; method bodies, blocks, and control flow are never
  # entered.
  class DeclarationCollector
    VISIBILITY_CALLS = { private: "private", protected: "protected", public: "public" }.freeze
    CLASS_METHOD_CALLS = { private_class_method: "private", public_class_method: "public" }.freeze
    UNSUPPORTED_CALLS = %i[attr_reader attr_writer attr_accessor alias_method define_method].freeze

    def self.collect(parse_result, converter)
      collector = new(parse_result, converter)
      collector.visit_body(parse_result.value.statements, Scope.new(default_visibility: "public"))
      collector.merge_containers
    end

    def initialize(parse_result, converter)
      @comments = CommentIndex.new(parse_result, converter)
      @declarations = []
    end

    def visit_body(body, scope)
      statements = case body
                   when Prism::StatementsNode then body.body
                   when Prism::BeginNode then body.statements&.body || []
                   else []
                   end
      statements.each { |node| visit_statement(node, scope) }
    end

    # Reopenings of one container become one declaration whose annotations
    # combine, located at the first declaration.
    def merge_containers
      first_by_id = {}
      @declarations.select do |declaration|
        next true unless declaration.container?

        first = first_by_id[declaration.canonical_id]
        if first
          first.targets.concat(declaration.targets)
          false
        else
          first_by_id[declaration.canonical_id] = declaration
          true
        end
      end
    end

    private

    def visit_statement(node, scope)
      case node
      when Prism::ClassNode, Prism::ModuleNode then visit_container(node, scope)
      when Prism::SingletonClassNode then visit_singleton_class(node, scope)
      when Prism::DefNode then visit_def(node, scope, nil)
      when Prism::ConstantWriteNode then visit_constant(node, node.name, node.name_loc, scope)
      when Prism::ConstantPathWriteNode then visit_constant_path(node, scope)
      when Prism::CallNode then visit_call(node, scope)
      when Prism::AliasMethodNode then unsupported_if_annotated(node, node.new_name.location)
      end
    end

    def visit_container(node, scope)
      path = node.constant_path
      name_loc = path.is_a?(Prism::ConstantPathNode) ? Compat.constant_path_name_loc(path) : path.location
      id = scope.dynamic || scope.singleton ? nil : qualify(path, scope)
      return unsupported_if_annotated(node, name_loc) if id.nil?

      add(node, kind: :container, symbol_name: last_segment(id), canonical_id: id, visibility: "public",
                name_loc: name_loc, sig_end: node.location.end_offset)
      visit_body(node.body, Scope.new(container: id, default_visibility: "public"))
    end

    # `class << self` hosts singleton methods; any other receiver is dynamic.
    def visit_singleton_class(node, scope)
      unsupported_if_annotated(node, node.class_keyword_loc)
      dynamic = scope.dynamic || scope.singleton || !node.expression.is_a?(Prism::SelfNode)
      visit_body(node.body, Scope.new(container: scope.container, singleton: true, dynamic: dynamic,
                                      default_visibility: "public"))
    end

    def visit_def(node, scope, explicit_visibility)
      receiver = node.receiver
      dynamic = scope.dynamic || (scope.singleton && receiver) || (receiver && !receiver.is_a?(Prism::SelfNode))
      return unsupported_if_annotated(node, node.name_loc) if dynamic

      singleton = scope.singleton || !receiver.nil?
      visibility = explicit_visibility || (receiver ? "public" : scope.default_visibility)
      add(node, kind: :method, symbol_name: node.name.to_s, canonical_id: scope.method_id(node.name, singleton),
                visibility: visibility, name_loc: node.name_loc, sig_end: signature_end(node))
    end

    def signature_end(node)
      return node.rparen_loc.end_offset if node.rparen_loc
      return node.parameters.location.end_offset if node.parameters

      node.name_loc.end_offset
    end

    def visit_constant(node, name, name_loc, scope)
      return unsupported_if_annotated(node, name_loc) if scope.dynamic || scope.singleton

      id = scope.constant_id(name)
      add(node, kind: :constant, symbol_name: name.to_s, canonical_id: id, visibility: "public",
                name_loc: name_loc, sig_end: node.location.end_offset)
    end

    def visit_constant_path(node, scope)
      name_loc = Compat.constant_path_name_loc(node.target)
      id = scope.dynamic || scope.singleton ? nil : qualify(node.target, scope)
      return unsupported_if_annotated(node, name_loc) if id.nil?

      add(node, kind: :constant, symbol_name: last_segment(id), canonical_id: id, visibility: "public",
                name_loc: name_loc, sig_end: node.location.end_offset)
    end

    def visit_call(node, scope)
      return unless node.receiver.nil?

      name = node.name.to_sym
      if VISIBILITY_CALLS.key?(name)
        visibility_call(node, scope, VISIBILITY_CALLS[name], scope.singleton)
      elsif CLASS_METHOD_CALLS.key?(name)
        visibility_call(node, scope, CLASS_METHOD_CALLS[name], true)
      elsif UNSUPPORTED_CALLS.include?(name)
        unsupported_if_annotated(node, node.message_loc || node.location)
      end
    end

    # A bare call switches the body's default; arguments name the methods it
    # applies to, either inline `def`s or already defined methods.
    def visit_call_arguments(node)
      node.arguments ? node.arguments.arguments : []
    end

    def visit_call_target(argument)
      case argument
      when Prism::SymbolNode, Prism::StringNode then argument.unescaped
      end
    end

    def visibility_call(node, scope, visibility, singleton)
      arguments = visit_call_arguments(node)
      if arguments.empty?
        scope.default_visibility = visibility unless singleton && !scope.singleton
        return
      end
      arguments.each do |argument|
        if argument.is_a?(Prism::DefNode)
          visit_def(argument, scope, visibility)
        elsif (name = visit_call_target(argument))
          id = scope.method_id(name, singleton)
          @declarations.each { |d| d.visibility = visibility if d.kind == :method && d.canonical_id == id }
        end
      end
    end

    # Lexical qualification: a leading `::` resets to the top level; a parent
    # that is not a constant makes the path dynamic (nil).
    def qualify(path, scope)
      case path
      when Prism::ConstantReadNode
        scope.constant_id(path.name)
      when Prism::ConstantPathNode
        name = Compat.constant_path_name(path)
        return nil if name.nil?

        parent = path.parent
        return name.to_s if parent.nil?

        prefix = qualify(parent, scope)
        prefix && "#{prefix}::#{name}"
      end
    end

    def last_segment(id)
      id.split("::").last
    end

    def unsupported_if_annotated(node, name_loc)
      block = @comments.block_above(node.location.start_offset)
      return if block.nil? || block.targets.empty?

      @declarations << Declaration.new(kind: :unsupported, unsupported: true, name_start: name_loc.start_offset,
                                       name_end: name_loc.end_offset, targets: block.targets)
    end

    def add(node, kind:, symbol_name:, canonical_id:, visibility:, name_loc:, sig_end:)
      block = @comments.block_above(node.location.start_offset)
      decl_start = block ? block.start_offset : node.location.start_offset
      @declarations << Declaration.new(
        kind: kind, symbol_name: symbol_name, canonical_id: canonical_id, visibility: visibility,
        unsupported: false, name_start: name_loc.start_offset, name_end: name_loc.end_offset,
        decl_start: decl_start, decl_end: node.location.end_offset, sig_start: decl_start, sig_end: sig_end,
        targets: block ? block.targets : [],
      )
    end
  end
end
