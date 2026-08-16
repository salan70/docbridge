<!-- @code src/auth/login.ts#login -->

## Login Spec

Login flow specification.

<!-- @code src/auth/session.ts#SessionStore -->

## Session Store

Holds active sessions in memory. The class links to this overview; each of its
members links to the section describing that member.

<!-- @code src/auth/session.ts#SessionStore.find -->

## Session Lookup

Returns the stored session for a user, or nothing when there is none. A member
endpoint is type-qualified: `SessionStore.find`.

<!-- @code src/auth/session.ts#SessionStore.evict -->

## Session Eviction

Removes a user's session. Each specification section links to the member that
implements it rather than to the whole `SessionStore` class.
