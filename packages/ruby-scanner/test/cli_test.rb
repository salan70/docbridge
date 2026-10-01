# frozen_string_literal: true

require "test_helper"
require "open3"
require "rbconfig"

# Runs the executable exactly as the core starts it: the current Ruby with
# RubyGems disabled and warnings off, the script path as the only argument,
# and the injected-option variables removed from the environment.
class CliTest < Minitest::Test
  SCRIPT = File.expand_path("../bin/docbridge-ruby-scanner", __dir__)
  RUBY = RbConfig.ruby
  FLAGS = %w[--disable=gems,did_you_mean,error_highlight -W0].freeze
  ENV_OVERRIDES = { "RUBYOPT" => nil, "RUBYLIB" => nil, "PRISM_FFI_BACKEND" => nil }.freeze

  def run_worker(*args, stdin_data: "")
    Open3.capture3(ENV_OVERRIDES, RUBY, *FLAGS, SCRIPT, *args, stdin_data: stdin_data)
  end

  def test_probe_reports_the_runtime_and_prism_versions
    stdout, stderr, status = run_worker("--probe")
    assert_equal 0, status.exitstatus, stderr
    assert_equal "", stderr
    lines = stdout.lines
    assert_equal 1, lines.size
    probe = JSON.parse(lines[0])
    assert_equal({ "ok" => true, "runtime" => "cruby", "version" => RUBY_VERSION, "prism" => Prism::VERSION }, probe)
  end

  def test_scans_one_request_from_stdin_to_stdout
    request = {
      "schemaVersion" => 1, "requestId" => "cli-1", "language" => "ruby", "projectRoot" => "/tmp/project",
      "files" => [{ "filePath" => "lib/a.rb", "content" => "# @doc docs/a.md#ログイン\ndef login; end\n" }],
      "options" => {},
    }
    stdout, stderr, status = run_worker(stdin_data: JSON.generate(request))
    assert_equal 0, status.exitstatus, stderr
    assert_equal "", stderr
    assert stdout.end_with?("\n")
    response = JSON.parse(stdout)
    assert_equal "cli-1", response["requestId"]
    assert_equal "ruby", response["language"]
    assert_equal 1, response["schemaVersion"]
    assert_equal ["docs/a.md#ログイン"], response["files"][0]["links"].map { |link| link["target"] }
  end

  def test_invalid_request_exits_non_zero_with_stderr_text
    stdout, stderr, status = run_worker(stdin_data: "not json")
    assert_equal 1, status.exitstatus
    assert_equal "", stdout
    assert_match(/invalid request/, stderr)
  end

  def test_request_without_files_exits_non_zero
    stdout, stderr, status = run_worker(stdin_data: "{}")
    assert_equal 1, status.exitstatus
    assert_equal "", stdout
    assert_match(/invalid request/, stderr)
  end
end

class ProbeTest < Minitest::Test
  def test_rejects_runtimes_below_the_floor
    result = DocbridgeRubyScanner::Probe.result(ruby_version: "3.2.9")
    assert_equal false, result[:ok]
    assert_match(/3\.3 or later, found 3\.2\.9/, result[:reason])
  end

  def test_rejects_other_engines
    result = DocbridgeRubyScanner::Probe.result(engine: "jruby")
    assert_equal false, result[:ok]
    assert_match(/CRuby/, result[:reason])
  end

  def test_accepts_the_floor
    result = DocbridgeRubyScanner::Probe.result(ruby_version: "3.3.0")
    assert_equal true, result[:ok]
    assert_equal "3.3.0", result[:version]
  end
end
