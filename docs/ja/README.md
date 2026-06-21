# DocBridge

[![npm version](https://img.shields.io/npm/v/docbridge.svg)](https://www.npmjs.com/package/docbridge)
[![English README](https://img.shields.io/badge/README-English-blue)](../../README.md)

Markdown を LSP の世界へ。

DocBridge は TypeScript、Swift、Dart のコードと Markdown ドキュメントの間に双方向リンクを作るツールです。実装ファイルと仕様ファイルをまたいで、Hover、Definition、References、Diagnostics のような LSP 的体験を実現することを目指します。

## インストール

DocBridge は npm package `docbridge` として配布し、Bun で実行します。

```sh
bunx docbridge check
```

現在のリリースは
[v0.4.0](https://github.com/salan70/docbridge/releases/tag/v0.4.0) で、npm では
`docbridge@0.4.0` として公開されています。

初期の npm package は Bun 専用で、Node.js runtime 互換は対象外です。
Swift / Dart scanner binary は `darwin-arm64` と `linux-x64` を同梱します。
TypeScript と Markdown の check は scanner binary なしで実行できます。
未対応 platform で Swift / Dart project を設定した場合は
`code_scanner_unavailable` を報告し、対応 platform key を表示します。

## クイックスタート

## クイックスタート

プロジェクト root で初回セットアップを実行します。

```sh
bunx docbridge init
```

エージェント主導の導入では `docbridge-adopt` をインストールし、セットアップ用コマンドを
表示します。

```sh
bunx docbridge init-with-agent
```

書き込み前に予定される操作を確認する:

```sh
bunx docbridge init --dry-run
```

`docbridge.config.json` を手動で作成することもできます。

```json
{
  "include": {
    "code": {
      "typescript": {
        "patterns": ["src/**/*.ts"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

export された TypeScript 宣言を Markdown section にリンクします。

```ts
/**
 * @doc docs/auth.md#login-spec
 */
export async function login() {
  // ...
}
```

Markdown file に backlink を追加します。

```md
<!-- @code src/auth/login.ts#login -->
## Login Spec

Login flow specification.
```

プロジェクトを検査します。

```sh
bunx docbridge check
```

## 使い方

リンクを検査する:

```sh
bunx docbridge check
```

別 root を検査する:

```sh
bunx docbridge check --root examples/typescript
```

JSON を出力する:

```sh
bunx docbridge check --json
```

監査診断を有効にする:

```sh
bunx docbridge check --audit
```

監査診断には以下を含めます。

- `undocumented_symbol`

変更したファイルにリンクされたカウンターパートを一覧する:

```sh
git diff --name-only | bunx docbridge related --stdin
```

`docbridge related` は情報提供のためのコマンドです。各カウンターパートと、それ自身が
変更セットに含まれるかどうかを報告し、成功時は常に `0` で終了します。変更ファイルは
位置引数でも渡せます。`--gate` を付けると、変更セットに含まれていないカウンターパート
のみを報告し、1 件以上あれば `1` で終了します。どちらのモードも `--root` と
`--json` に対応します。詳細は [../specs/cli.md](../specs/cli.md) を参照してください。

変更したファイルにリンクされたカウンターパートの内容を出力する:

```sh
git diff --name-only | bunx docbridge context --stdin
```

`docbridge context` は「リンクされたカウンターパートに何が書かれているか」に答える
コマンドです。ドキュメント側のカウンターパートは Markdown セクション全体、コード側の
カウンターパートは JSDoc を含む宣言全体を出力します。デフォルト出力はエージェントの
プロンプトへそのまま注入できる Markdown で、`--json` は
[../../schemas/context-output.schema.json](../../schemas/context-output.schema.json)
に従います。抽出はベストエフォートで、リンク切れがあっても成功時は `0` で終了します。
詳細は [../specs/cli.md](../specs/cli.md) を参照してください。

解決済みリンクグラフを確認する:

```sh
bunx docbridge graph
bunx docbridge graph --json --include-content
```

`docbridge graph` は解決可能な片方向リンクも含めた endpoint graph を出力します。
JSON 出力は [../../schemas/graph-output.schema.json](../../schemas/graph-output.schema.json)
に従います。

## なぜ DocBridge か

現代のソフトウェアプロジェクトでは、実装とドキュメントの間にずれが生まれがちです。

- コードを変更してもドキュメントが更新されない
- ドキュメントを変更してもコードが更新されない
- ある実装に関係する仕様を見つけにくい
- ある仕様に関係する実装を見つけにくい
- AI コーディングエージェントが変更時に必要な文脈を見つけにくい

DocBridge は、コードとドキュメントの関係を明示的で、移動可能で、機械可読なものにします。

## コンセプト

従来のドキュメントツールは、多くの場合一方向の関係を扱います。

```text
Code -> Documentation
```

DocBridge は双方向の関係を扱います。

```text
Code <-> Documentation
```

DocBridge は、対応しているコード宣言と Markdown セクションをリンクします。TypeScript はプロセス内でスキャンし、Swift と Dart は同梱する first-party worker package でスキャンします。

## 対応入力

DocBridge は以下の要素を対象にします。

対象にするコード宣言:

- TypeScript のトップレベル export 宣言: `function`、`class`、`abstract class`、`interface`、`type`、`const`、`enum`、および対応する `declare` / 名前付き default 形式
- Swift の `public` / `open` 宣言と、設定で含めた `internal` 宣言: トップレベルと member の型、関数、変数、定数、initializer、extension member
- Dart の public 宣言: トップレベル関数/変数、class、enum、mixin、constructor、field、accessor、method、extension member

対象にする Markdown 要素:

- ATX 見出し
- HTML コメント
- 次の見出しに紐づく `@code` アノテーション

Swift と Dart も同じ `@doc` / `@code` モデルを使います。コード側 fragment は
scanner が生成する canonical ID で、member は型名で修飾されます。

```swift
/// @doc docs/auth.md#login-spec
public struct AuthService {
  public func login(email: String, password: String) {}
}
```

```md
<!-- @code Sources/AuthService.swift#AuthService.login(email:password:) -->
## Login Spec
```

プロジェクトは `docbridge.config.json` でスキャン対象を定義する必要があります。
暗黙のデフォルト設定はありません。設定ファイルがない場合、DocBridge は
`config_file_invalid` を報告し、プロジェクトファイルをスキャンしません。

TypeScript 向けの最小設定:

```json
{
  "include": {
    "code": {
      "typescript": {
        "patterns": ["src/**/*.ts"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

多言語設定は language-keyed です。古い `include.code` の配列形式は無効です。`typescript` entry に移行してください。

```json
{
  "include": {
    "code": {
      "typescript": { "patterns": ["src/**/*.ts"] },
      "swift": { "patterns": ["Sources/**/*.swift"] },
      "dart": { "patterns": ["lib/**/*.dart"] }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

source checkout から Swift / Dart project を検査するには、先に scanner worker を build します。Swift は `just build-swift-scanner`、Dart は `just build-dart-scanner` を使ってください。

## AI エージェント統合

DocBridge のリンクグラフは、AI コーディングエージェントから利用されることを想定して
設計されています。

- [../integrations](../integrations) — Claude Code、Codex、CI 向けのレシピ:
  `docbridge context` による編集時のカウンターパート把握、`docbridge related --gate`
  によるゲートのトリアージ、PR へのレポート。
- [../../examples/hooks](../../examples/hooks) — レシピを実装した、コピーして使える
  エージェントフックスクリプト。
- [../../templates/skills](../../templates/skills) — `docbridge init` と
  `docbridge init-with-agent` がインストールする配布用エージェントスキル:
  `docbridge-annotate`、`docbridge-sync`、`docbridge-adopt`、`docbridge-link`、
  `docbridge-review`。

このリポジトリ自身も、`.claude/`、`.codex/`、`.agents/` のガードレールで
これらをドッグフーディングしています。

## エディタ対応

DocBridge は、同じリンクグラフをエディタへ公開する Language Server を同梱します。

```sh
docbridge lsp
```

`docbridge lsp` は stdio 上で LSP を話し、リンクされたコードと Markdown を
またいで Diagnostics、Hover、Definition、References を提供します。オプションは
受け取らず、プロジェクト root はエディタの `initialize` リクエストから決まります。
`docbridge check` は変更ありません。

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
- `code_parse_error`
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
- Dart SDK

Nix を使わない場合は、Bun と just をローカルにインストールしてから
プロジェクトのコマンドを実行してください。Swift scanner の開発には、`PATH`
上の Swift 6 toolchain も必要です。CI では Swift を Nix とは別にインストールします。

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
just check-swift-example
just check-dart-example
just check-fixture <code>
just audit
just related-gate
just test
just test-swift-scanner
just test-dart-scanner
just build
just verify-dist
```

`just check`、`just test`、`just build` が標準の local / CI gate です。
`just test` には TypeScript、Swift、Dart の end-to-end integration test が含まれます。Swift / Dart の integration test は scanner binary を起動するため、事前に worker を build しておく必要があります。worker code を変更する場合は native scanner test も実行します。CI では必須です。
`just verify-dist` は `dist/index.js` の Bun shebang、実行 bit、`--version`、
`--help`、TypeScript example check を確認します。

### プロジェクト制約

Runtime:

- Bun

Language:

- TypeScript
- Swift scanner worker package
- Dart scanner worker package

Task runner:

- just

Environment loader:

- direnv

コア依存は最小限にします。CLI は主に Bun と TypeScript Compiler API に依存し、Swift / Dart parser への依存は worker package 内に分離します。

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

完了済みの v0.1〜v0.4 の機能は、上記の説明と
[../../CHANGELOG.md](../../CHANGELOG.md) に記載しています。現在の Roadmap では
今後の作業のみを扱います。

v0.5:

- リンクグラフと `docbridge context` の出力をツールとして公開する MCP サーバー
- それを基盤としたエディタ・エージェント連携(Claude Code、Cursor、Zed、Codex)

## Vision

DocBridge はドキュメントジェネレーターではありません。

目的は、コードとドキュメントの関係を可視化し、移動可能にし、機械可読にすることです。人間と AI エージェントのどちらも、最小の手間で必要な文脈に到達できる状態を目指します。
