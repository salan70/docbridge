<!-- @code src/auth/login.ts#login -->

## Login Spec

Login flow specification.

<!-- @code src/auth/session.ts#SessionStore -->

## Session Store

Holds active sessions in memory.

## Session Lookup

Returns the stored session for a user. Linked only by the `@doc` comment on `find`.

<!-- @code src/auth/session.ts#SessionStore.evict -->

## Session Eviction

Removes a user's session.

## Logout Spec

Logout flow specification. The link to `logout` lives in the legacy Manifest.
