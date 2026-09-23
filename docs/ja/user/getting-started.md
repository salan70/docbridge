# はじめに

DocBridge は、設定で選択した Markdown とコードだけを読み、対応するセクションと宣言が
双方向にリンクされているか検査します。ソースやドキュメントを外部へ送信しません。

## インストール

```sh
npm install --save-dev docbridge
```

Node.js 22 以降または Bun 1.1.31 以降が必要です。

## プロジェクトを設定する

作成予定の設定を先に確認します。

```sh
npx docbridge init --dry-run
```

続けて `npx docbridge init` を対話形式で実行します。対象範囲が明確な場合は
`--yes` を使用できます。このコマンドは `docbridge.config.json` を作成し、配布
`docbridge` skill を Codex、Claude Code、またはその両方に導入できます。既存の
`docbridge.config.json` は上書きしません。
エージェントに初期範囲を選ばせる場合は `npx docbridge init-with-agent` を使います。

## 最初の双方向リンクを作る

対応するコード宣言に `@doc` を追加します。

```ts
/** @doc docs/auth.md#login-flow */
export function login(): void {}
```

Markdown 見出しの直前に逆向きの `@code` を追加します。

```md
<!-- @code src/auth.ts#login -->

## Login Flow
```

プロジェクト root で検査します。

```sh
npx docbridge check
```

診断がなければ終了コードは `0` です。設定、リンク先、または backlink に問題がある
場合は `1` になります。

## 次に読む

- [設定](configuration.md) — 対象範囲や可視性を調整する
- [リンク](linking.md) — 対象を選び、正しいアノテーションを書く
- [コマンド](commands.md) — 調査に適したコマンドを選ぶ
- [自動化](automation.md) — Git hook、CI、エージェントへ組み込む
- [トラブルシューティング](troubleshooting.md) — 診断から復旧する
