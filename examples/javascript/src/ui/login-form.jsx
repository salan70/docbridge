/**
 * The login form that drives `AuthService.login`.
 *
 * @doc docs/auth.md#login-form
 */
export function LoginForm({ onSubmit }) {
  return (
    <form onSubmit={onSubmit}>
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button type="submit">Log in</button>
    </form>
  );
}
