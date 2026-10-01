# frozen_string_literal: true

# Runs every worker test. Invoke from the package directory:
#   ruby -Ilib -Itest test/run.rb
$LOAD_PATH.unshift(File.expand_path("../lib", __dir__))
$LOAD_PATH.unshift(__dir__)

Dir[File.join(__dir__, "*_test.rb")].sort.each { |file| require file }
