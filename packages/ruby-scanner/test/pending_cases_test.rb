# frozen_string_literal: true

require "test_helper"
require "open3"
require "rbconfig"

# Runs the scanner-conformance cases under
# `test-fixtures/pending-languages/ruby/` through the executable, as
# `scripts/pending-worker-cases.test.ts` does from Bun. Having them here too
# lets CI cover a second Ruby (and Prism) version without Bun.
class PendingCasesTest < Minitest::Test
  FIXTURE_ROOT = File.expand_path("../../../test-fixtures/pending-languages/ruby", __dir__)
  SCRIPT = File.expand_path("../bin/docbridge-ruby-scanner", __dir__)
  FLAGS = %w[--disable=gems,did_you_mean,error_highlight -W0].freeze

  def test_the_four_conformance_cases_exist
    assert_equal %w[annotated-declaration duplicate-link non-ascii-range parse-error],
                 Dir.children(FIXTURE_ROOT).select { |name| File.directory?(File.join(FIXTURE_ROOT, name)) }.sort
  end

  Dir[File.join(FIXTURE_ROOT, "*/")].sort.each do |case_dir|
    name = File.basename(case_dir)
    define_method("test_case_#{name.tr('-', '_')}") do
      content = File.read(File.join(case_dir, "input.txt"), encoding: Encoding::UTF_8)
      expected = JSON.parse(File.read(File.join(case_dir, "expected.json")))
      request = {
        "schemaVersion" => 1, "requestId" => "pending-ruby", "language" => "ruby",
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
