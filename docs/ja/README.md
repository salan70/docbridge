# DocBridge

[![npm version](https://img.shields.io/npm/v/docbridge.svg)](https://www.npmjs.com/package/docbridge)
[![English README](https://img.shields.io/badge/README-English-blue)](../../README.md)

DocBridge は、Markdown ドキュメントと、その内容を実装するコードを双方向に
結び付けます。TypeScript、Swift、Dart、Rust の対応宣言に書く `@doc` と、
Markdown 見出しに書く `@code` を検証し、人間とコーディングエージェントが変更前に
正しいカウンターパートへ到達できるようにします。

## 必要な環境

- Node.js 22 以降、または Bun 1.1.31 以降
- Markdown と対応言語のソースコードを含むプロジェクト

対応する macOS / Linux 向けの Swift、Dart、Rust scanner はパッケージに同梱
されています。対応 platform の詳細は
[Releases](https://github.com/salan70/docbridge/releases) を参照してください。

## インストール

```sh
npm install --save-dev docbridge
```

Bun を使う場合:

```sh
bun add --dev docbridge
```

## 最初のチェックを成功させる

対話形式で初期設定を作成します。

```sh
npx docbridge init
```

TypeScript 向けの最小設定を手動で書く場合は次のとおりです。

```json
{
  "$schema": "./node_modules/docbridge/schemas/docbridge.schema.json",
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

対応するコード宣言にドキュメントのリンク先を追加します。

```ts
/** @doc docs/auth.md#login-flow */
export function login(): void {}
```

Markdown 見出しの直前に逆向きのリンクを追加します。

```md
<!-- @code src/auth.ts#login -->

## Login Flow
```

リンクの組を検証します。

```sh
npx docbridge check
```

リンクグラフが正しければ終了コードは `0` です。設定不備、未解決のリンク先、
backlink の欠落がある場合は診断を表示して `1` で終了します。

## 次に読むガイド

- [はじめに](user/getting-started.md) — インストールと初期設定
- [設定](user/configuration.md) — 対象範囲、言語、可視性
- [リンク](user/linking.md) — 対象選定、アノテーション、意味のレビュー
- [コマンド](user/commands.md) — check、related、context、graph、docs、upgrade
- [自動化](user/automation.md) — エージェント、Git hook、CI
- [トラブルシューティング](user/troubleshooting.md) — 設定・scanner・リンク診断
- [英語のドキュメントハブ](../README.md)

英語のタスクガイドは CLI と同じ version で配布されます。
`npx docbridge docs list` と `npx docbridge docs show <name>` で参照できます。

コントリビュータ向けの環境・テスト・Pull Request 規約は
[CONTRIBUTING.md](../../CONTRIBUTING.md)、ドキュメントの配置と執筆規約は
[Documentation Guidelines](../contributing/documentation.md) を参照してください。
