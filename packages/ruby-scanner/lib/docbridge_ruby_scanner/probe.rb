# frozen_string_literal: true

# The `--probe` answer. This file must load on any Ruby that can start the
# entrypoint, so it requires nothing but the JSON that reports the result and
# checks the runtime floor before touching Prism.
module DocbridgeRubyScanner
  module Probe
    MINIMUM_VERSION = [3, 3].freeze

    module_function

    def result(ruby_version: RUBY_VERSION, engine: RUBY_ENGINE)
      return { ok: false, reason: "DocBridge requires CRuby, found #{engine}." } unless engine == "ruby"

      version = ruby_version.split(".").map(&:to_i)
      if (version <=> MINIMUM_VERSION).negative?
        return { ok: false, reason: "DocBridge requires CRuby 3.3 or later, found #{ruby_version}." }
      end

      begin
        require "prism"
      rescue LoadError => error
        return { ok: false, reason: "The bundled Prism gem cannot be loaded: #{error.message}" }
      end
      { ok: true, runtime: "cruby", version: ruby_version, prism: Prism::VERSION }
    end
  end
end
