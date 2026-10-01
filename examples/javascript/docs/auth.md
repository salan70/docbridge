<!-- @code src/auth/service.js#AuthService -->

## Auth Service

The authentication service is implemented by `AuthService`.

<!-- @code src/auth/service.js#AuthService.constructor -->

## Constructing the Service

The constructor wires an authenticator into the service.

<!-- @code src/auth/service.js#AuthService.login -->

## Login Flow

The login flow is implemented by the `login` method.

<!-- @code src/auth/service.js#MAX_ATTEMPTS -->

## Max Attempts

`MAX_ATTEMPTS` bounds the login attempts per session.

<!-- @code src/ui/login-form.jsx#LoginForm -->

## Login Form

`LoginForm` collects the credentials that the login flow checks.
