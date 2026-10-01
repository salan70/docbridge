<!-- @code src/auth/service.py#AuthService -->

## Auth Service

The authentication service is implemented by `AuthService`.

<!-- @code src/auth/service.py#AuthService.__init__ -->

## Constructing the Service

`AuthService.__init__` wires an `Authenticator` into the service.

<!-- @code src/auth/service.py#AuthService.login -->

## Login Flow

The login flow is implemented by the `login` method.

<!-- @code src/auth/service.py#AuthService.timeout -->

## Timeout

The `timeout` property's getter and setter share one endpoint.

<!-- @code src/auth/service.py#Authenticator -->

## Authenticator

`Authenticator` is the credential-checking contract.

<!-- @code src/auth/service.py#Authenticator.authenticate -->

## Authenticate

`authenticate` reports whether the credentials are valid.
