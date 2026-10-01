/**
 * The maximum number of login attempts per session.
 *
 * @doc docs/auth.md#max-attempts
 */
export const MAX_ATTEMPTS = 3;

/**
 * The authentication service for the example.
 *
 * @doc docs/auth.md#auth-service
 */
export class AuthService {
  #authenticator;

  /**
   * @param {{ authenticate(email: string, password: string): boolean }} authenticator
   * @doc docs/auth.md#constructing-the-service
   */
  constructor(authenticator) {
    this.#authenticator = authenticator;
  }

  /**
   * Starts the login flow.
   *
   * @param {string} email
   * @param {string} password
   * @doc docs/auth.md#login-flow
   */
  login(email, password) {
    if (!this.#authenticator.authenticate(email, password)) {
      throw new Error("invalid credentials");
    }
  }
}
