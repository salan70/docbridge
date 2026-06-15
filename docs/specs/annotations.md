# Annotations

SpecLink v0.1 uses explicit annotations on both sides of a link.

TypeScript uses JSDoc `@doc` tags attached to supported declarations:

```ts
/**
 * @doc docs/specs/cli.md#check-command
 */
export function runCheck() {}
```

Swift uses documentation comments with `@doc` attached to supported
declarations:

```swift
/// @doc docs/specs/auth.md#login-flow
public func login(email: String, password: String) {}
```

Dart uses documentation comments with `@doc` attached to supported
declarations:

```dart
/// @doc docs/specs/auth.md#login-flow
void login(String email, String password) {}
```

Markdown uses standalone HTML comments with `@code` attached to the next heading:

```md
<!-- @code src/cli/index.ts#runCheck -->
## Check Command
```

Both `@doc` and `@code` allow optional text after the target. SpecLink treats the first whitespace-delimited token as the target and ignores the rest.

```ts
/**
 * @doc docs/specs/cli.md#check-command Human-readable note
 */
export function runCheck() {}
```

Supported TypeScript declarations are top-level exported:

- `function`
- `class`
- `abstract class`
- `interface`
- `type`
- `const` with a single declarator
- `enum`
- `const enum`
- named default `function`
- named default `class`
- `declare` forms of supported declarations inside `.ts` files

Unsupported declarations with `@doc` produce `unsupported_declaration`. Unsupported declarations without `@doc` are ignored.

Unsupported examples include:

- anonymous default exports
- `export const a = 1, b = 2`
- namespace and module declarations
- re-exports, including type-only re-exports
- non-exported declarations with `@doc`

SpecLink relies on the TypeScript Compiler API to associate JSDoc with declarations. Orphan `@doc` comments that are not associated with a declaration are not detected in v0.1.

Supported Swift declarations are listed in [Scanning](./scanning.md#swift-scanning).
Swift member endpoints are type-qualified and include argument labels, so
Markdown backlinks must use the scanner-produced canonical ID exactly:

```md
<!-- @code Sources/AuthService.swift#AuthService.login(email:password:) -->
## Login Flow
```

Supported Dart declarations are listed in [Scanning](./scanning.md#dart-scanning).
Dart member endpoints are type-qualified (without parameter signatures, since
Dart has no overloading), so Markdown backlinks must use the scanner-produced
canonical ID exactly:

```md
<!-- @code lib/auth_service.dart#AuthService.login -->
## Login Flow
```

Markdown `@code` comments may be indented by 0 to 3 spaces. Comments indented by 4 or more spaces are ignored.

Only standalone HTML comments are recognized. The comment body is trimmed and must start with `@code`.

Empty lines between pending `@code` annotations and the next heading are allowed. Non-`@code` comments or normal text before the next heading make the pending annotations `dangling_code_annotation`.

Multiple `@doc` tags on one declaration and multiple `@code` comments for one heading are allowed.
