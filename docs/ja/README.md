# SpecLink

[![English README](https://img.shields.io/badge/README-English-blue)](../../README.md)

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

SpecLink は、TypeScript のトップレベル export シンボルと Markdown セクションをリンクします。

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

## 範囲

SpecLink は以下の要素を対象にします。

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

変更したファイルにリンクされたカウンターパートを一覧する:

```sh
git diff --name-only | speclink related --stdin
```

`speclink related` は情報提供のためのコマンドです。各カウンターパートと、それ自身が
変更セットに含まれるかどうかを報告し、成功時は常に `0` で終了します。変更ファイルは
位置引数でも渡せます。`--gate` を付けると、変更セットに含まれていないカウンターパート
のみを報告し、1 件以上あれば `1` で終了します。`just related-gate` は未コミットの
変更に対してこれを実行します。どちらのモードも `--root` と `--json` に対応します。
詳細は [../specs/cli.md](../specs/cli.md) を参照してください。

変更したファイルにリンクされたカウンターパートの内容を出力する:

```sh
git diff --name-only | speclink context --stdin
```

`speclink context` は「リンクされたカウンターパートに何が書かれているか」に答える
コマンドです。ドキュメント側のカウンターパートは Markdown セクション全体、コード側の
カウンターパートは JSDoc を含む宣言全体を出力します。デフォルト出力はエージェントの
プロンプトへそのまま注入できる Markdown で、`--json` は
[../../schemas/context-output.schema.json](../../schemas/context-output.schema.json)
に従います。抽出はベストエフォートで、リンク切れがあっても成功時は `0` で終了します。
詳細は [../specs/cli.md](../specs/cli.md) を参照してください。

## AI エージェント統合

SpecLink のリンクグラフは、AI コーディングエージェントから利用されることを想定して
設計されています。

- [../integrations](../integrations) — Claude Code、Codex、CI 向けのレシピ:
  `speclink context` による編集前のコンテキスト注入、`speclink related --gate` に
  よるゲートのトリアージ、PR へのレポート。
- [../../examples/hooks](../../examples/hooks) — レシピを実装した、コピーして使える
  エージェントフックスクリプト。
- [../../templates/skills](../../templates/skills) — 配布用のエージェントスキル:
  `speclink-annotate`(リンクペアの作成)と `speclink-sync`(ゲート結果の
  トリアージ)。

このリポジトリ自身も、`.claude/` と `.codex/` のガードレールでこれら 3 つを
ドッグフーディングしています。

## エディタ対応

SpecLink は、同じリンクグラフをエディタへ公開する Language Server を同梱します。

```sh
speclink lsp
```

`speclink lsp` は stdio 上で LSP を話し、リンクされた TypeScript と Markdown を
またいで Diagnostics、Hover、Definition、References を提供します。オプションは
受け取らず、プロジェクト root はエディタの `initialize` リクエストから決まります。
`speclink check` は変更ありません。

最小の VS Code クライアントは [../../editors/vscode](../../editors/vscode) にあり、
Extension Development Host での起動手順はその README を参照してください。詳細な
挙動は [../specs/lsp.md](../specs/lsp.md) に定義しています。

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

### 前提

推奨:

- Nix
- direnv

Nix development shell には、このリポジトリで使う以下のツールが含まれます。

- Bun
- just
- Git

Nix を使わない場合は、Bun と just をローカルにインストールしてから
プロジェクトのコマンドを実行してください。

### セットアップ

direnv で開発環境を有効にする:

```sh
direnv allow
```

または手動で Nix development shell に入る:

```sh
nix develop
```

依存関係をインストールする:

```sh
bun install --frozen-lockfile
```

リポジトリの Git hooks をインストールする:

```sh
just install-git-hooks
```

まだ `just` が `PATH` にない場合:

```sh
nix develop -c just install-git-hooks
```

pre-commit hook は `just check` と `just test` を実行します。

### 共通タスク

共通タスクは `just` で実行します。

```sh
just --list
just check
just check-example
just check-fixture <code>
just audit
just related-gate
just test
just build
```

### プロジェクト制約

Runtime:

- Bun

Language:

- TypeScript

Task runner:

- just

Environment loader:

- direnv

コア依存は最小限にします。実装は主に Bun と TypeScript Compiler API に
依存する方針です。

## 関連ドキュメント

- 英語 README: [../../README.md](../../README.md)
- 仕様: [../specs](../specs)
- v0.1 決定事項: [../decisions/v0.1.md](../decisions/v0.1.md)
- v0.2 決定事項: [../decisions/v0.2.md](../decisions/v0.2.md)
- v0.3 決定事項: [../decisions/v0.3.md](../decisions/v0.3.md)
- AI エージェント統合レシピ: [../integrations](../integrations)
- Commit message convention: [contributing/commits.md](contributing/commits.md)
- English commit message convention: [../contributing/commits.md](../contributing/commits.md)
- テスト規約: [contributing/testing.md](contributing/testing.md)
- English testing convention: [../contributing/testing.md](../contributing/testing.md)

## Roadmap

完了済みの v0.1 と v0.2 の機能は、上記の説明と
[../../CHANGELOG.md](../../CHANGELOG.md) に記載しています。現在の Roadmap では
今後の作業のみを扱います。

v0.3:

- Context generation
- AI integration

v0.4:

- MCP server
- Claude Code integration
- Cursor integration
- Zed integration
- Codex integration

## Vision

SpecLink はドキュメントジェネレーターではありません。

目的は、コードとドキュメントの関係を可視化し、移動可能にし、機械可読にすることです。人間と AI エージェントのどちらも、最小の手間で必要な文脈に到達できる状態を目指します。
