<!-- @code internal/auth/service.go#AuthService -->

## Auth Service

The authentication service is implemented by `AuthService`.

<!-- @code internal/auth/service.go#NewAuthService -->

## Constructing the Service

`NewAuthService` wires an `Authenticator` into the service.

<!-- @code internal/auth/service.go#AuthService.Login -->

## Login Flow

The login flow is implemented by the `Login` method.

<!-- @code internal/auth/service.go#Authenticator -->

## Authenticator

`Authenticator` is the credential-checking contract.

<!-- @code internal/auth/service.go#Authenticator.Authenticate -->

## Authenticate

`Authenticate` reports whether the credentials are valid.

<!-- @code internal/auth/service.go#MaxAttempts -->

## Max Attempts

`MaxAttempts` bounds the login attempts per session.
