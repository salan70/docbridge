# frozen_string_literal: true

# @doc docs/auth.md#auth
module Auth
  # The maximum number of login attempts per session.
  #
  # @doc docs/auth.md#max-attempts
  MAX_ATTEMPTS = 3

  # The authentication service for the example.
  #
  # @doc docs/auth.md#auth-service
  class Service
    # Builds a service around an authenticator.
    #
    # @doc docs/auth.md#constructing-the-service
    def self.build(authenticator)
      new(authenticator)
    end

    # Starts the login flow.
    #
    # @doc docs/auth.md#login-flow
    def login(email, password)
      raise ArgumentError, "invalid credentials" unless @authenticator.authenticate(email, password)

      audit(:login)
    end

    private

    def initialize(authenticator)
      @authenticator = authenticator
    end

    def audit(event)
      event
    end
  end
end
