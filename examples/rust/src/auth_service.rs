/// Authentication service for the DocBridge Rust example.
///
/// @doc docs/auth.md#auth-service
pub struct AuthService;

impl AuthService {
    /// Starts the login flow.
    ///
    /// @doc docs/auth.md#login-flow
    pub fn login(&self, email: &str, password: &str) {
        let _ = (email, password);
    }
}
