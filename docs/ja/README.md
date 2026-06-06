# SpecLink

Markdown を LSP の世界へ。

SpecLink は TypeScript のコードと Markdown ドキュメントの間に双方向リンクを作るツールです。実装ファイルと仕様ファイルをまたいで、Hover、Definition、References、Diagnostics のような LSP 的体験を実現することを目指します。

## 背景

現代のソフトウェアプロジェクトでは、実装とドキュメントの間にずれが生まれがちです。

- コードを変更してもドキュメントが更新されない
- ドキュメントを変更してもコードが更新されない
- ある実装に関係する仕様を見つけにくい
- ある仕様に関係する実装を見つけにくい
- AI コーディングエージェントが変更時に必要な文脈を見つけにくい

SpecLink は、コードとドキュメントの関係を明示的で、移動可能で、機械可読なものにします。

## コンセプト

従来のドキュメントツールは、多くの場合一方向の関係を扱います。

```text
Code -> Documentation
```

SpecLink は双方向の関係を扱います。

```text
Code <-> Documentation
```

v0.1 では、TypeScript のトップレベル export シンボルと Markdown セクションをリンクします。

## 例

TypeScript:

```ts
/**
 * @doc docs/auth.md#login-spec
 */
export async function login() {
  // ...
}
```

Markdown:

```md
<!-- @code src/auth/login.ts#login -->
## Login Spec

Login flow specification.
```

## v0.1 の範囲

最初のマイルストーンは `speclink check` に集中します。

対象にする TypeScript 宣言:

- トップレベル export の `function`
- トップレベル export の `class`
- トップレベル export の `abstract class`
- トップレベル export の `interface`
- トップレベル export の `type`
- トップレベル export の `const`
- トップレベル export の `enum`

対象にする Markdown 要素:

- ATX 見出し
- HTML コメント
- 次の見出しに紐づく `@code` アノテーション

デフォルトのスキャン対象:

- `src/**/*.ts`
- `docs/**/*.md`

プロジェクトは `speclink.config.json` でスキャン対象を上書きできます。

## CLI

リンクを検査する:

```sh
just check
```

別 root を検査する:

```sh
just check-example
```

JSON を出力する:

```sh
just check-example-json
```

監査診断を有効にする:

```sh
just audit
```

監査診断には以下を含めます。

- `undocumented_symbol`

## Diagnostics

Errors:

- `config_file_invalid`
- `config_unknown_key`
- `config_invalid_value`
- `invalid_link_target`
- `doc_file_not_found`
- `doc_anchor_not_found`
- `code_file_not_found`
- `code_backlink_not_found`
- `doc_backlink_not_found`
- `duplicate_doc_anchor`
- `duplicate_code_symbol`
- `typescript_parse_error`
- `file_read_error`

Warnings:

- `duplicate_link`
- `dangling_code_annotation`
- `unsupported_declaration`
- `--audit` 有効時の `undocumented_symbol`

終了コード:

- error が 1 件以上あれば `1`
- warning のみ、または診断なしなら `0`

## 開発

direnv で開発環境を有効にする:

```sh
direnv allow
```

または手動で Nix development shell に入る:

```sh
nix develop
```

共通タスクは `just` で実行します。

```sh
just --list
just check-example
just test
just build
```

Runtime:

- Bun

Language:

- TypeScript

コア依存は最小限にします。実装は主に Bun と TypeScript Compiler API に依存する方針です。

Task runner:

- just

Environment loader:

- direnv

## 関連ドキュメント

- 英語 README: [../../README.md](../../README.md)
- v0.1 仕様: [../specs](../specs)
- v0.1 決定事項: [../decisions/v0.1.md](../decisions/v0.1.md)
- Commit message convention: [contributing/commits.md](contributing/commits.md)
- English commit message convention: [../contributing/commits.md](../contributing/commits.md)

## Roadmap

v0.1:

- JSDoc からの `@doc` parsing
- Markdown HTML コメントからの `@code` parsing
- Markdown scanner
- TypeScript Compiler API integration
- Link resolution
- Diagnostics
- `speclink check`

v0.2:

- Hover
- Definition
- References

v0.3:

- Context generation
- AI integration

v0.4:

- MCP server
- Claude Code integration
- Cursor integration
- Codex integration

## Vision

SpecLink はドキュメントジェネレーターではありません。

目的は、コードとドキュメントの関係を可視化し、移動可能にし、機械可読にすることです。人間と AI エージェントのどちらも、最小の手間で必要な文脈に到達できる状態を目指します。
