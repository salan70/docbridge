# Annotations

DocBridge annotations declare a link explicitly on both sides. A project can
declare links in the [link manifest](link-manifest.md) instead.

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

Rust uses documentation comments with `@doc` attached to supported
declarations (`///`, `//!`, and `/** */`, including forms that syn surfaces as
`#[doc]` attributes):

```rust
/// @doc docs/specs/auth.md#login-flow
pub fn login(email: &str, password: &str) {}
```

Go uses the doc comment of a supported declaration, as `//` lines or a
`/* */` block, with `@doc` on its own line:

```go
// Login starts the login flow.
//
// @doc docs/specs/auth.md#login-flow
func Login(email, password string) error { return nil }
```

JavaScript uses JSDoc `@doc` tags exactly as TypeScript does:

```js
/** @doc docs/specs/auth.md#login-flow */
export function login(email, password) {}
```

Python uses the declaration's docstring, or the contiguous `#` comment block
directly above its first decorator or keyword:

```python
def login(email: str, password: str) -> None:
    """Start the login flow.

    @doc docs/specs/auth.md#login-flow
    """
```

Ruby uses the contiguous block of full-line `#` comments directly above the
declaration:

```ruby
# @doc docs/specs/auth.md#login-flow
def login(email, password); end
```

Java uses the Javadoc comment that javac associates with the declaration:

```java
/**
 * Starts the login flow.
 *
 * @doc docs/specs/auth.md#login-flow
 */
public void login(String email, String password) {}
```

Markdown uses standalone HTML comments with `@code` attached to the next heading:

```md
<!-- @code src/cli/index.ts#runCheck -->

## Check Command
```

Both `@doc` and `@code` allow optional text after the target. DocBridge treats the first whitespace-delimited token as the target and ignores the rest.

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
- a variable statement (`const`, `let`, or `var`) with a single declarator
- `enum`
- `const enum`
- named default `function`
- named default `class`
- `declare` forms of supported declarations inside `.ts` files

TypeScript type members are also supported and are listed in
[Scanning](./scanning.md#typescript-members). Member endpoints are
type-qualified without parameter signatures, so Markdown backlinks must use the
scanner-produced canonical ID exactly:

```md
<!-- @code src/auth/service.ts#AuthService.login -->

## Login Flow
```

Unsupported declarations with `@doc` produce `unsupported_declaration`. Unsupported declarations without `@doc` are ignored.

Unsupported examples include:

- anonymous default exports
- variable statements with several declarators, such as `export const a = 1, b = 2`
- namespace and module declarations
- re-exports, including type-only re-exports
- non-exported declarations with `@doc`
- members whose name is not a plain identifier, enum members, index signatures,
  call and construct signatures, and constructor parameter properties

DocBridge relies on the TypeScript Compiler API to associate JSDoc with declarations. Orphan `@doc` comments that are not associated with a declaration are not detected.

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

Supported JavaScript declarations are the TypeScript forms an ES module can
express, listed in [Scanning](./scanning.md#javascript-scanning), with the
same canonical IDs:

```md
<!-- @code src/auth/service.js#AuthService.login -->

## Login Flow
```

Supported Python declarations are listed in
[Scanning](./scanning.md#python-scanning). Python canonical IDs are
dot-qualified names, and a property's getter, setter, and deleter share one
endpoint:

```md
<!-- @code src/auth/service.py#AuthService.login -->

## Login Flow
```

Supported Ruby declarations are listed in
[Scanning](./scanning.md#ruby-scanning). Ruby canonical IDs use `::` between
constants and `.` before a method name, and a singleton method adds `self.`:

```md
<!-- @code lib/auth/service.rb#Auth::Service.self.build -->

## Constructing the Service
```

Supported Java declarations are listed in
[Scanning](./scanning.md#java-scanning). Java canonical IDs are dot-qualified
type names without the package, and a method or constructor adds its
parameter types, so overloads are separate endpoints:

```md
<!-- @code src/main/java/com/example/auth/AuthService.java#AuthService.login(String,char[]) -->

## Login Flow
```

Markdown `@code` comments may be indented by 0 to 3 spaces. Comments indented by 4 or more spaces are ignored.

Only standalone HTML comments are recognized. The comment body is trimmed and must start with `@code`.

Empty lines between pending `@code` annotations and the next heading are allowed. Non-`@code` comments or normal text before the next heading make the pending annotations `dangling_code_annotation`.

Multiple `@doc` tags on one declaration and multiple `@code` comments for one heading are allowed.
