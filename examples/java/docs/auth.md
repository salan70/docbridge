<!-- @code src/main/java/com/example/auth/AuthService.java#AuthService -->

## Auth Service

The authentication service is implemented by `AuthService`.

<!-- @code src/main/java/com/example/auth/AuthService.java#AuthService.MAX_ATTEMPTS -->

## Max Attempts

`AuthService.MAX_ATTEMPTS` bounds the login attempts per session.

<!-- @code src/main/java/com/example/auth/AuthService.java#AuthService.AuthService(Authenticator) -->

## Constructing the Service

The constructor wires an `Authenticator` into the service. A constructor's ID
repeats the type name, as in `AuthService.AuthService(Authenticator)`.

<!-- @code src/main/java/com/example/auth/AuthService.java#AuthService.login(String,char[]) -->

## Login Flow

The login flow is implemented by the `login` method. Each overload has its own
endpoint, named by its parameter types.

<!-- @code src/main/java/com/example/auth/AuthService.java#AuthService.login(String,char[],String[]) -->

## Multi-Factor Login

The varargs overload records each second factor. Its `String...` parameter is
named as the array `String[]`.

<!-- @code src/main/java/com/example/auth/Authenticator.java#Authenticator -->

## Authenticator

`Authenticator` is the credential-checking contract.

<!-- @code src/main/java/com/example/auth/Authenticator.java#Authenticator.authenticate(String,char[]) -->

## Authenticate

`authenticate` reports whether the credentials are valid. Interface members
without a modifier are public.
