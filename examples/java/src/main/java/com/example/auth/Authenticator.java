package com.example.auth;

/**
 * Verifies credentials.
 *
 * @doc docs/auth.md#authenticator
 */
public interface Authenticator {
  /**
   * Reports whether the credentials are valid.
   *
   * @doc docs/auth.md#authenticate
   */
  boolean authenticate(String email, char[] password);
}
