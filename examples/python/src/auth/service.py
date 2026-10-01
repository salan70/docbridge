"""Authentication service for the DocBridge Python example."""

from typing import Protocol

MAX_ATTEMPTS = 3


class Authenticator(Protocol):
    """Verifies credentials.

    @doc docs/auth.md#authenticator
    """

    def authenticate(self, email: str, password: str) -> bool:
        """Report whether the credentials are valid.

        @doc docs/auth.md#authenticate
        """
        ...


class AuthService:
    """The authentication service for the example.

    @doc docs/auth.md#auth-service
    """

    def __init__(self, authenticator: Authenticator) -> None:
        """Wire an authenticator into the service.

        @doc docs/auth.md#constructing-the-service
        """
        self._authenticator = authenticator
        self._timeout = 30

    # Starts the login flow.
    #
    # @doc docs/auth.md#login-flow
    def login(self, email: str, password: str) -> None:
        if not self._authenticator.authenticate(email, password):
            raise ValueError("invalid credentials")
        self._audit("login")

    @property
    def timeout(self) -> int:
        """The session timeout in seconds.

        @doc docs/auth.md#timeout
        """
        return self._timeout

    @timeout.setter
    def timeout(self, value: int) -> None:
        self._timeout = value

    def _audit(self, event: str) -> None:
        print(event)
