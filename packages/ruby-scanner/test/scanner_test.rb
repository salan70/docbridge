# frozen_string_literal: true

require "test_helper"

class CanonicalIdTest < Minitest::Test
  include ScanHelpers

  SOURCE = <<~RUBY
    # @doc docs/auth.md#login
    def login; end

    # @doc docs/auth.md#foo
    class Foo
      # @doc docs/auth.md#bar
      module Bar
        # @doc docs/auth.md#value
        VALUE = 1

        # @doc docs/auth.md#baz
        def baz(a, b = 1); end

        # @doc docs/auth.md#self-baz
        def self.baz; end

        class << self
          # @doc docs/auth.md#qux
          def qux; end
        end

        # @doc docs/auth.md#path-const
        Baz::PATH = 2
      end

      # @doc docs/auth.md#setter
      def token=(value); end

      # @doc docs/auth.md#op
      def ==(other); end
    end

    # @doc docs/auth.md#top-const
    TOP = 3

    # @doc docs/auth.md#top-self
    def self.top; end
  RUBY

  def test_canonical_ids_follow_the_ruby_row
    file = scan(SOURCE)
    assert_equal [], codes(file)
    assert_equal(
      %w[login Foo Foo::Bar Foo::Bar::VALUE Foo::Bar.baz Foo::Bar.self.baz Foo::Bar.self.qux
         Foo::Bar::Baz::PATH Foo.token= Foo.== TOP self.top],
      symbol_ids(file),
    )
    assert_equal symbol_ids(file).map { |id| "#{FILE_PATH}##{id}" }, file[:symbols].map { |s| s[:endpoint] }
    assert_equal %w[login Foo Bar VALUE baz baz qux PATH token= == TOP top], file[:symbols].map { |s| s[:symbolName] }
    assert_equal symbol_ids(file).map { |id| "#{FILE_PATH}##{id}" }, file[:links].map { |l| l[:source] }
  end

  def test_symbols_carry_no_is_member
    file = scan(SOURCE)
    refute file[:symbols].any? { |symbol| symbol.key?(:isMember) }
  end
end

class LexicalQualificationTest < Minitest::Test
  include ScanHelpers

  def test_constant_paths_qualify_lexically_and_leading_colons_reset
    file = scan(<<~RUBY)
      module A
        # @doc docs/a.md#foo-bar
        class Foo::Bar
          # @doc docs/a.md#m
          def m; end
        end

        # @doc docs/a.md#top
        class ::Top
          # @doc docs/a.md#top-m
          def m; end
        end

        # @doc docs/a.md#deep
        module ::Deep::Path; end

        # @doc docs/a.md#c
        ::C = 1
      end
    RUBY
    assert_equal [], codes(file)
    assert_equal %w[A::Foo::Bar A::Foo::Bar.m Top Top.m Deep::Path C], symbol_ids(file)
    assert_equal %w[A], undocumented_ids(file)
  end

  def test_dynamic_constant_paths_are_unsupported_when_annotated
    file = scan(<<~RUBY)
      class Foo
        # @doc docs/a.md#x
        self::X = 1

        # @doc docs/a.md#y
        class self::Y; end

        # @doc docs/a.md#z
        module obj.klass::Z; end

        # not annotated, silently ignored
        self::W = 2
      end
    RUBY
    assert_equal %w[unsupported_declaration unsupported_declaration unsupported_declaration], codes(file)
    assert_equal [position(3, 9), position(6, 15), position(9, 21)],
                 file[:diagnostics].map { |d| position(d[:location][:line], d[:location][:column]) }
    assert_equal [], symbol_ids(file)
    assert_equal %w[Foo], undocumented_ids(file)
  end
end

class DeclarationScopeTest < Minitest::Test
  include ScanHelpers

  def test_declarations_inside_method_bodies_and_blocks_are_ignored
    file = scan(<<~RUBY)
      class Foo
        def build
          # @doc docs/a.md#inner
          def inner; end
        end

        included do
          # @doc docs/a.md#block
          def from_block; end
        end

        Nested = Class.new do
          # @doc docs/a.md#new
          def from_class_new; end
        end

        if ENV["X"]
          # @doc docs/a.md#cond
          def conditional; end
        end
      end
    RUBY
    assert_equal [], codes(file)
    assert_equal [], symbol_ids(file)
    assert_equal %w[Foo Foo.build Foo::Nested], undocumented_ids(file)
  end

  def test_class_bodies_with_rescue_are_still_visited
    file = scan(<<~RUBY)
      class Foo
        # @doc docs/a.md#m
        def m; end
      rescue LoadError
        nil
      end
    RUBY
    assert_equal %w[Foo.m], symbol_ids(file)
  end

  def test_other_constant_forms_are_not_declarations
    file = scan(<<~RUBY)
      X ||= 1
      A, B = 1, 2
      Y += 1
    RUBY
    assert_equal [], symbol_ids(file)
    assert_equal [], undocumented_ids(file)
    assert_equal [], codes(file)
  end
end

class AnnotationSourceTest < Minitest::Test
  include ScanHelpers

  def test_only_the_contiguous_comment_block_directly_above_attaches
    file = scan(<<~RUBY)
      # @doc docs/a.md#separated

      # @doc docs/a.md#first
      # plain text
      # @doc docs/a.md#second
      def login; end

      X = 1 # @doc docs/a.md#trailing
      def logout; end

      =begin
      @doc docs/a.md#embdoc
      =end
      def embdoc; end

      # @doc docs/a.md#above-end
      end_marker = 1
    RUBY
    assert_equal [], codes(file)
    assert_equal %w[docs/a.md#first docs/a.md#second], link_targets(file)
    assert_equal %w[login], symbol_ids(file)
    assert_equal %w[X logout embdoc], undocumented_ids(file)
  end

  def test_indented_comment_blocks_attach_to_members
    file = scan(<<~'RUBY')
      class Foo
        # frozen text
        #   @doc docs/a.md#login
        #@doc docs/a.md#tight
        def login; end
      end
    RUBY
    assert_equal %w[docs/a.md#login docs/a.md#tight], link_targets(file)
    assert_equal [position(3, 12), position(4, 9)], file[:links].map { |l| position(l[:location][:line], l[:location][:column]) }
  end

  def test_comments_inside_method_bodies_never_attach
    file = scan(<<~RUBY)
      def login
        # @doc docs/a.md#inside
        1
      end
      # @doc docs/a.md#logout
      def logout; end
    RUBY
    assert_equal %w[docs/a.md#logout], link_targets(file)
    assert_equal %w[logout], symbol_ids(file)
    assert_equal %w[login], undocumented_ids(file)
  end

  def test_annotation_above_a_visibility_prefixed_def_attaches
    file = scan(<<~RUBY)
      class Foo
        # @doc docs/a.md#login
        public def login; end
      end
    RUBY
    assert_equal %w[Foo.login], symbol_ids(file)
    assert_equal range(2, 3, 3, 24), file[:symbols][0][:declarationRange]
    assert_equal range(2, 3, 3, 19), file[:symbols][0][:signatureRange]
  end
end

class LinkTargetTest < Minitest::Test
  include ScanHelpers

  def test_invalid_targets_are_reported_with_their_range
    file = scan(<<~RUBY)
      # @doc docs/a.md
      # @doc #anchor
      # @doc /docs/a.md#x
      # @doc ../docs/a.md#x
      # @doc ./docs/a.md#x
      # @doc docs\\a.md#x
      # @doc docs/a.md#x#y
      # @doc lib/auth/service.rb#self
      # @doc docs/a.md#ok
      def login; end
    RUBY
    assert_equal Array.new(8, "invalid_link_target"), codes(file)
    assert_equal %w[docs/a.md#ok], link_targets(file)
    diagnostic = file[:diagnostics][0]
    assert_equal "docs/a.md", diagnostic[:target]
    assert_equal "#{FILE_PATH}#login", diagnostic[:source]
    assert_equal "error", diagnostic[:severity]
    assert_equal "ruby", diagnostic[:language]
    assert_equal({ filePath: FILE_PATH, line: 1, column: 8 }, diagnostic[:location])
    assert_equal range(1, 8, 1, 17), diagnostic[:range]
    assert_equal "Link target must be a project-root-relative file path and fragment in file#fragment form.", diagnostic[:message]
  end

  def test_duplicate_targets_from_one_declaration_are_duplicate_links
    file = scan(<<~RUBY)
      # @doc docs/a.md#login
      # @doc docs/a.md#login
      def login; end
    RUBY
    assert_equal %w[duplicate_link], codes(file)
    assert_equal 1, file[:links].size
    diagnostic = file[:diagnostics][0]
    assert_equal "warning", diagnostic[:severity]
    assert_equal "Duplicate @doc link from #{FILE_PATH}#login to docs/a.md#login.", diagnostic[:message]
    assert_equal range(2, 8, 2, 23), diagnostic[:range]
  end

  def test_doc_without_target_is_ignored
    file = scan(<<~RUBY)
      # @doc
      # @doc
      def login; end
    RUBY
    assert_equal [], codes(file)
    assert_equal [], link_targets(file)
    assert_equal %w[login], undocumented_ids(file)
  end
end

class ReopeningTest < Minitest::Test
  include ScanHelpers

  SOURCE = <<~RUBY
    # @doc docs/a.md#foo
    class Foo
      # @doc docs/a.md#m
      def m; end
      private
      def hidden; end
    end

    # @doc docs/a.md#foo-again
    # @doc docs/a.md#foo
    class Foo
      # @doc docs/a.md#m-again
      def m; end
      def visible; end
    end

    module Foo::Inner; end
    module Foo
      module Inner; end
    end
  RUBY

  def test_reopenings_form_one_container_whose_annotations_combine
    file = scan(SOURCE)
    assert_equal %w[duplicate_link duplicate_code_symbol], codes(file)
    assert_equal %w[Foo Foo.m], symbol_ids(file)
    assert_equal %w[docs/a.md#foo docs/a.md#foo-again docs/a.md#m], link_targets(file)
    assert_equal position(2, 7), position(file[:symbols][0][:location][:line], file[:symbols][0][:location][:column])
    assert_equal range(1, 1, 7, 4), file[:symbols][0][:declarationRange]
    assert_equal %w[Foo.visible Foo::Inner], undocumented_ids(file)
  end

  def test_duplicate_link_across_reopenings_points_at_the_repeated_annotation
    file = scan(SOURCE)
    duplicate = file[:diagnostics].find { |d| d[:code] == "duplicate_link" }
    assert_equal({ filePath: FILE_PATH, line: 10, column: 8 }, duplicate[:location])
    assert_equal "#{FILE_PATH}#Foo", duplicate[:source]
  end

  def test_duplicate_method_points_at_the_second_definition
    file = scan(SOURCE)
    duplicate = file[:diagnostics].find { |d| d[:code] == "duplicate_code_symbol" }
    assert_equal "#{FILE_PATH}#Foo.m", duplicate[:target]
    assert_equal "Duplicate Ruby code symbol endpoint: #{FILE_PATH}#Foo.m", duplicate[:message]
    assert_equal({ filePath: FILE_PATH, line: 13, column: 7 }, duplicate[:location])
    assert_equal range(13, 7, 13, 8), duplicate[:range]
  end

  def test_each_reopening_starts_public
    file = scan(<<~RUBY)
      class Foo
        private
        def hidden; end
      end
      class Foo
        def visible; end
      end
    RUBY
    assert_equal %w[Foo Foo.visible], undocumented_ids(file)
  end

  def test_undocumented_duplicates_are_reported_once
    file = scan(<<~RUBY)
      def m; end
      def m; end
    RUBY
    assert_equal %w[m], undocumented_ids(file)
    assert_equal [], codes(file)
  end
end

class DuplicateEndpointTest < Minitest::Test
  include ScanHelpers

  def test_repeated_annotated_definitions_report_one_duplicate_at_the_first_repeat
    file = scan(<<~RUBY)
      class Foo
        # @doc docs/a.md#one
        def m; end

        # @doc docs/a.md#two
        def m; end

        # @doc docs/a.md#three
        def m; end
      end
    RUBY
    assert_equal %w[duplicate_code_symbol], codes(file)
    assert_equal({ filePath: FILE_PATH, line: 6, column: 7 }, file[:diagnostics][0][:location])
    assert_equal %w[Foo.m], symbol_ids(file)
    assert_equal({ filePath: FILE_PATH, line: 3, column: 7 }, file[:symbols][0][:location])
    assert_equal %w[docs/a.md#one], link_targets(file)
  end
end

class VisibilityTest < Minitest::Test
  include ScanHelpers

  SOURCE = <<~RUBY
    # @doc docs/a.md#foo
    class Foo
      # @doc docs/a.md#a
      def a; end

      private

      # @doc docs/a.md#b
      def b; end

      # @doc docs/a.md#self-c
      def self.c; end

      class << self
        # @doc docs/a.md#self-d
        def d; end
        private
        # @doc docs/a.md#self-e
        def e; end
        # @doc docs/a.md#self-f
        private def f; end
      end

      protected

      # @doc docs/a.md#g
      def g; end

      public

      # @doc docs/a.md#h
      def h; end

      # @doc docs/a.md#i
      private def i; end

      # @doc docs/a.md#j
      protected def j; end

      # @doc docs/a.md#k
      def k; end
      private :k, :h

      # @doc docs/a.md#l
      def l; end
      protected "l"

      # @doc docs/a.md#self-m
      def self.m; end
      private_class_method :m

      # @doc docs/a.md#self-n
      private_class_method def self.n; end

      # @doc docs/a.md#self-o
      def self.o; end
      public_class_method :o

      # @doc docs/a.md#v
      VALUE = 1
    end

    # @doc docs/a.md#top
    def top; end

    # @doc docs/a.md#top-const
    TOP = 1
  RUBY

  CASES = {
    "default is public" => [
      nil,
      %w[Foo Foo.a Foo.self.c Foo.self.d Foo.self.o Foo::VALUE top TOP],
    ],
    "explicit public" => [
      %w[public],
      %w[Foo Foo.a Foo.self.c Foo.self.d Foo.self.o Foo::VALUE top TOP],
    ],
    "private only" => [
      %w[private],
      %w[Foo.b Foo.self.e Foo.self.f Foo.h Foo.i Foo.k Foo.self.m Foo.self.n],
    ],
    "protected only" => [
      %w[protected],
      %w[Foo.g Foo.j Foo.l],
    ],
    "all" => [
      %w[public protected private],
      %w[Foo Foo.a Foo.b Foo.self.c Foo.self.d Foo.self.e Foo.self.f Foo.g Foo.h Foo.i Foo.j Foo.k Foo.l
         Foo.self.m Foo.self.n Foo.self.o Foo::VALUE top TOP],
    ],
    "empty" => [[], []],
  }.freeze

  CASES.each do |name, (visibility, expected)|
    define_method("test_visibility_filter_#{name.tr(' ', '_')}") do
      file = scan(SOURCE, visibility: visibility)
      assert_equal expected, symbol_ids(file)
      assert_equal expected.size, file[:links].size
      filtered = 19 - expected.size
      assert_equal Array.new(filtered, "unsupported_declaration"), codes(file)
    end
  end

  def test_filtered_out_annotated_method_is_unsupported_at_its_name
    file = scan(<<~RUBY)
      class Foo
        private
        # @doc docs/a.md#b
        def b(x); end
        def c; end
      end
    RUBY
    assert_equal %w[unsupported_declaration], codes(file)
    diagnostic = file[:diagnostics][0]
    assert_equal({ filePath: FILE_PATH, line: 4, column: 7 }, diagnostic[:location])
    assert_equal range(4, 7, 4, 8), diagnostic[:range]
    assert_equal "Ruby declaration annotated with @doc is not supported.", diagnostic[:message]
    assert_equal "warning", diagnostic[:severity]
    assert_equal FILE_PATH, diagnostic[:target]
    assert_equal %w[Foo], undocumented_ids(file)
  end

  def test_private_symbol_call_applies_to_methods_of_earlier_reopenings
    file = scan(<<~RUBY)
      class Foo
        def a; end
      end
      class Foo
        private :a
        def b; end
      end
    RUBY
    assert_equal %w[Foo Foo.b], undocumented_ids(file)
  end

  def test_visibility_calls_with_a_receiver_or_inside_methods_are_ignored
    file = scan(<<~RUBY)
      class Foo
        self.private
        def a; end
        def setup
          private
        end
        def b; end
      end
    RUBY
    assert_equal %w[Foo Foo.a Foo.setup Foo.b], undocumented_ids(file)
  end
end

class UnsupportedDeclarationTest < Minitest::Test
  include ScanHelpers

  def test_unsupported_forms_report_at_their_name
    file = scan(<<~RUBY)
      class Foo
        # @doc docs/a.md#reader
        attr_reader :x, :y

        # @doc docs/a.md#writer
        attr_writer :x

        # @doc docs/a.md#accessor
        attr_accessor :z

        # @doc docs/a.md#alias
        alias new_name x

        # @doc docs/a.md#alias-method
        alias_method :other, :x

        # @doc docs/a.md#define
        define_method(:dyn) { 1 }

        # @doc docs/a.md#receiver
        def obj.foo; end

        # @doc docs/a.md#singleton-other
        class << obj
          # @doc docs/a.md#inside
          def bar; end
        end

        attr_reader :unannotated
      end
    RUBY
    assert_equal Array.new(9, "unsupported_declaration"), codes(file)
    assert_equal(
      [position(3, 3), position(6, 3), position(9, 3), position(12, 9), position(15, 3), position(18, 3),
       position(21, 11), position(24, 3), position(26, 9)],
      file[:diagnostics].map { |d| position(d[:location][:line], d[:location][:column]) },
    )
    assert_equal range(3, 3, 3, 14), file[:diagnostics][0][:range]
    assert_equal %w[Foo], undocumented_ids(file)
  end

  def test_declarations_inside_class_self_other_than_methods_are_unsupported
    file = scan(<<~RUBY)
      class Foo
        class << self
          # @doc docs/a.md#c
          CONST = 1
          # @doc docs/a.md#k
          class Klass; end
          # @doc docs/a.md#s
          def self.s; end
          PLAIN = 2
        end
      end
    RUBY
    assert_equal Array.new(3, "unsupported_declaration"), codes(file)
    assert_equal %w[Foo], undocumented_ids(file)
  end
end

class RangeTest < Minitest::Test
  include ScanHelpers

  def test_method_ranges
    file = scan(<<~RUBY)
      class Foo
        # docs
        # @doc docs/a.md#login
        def login(email, password = nil)
          1
        end

        def bare; end

        def unparenthesized a, b
        end

        def self.singleton_name; end

        def endless(x) = x

        def self.blocky(&block) = block
      end
    RUBY
    login = file[:symbols][0]
    _foo, bare, unparenthesized, singleton, endless, blocky = file[:undocumentedSymbols]
    assert_equal "Foo.login", login[:canonicalId]
    assert_equal({ filePath: FILE_PATH, line: 4, column: 7 }, login[:location])
    assert_equal range(4, 7, 4, 12), login[:nameRange]
    assert_equal range(2, 3, 6, 6), login[:declarationRange]
    assert_equal range(2, 3, 4, 35), login[:signatureRange]

    assert_equal range(8, 3, 8, 16), bare[:declarationRange]
    assert_equal range(8, 3, 8, 11), bare[:signatureRange]

    assert_equal range(10, 3, 11, 6), unparenthesized[:declarationRange]
    assert_equal range(10, 3, 10, 27), unparenthesized[:signatureRange]

    assert_equal "Foo.self.singleton_name", singleton[:canonicalId]
    assert_equal range(13, 12, 13, 26), singleton[:nameRange]
    assert_equal range(13, 3, 13, 26), singleton[:signatureRange]

    assert_equal range(15, 3, 15, 21), endless[:declarationRange]
    assert_equal range(15, 3, 15, 17), endless[:signatureRange]

    assert_equal range(17, 3, 17, 34), blocky[:declarationRange]
    assert_equal range(17, 3, 17, 26), blocky[:signatureRange]
  end

  def test_container_and_constant_ranges_equal_declaration_ranges
    file = scan(<<~RUBY)
      # @doc docs/a.md#foo
      class Foo < Base
        # @doc docs/a.md#v
        VALUE = [
          1,
        ]
        Foo::Bar::PATH = 2
      end

      module Mod; end
    RUBY
    foo, value = file[:symbols]
    path, mod = file[:undocumentedSymbols]
    assert_equal range(2, 7, 2, 10), foo[:nameRange]
    assert_equal range(1, 1, 8, 4), foo[:declarationRange]
    assert_equal foo[:declarationRange], foo[:signatureRange]
    assert_equal range(4, 3, 4, 8), value[:nameRange]
    assert_equal range(3, 3, 6, 4), value[:declarationRange]
    assert_equal value[:declarationRange], value[:signatureRange]
    assert_equal "Foo::Foo::Bar::PATH", path[:canonicalId]
    assert_equal range(7, 13, 7, 17), path[:nameRange]
    assert_equal range(7, 3, 7, 21), path[:declarationRange]
    assert_equal range(10, 8, 10, 11), mod[:nameRange]
    assert_equal range(10, 1, 10, 16), mod[:declarationRange]
  end

  def test_non_ascii_columns_count_utf16_units
    file = scan(<<~RUBY)
      # ログイン 😀
      # @doc docs/ログイン😀.md#login
      def ログイン(名前) = "😀"
      X😀 = 1
    RUBY
    assert_equal [], codes(file)
    symbol = file[:symbols][0]
    assert_equal "ログイン", symbol[:canonicalId]
    assert_equal range(3, 5, 3, 9), symbol[:nameRange]
    assert_equal range(1, 1, 3, 20), symbol[:declarationRange]
    assert_equal range(1, 1, 3, 13), symbol[:signatureRange]
    link = file[:links][0]
    assert_equal "docs/ログイン😀.md#login", link[:target]
    assert_equal range(2, 8, 2, 28), link[:targetRange]
    assert_equal range(4, 1, 4, 4), file[:undocumentedSymbols][0][:nameRange]
  end

  def test_crlf_line_endings_keep_positions
    file = scan("# @doc docs/a.md#login\r\ndef login(a)\r\n  a\r\nend\r\n")
    assert_equal [], codes(file)
    symbol = file[:symbols][0]
    assert_equal range(2, 5, 2, 10), symbol[:nameRange]
    assert_equal range(1, 1, 4, 4), symbol[:declarationRange]
    assert_equal range(1, 1, 2, 13), symbol[:signatureRange]
    assert_equal range(1, 8, 1, 23), file[:links][0][:targetRange]
  end

  def test_byte_order_mark_counts_as_one_column
    file = scan("﻿# @doc docs/a.md#login\ndef login; end\n")
    assert_equal [], codes(file)
    assert_equal({ filePath: FILE_PATH, line: 2, column: 5 }, file[:symbols][0][:location])
    assert_equal range(1, 2, 2, 15), file[:symbols][0][:declarationRange]
    assert_equal range(1, 9, 1, 24), file[:links][0][:targetRange]
  end
end

class ParseErrorTest < Minitest::Test
  include ScanHelpers

  def test_syntax_error_reports_the_earliest_error_and_no_symbols
    file = scan(<<~RUBY)
      # @doc docs/a.md#login
      def login; end
        😀 = { 1
    RUBY
    assert_equal [], file[:symbols]
    assert_equal [], file[:undocumentedSymbols]
    assert_equal [], file[:links]
    assert_equal 1, file[:diagnostics].size
    diagnostic = file[:diagnostics][0]
    assert_equal "code_parse_error", diagnostic[:code]
    assert_equal "error", diagnostic[:severity]
    assert_equal FILE_PATH, diagnostic[:target]
    assert_equal "ruby", diagnostic[:language]
    assert_equal "Ruby parse error: expected a `=>` between the hash key and value.", diagnostic[:message]
    assert_equal({ filePath: FILE_PATH, line: 3, column: 11 }, diagnostic[:location])
    refute diagnostic.key?(:range)
  end

  def test_error_at_end_of_input_points_at_the_end_of_the_last_line
    file = scan("class Foo\n  def x(\n")
    assert_equal %w[code_parse_error], codes(file)
    assert_equal({ filePath: FILE_PATH, line: 2, column: 9 }, file[:diagnostics][0][:location])
  end
end

class RequestTest < Minitest::Test
  include ScanHelpers

  def test_scan_request_keeps_request_order_and_echoes_identity
    request = {
      "schemaVersion" => 1,
      "requestId" => "req-1",
      "language" => "ruby",
      "projectRoot" => "/tmp/project",
      "files" => [
        { "filePath" => "b.rb", "content" => "" },
        { "filePath" => "a.rb", "content" => "# @doc docs/a.md#x\ndef x; end\n" },
      ],
      "options" => { "visibility" => ["public"] },
    }
    response = DocbridgeRubyScanner.scan_request(request)
    assert_equal 1, response[:schemaVersion]
    assert_equal "req-1", response[:requestId]
    assert_equal "ruby", response[:language]
    assert_equal %w[b.rb a.rb], response[:files].map { |file| file[:filePath] }
    assert_equal({ filePath: "b.rb", symbols: [], undocumentedSymbols: [], links: [], diagnostics: [] }, response[:files][0])
    assert_equal ["a.rb#x"], response[:files][1][:symbols].map { |symbol| symbol[:endpoint] }
    refute_includes JSON.generate(response), "null"
  end

  def test_missing_visibility_option_means_public
    request = {
      "schemaVersion" => 1, "requestId" => "r", "language" => "ruby", "projectRoot" => "/p",
      "files" => [{ "filePath" => "a.rb", "content" => "class A\nprivate\ndef x; end\nend\n" }],
      "options" => {},
    }
    file = DocbridgeRubyScanner.scan_request(request)[:files][0]
    assert_equal %w[A], undocumented_ids(file)
  end
end
