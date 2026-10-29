# DocBridge

[![English README](https://img.shields.io/badge/README-English-blue)](../../README.md)

DocBridge は Markdown ドキュメントと、その内容を実装するコードファイルを結び付けます。
Markdown の見出しの直前に `<!-- @code path -->` の行を書くと、その節がコードファイルにリンクされます。
`docbridge validate` がリンクを検証し、`docbridge links` と `docbridge unlinked` が関係する箇所とリンクのない箇所を示します。
人間とコーディングエージェントは、変更の前に対応する文書やコードを見つけられます。

DocBridge は単体のネイティブ実行ファイルです。
言語のランタイムを必要とせず、コードを解析しないので、どの言語でも使えます。

## インストール

ネイティブ CLI の最初のリリース `0.17.0` はまだ公開されていません。
公開までは、ソースからビルドしてください。

- GitHub Releases から（`0.17.0` の公開後）: [GitHub Releases](https://github.com/salan70/docbridge/releases) から使っている環境の実行ファイルをダウンロードし、`PATH` の通った場所に置いて実行権限を付けます。
  Linux x64 と ARM64（静的リンクの musl）、macOS x64 と ARM64、Windows x64 を提供します。
- Nix で: `nix profile install github:salan70/docbridge` を実行するか、flake の `packages.<system>.docbridge` を使います。
- ソースから（Rust 1.83 以降）: `cargo install --locked --git https://github.com/salan70/docbridge docbridge` を実行します。

`docbridge upgrade` が置き換えるのは、インストールの記録（receipt）を持つ単体のインストールだけです。
置き換えの前にリリースの署名を検証します。
Nix などのパッケージマネージャーで入れた場合は、そのパッケージマネージャーで更新してください。

npm パッケージ（`0.16.0` 以前）から移行する場合、ネイティブ CLI に互換レイヤーはありません。
移行ガイド（`docbridge docs show migration`、または [`crates/docbridge/guides/migration.md`](../../crates/docbridge/guides/migration.md)）の手順に従ってください。

## 最初の節をリンクする

プロジェクトのルートで設定の提案とエージェント向け Skill のインストールを行い、書き込まれた内容を確認します。

```sh
docbridge init
```

設定ではコードのディレクトリと拡張子、ドキュメントのディレクトリを選びます。

```json
{
  "include": {
    "code": { "paths": ["src"], "extensions": [".ts"] },
    "docs": ["docs"]
  },
  "exclude": {}
}
```

`docs/auth.md` の見出しの直前にアノテーションを書き、その節を実装するファイルへリンクします。

```md
<!-- @code src/auth.ts -->

## Login Flow
```

リンクを検証し、内容を確認します。

```sh
docbridge validate
docbridge links docs/auth.md --include-content
docbridge unlinked
```

`validate` は、設定とリンクが正しければ `0`、そうでなければ `1` で終了します。
構造が正しくても、コードと文章の意味が一致するとは限りません。
リンク先の内容は、人間かエージェントが確認してください。

## ガイド

CLI は英語のガイドを同梱しています。
オフラインで読め、インストールしたバージョンの内容と一致します。

```sh
docbridge docs list
docbridge docs show getting-started
```

ガイドの原稿は [`crates/docbridge/guides/`](../../crates/docbridge/guides/) にあります。

- [英語のドキュメントハブ](../README.md) — 仕様とコントリビューター向けの資料
- [変更履歴](../../CHANGELOG.md) — リリース履歴（英語）
- [コミットメッセージ](contributing/commits.md)

## 開発への参加

リポジトリのセットアップ、テスト、プルリクエストの方針は [CONTRIBUTING.md](../../CONTRIBUTING.md)、ドキュメントの配置と執筆規約は [Documentation Guidelines](../contributing/documentation.md) を参照してください。
