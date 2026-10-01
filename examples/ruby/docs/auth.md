<!-- @code lib/auth/service.rb#Auth -->

## Auth

`Auth` is the namespace of the example.

<!-- @code lib/auth/service.rb#Auth::Service -->

## Auth Service

The authentication service is implemented by `Auth::Service`.

<!-- @code lib/auth/service.rb#Auth::Service.self.build -->

## Constructing the Service

`Auth::Service.build` wires an authenticator into the service.

<!-- @code lib/auth/service.rb#Auth::Service.login -->

## Login Flow

The login flow is implemented by the `login` method.

<!-- @code lib/auth/service.rb#Auth::MAX_ATTEMPTS -->

## Max Attempts

`Auth::MAX_ATTEMPTS` bounds the login attempts per session.
