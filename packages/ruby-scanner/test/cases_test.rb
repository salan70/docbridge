# frozen_string_literal: true

require "test_helper"

# Every `test/cases/<name>.json` holds one `{"request": ..., "response": ...}`
# pair; the worker must answer the request with exactly that response.
class CasesTest < Minitest::Test
  CASES_DIR = File.join(__dir__, "cases")

  Dir[File.join(CASES_DIR, "*.json")].sort.each do |path|
    name = File.basename(path, ".json")
    define_method("test_case_#{name.tr('-', '_')}") do
      data = JSON.parse(File.read(path))
      response = JSON.parse(JSON.generate(DocbridgeRubyScanner.scan_request(data.fetch("request"))))
      assert_equal data.fetch("response"), response
    end
  end

  def test_cases_exist
    refute_empty Dir[File.join(CASES_DIR, "*.json")]
  end
end
