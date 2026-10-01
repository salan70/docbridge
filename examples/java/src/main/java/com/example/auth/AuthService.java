package com.example.auth;

/**
 * The authentication service for the example.
 *
 * @doc docs/auth.md#auth-service
 */
public class AuthService {
  /**
   * The maximum number of login attempts per session.
   *
   * @doc docs/auth.md#max-attempts
   */
  public static final int MAX_ATTEMPTS = 3;

  private final Authenticator authenticator;

  /**
   * Wires an authenticator into the service.
   *
   * @doc docs/auth.md#constructing-the-service
   */
  public AuthService(Authenticator authenticator) {
    this.authenticator = authenticator;
  }

  /**
   * Starts the login flow.
   *
   * @doc docs/auth.md#login-flow
   */
  public void login(String email, char[] password) {
    if (!authenticator.authenticate(email, password)) {
      throw new IllegalArgumentException("invalid credentials");
    }
    audit("login");
  }

  /**
   * Starts the login flow and records each second factor.
   *
   * @doc docs/auth.md#multi-factor-login
   */
  public void login(String email, char[] password, String... factors) {
    login(email, password);
    for (String factor : factors) {
      audit("factor " + factor);
    }
  }

  private void audit(String event) {
    System.out.println(event);
  }
}
