# frozen_string_literal: true

require "test_helper"
require "open3"
require "rbconfig"

# Runs the Ruby scanner-conformance cases under
# `test-fixtures/scanner-conformance/<case>/ruby/` through the executable, as
# `src/scan/code/conformance.test.ts` does from Bun. Having them here too lets
# CI cover a second Ruby (and Prism) version without Bun. Each `expected.json`
# is the core's scan result, so its `language` field is not part of the
# worker's per-file response.
class ConformanceCasesTest < Minitest::Test
  CORPUS_ROOT = File.expand_path("../../../test-fixtures/scanner-conformance", __dir__)
  SCRIPT = File.expand_path("../bin/docbridge-ruby-scanner", __dir__)
  FLAGS = %w[--disable=gems,did_you_mean,error_highlight -W0].freeze
  CASES = %w[annotated-declaration duplicate-link non-ascii-range parse-error].freeze

  def test_every_conformance_case_has_a_ruby_input
    assert_equal CASES, Dir[File.join(CORPUS_ROOT, "*/ruby/")].map { |dir| File.basename(File.dirname(dir)) }.sort
  end

  CASES.each do |name|
    define_method("test_case_#{name.tr('-', '_')}") do
      case_dir = File.join(CORPUS_ROOT, name, "ruby")
      content = File.read(File.join(case_dir, "input.txt"), encoding: Encoding::UTF_8)
      expected = JSON.parse(File.read(File.join(case_dir, "expected.json"))).except("language")
      request = {
        "schemaVersion" => 1, "requestId" => "conformance-ruby", "language" => "ruby",
        "projectRoot" => "/tmp/project", "files" => [{ "filePath" => "input.rb", "content" => content }],
        "options" => {},
      }
      stdout, stderr, status = Open3.capture3(RbConfig.ruby, *FLAGS, SCRIPT, stdin_data: JSON.generate(request))
      assert_equal 0, status.exitstatus, stderr
      response = JSON.parse(stdout)
      assert_equal [expected], response["files"]
    end
  end
end
