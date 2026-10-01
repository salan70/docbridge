# frozen_string_literal: true

require "json"
require "docbridge_ruby_scanner/probe"

module DocbridgeRubyScanner
  # The executable's behaviour: `--probe` prints one JSON line and exits 0;
  # otherwise one request is read from stdin and one response is written to
  # stdout. Stderr carries only error text.
  module CLI
    module_function

    def run(argv, stdin, stdout, stderr)
      stdout.binmode
      if argv.include?("--probe")
        stdout.write("#{JSON.generate(Probe.result)}\n")
        return 0
      end

      require "docbridge_ruby_scanner/protocol"
      stdin.binmode
      request = JSON.parse(stdin.read.force_encoding(Encoding::UTF_8))
      stdout.write("#{JSON.generate(Protocol.scan_request(request))}\n")
      0
    rescue JSON::ParserError, KeyError, TypeError, NoMethodError => error
      stderr.write("docbridge-ruby-scanner: invalid request: #{error.message}\n")
      1
    end
  end
end
