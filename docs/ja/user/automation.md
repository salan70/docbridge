# 自動化

まずローカルで `docbridge check` を成功させます。リンクの有効性は hard gate にし、
変更されていないカウンターパートは自動失敗ではなくレビュー義務として扱います。

## DocBridge を呼び出す

project で統一している方法、たとえば `PATH` 上の `docbridge`、package script、
`just check` のような recipe を使います。エージェントは `docbridge --help` と
`docbridge docs list` から操作方法を確認できます。

`docbridge init` は `docbridge.config.json` を作成し、配布 `docbridge` skill を
Codex、Claude Code、またはその両方に導入できます。
初期対象範囲をエージェントに選ばせる場合:

```sh
docbridge init-with-agent --agent-target codex
```

`claude` または `both` も選択できます。このコマンドは skill と次の prompt を準備
しますが、エージェント自体は起動しません。

## 編集時の流れ

編集前にカウンターパートを読みます。

```sh
docbridge context path/to/file
```

編集後に変更セットを検査します。

```sh
git diff --name-only | docbridge related --stdin --gate
```

報告された相手ごとに、契約が変わったなら更新する、記述が現在も正しければ内容を根拠に
据え置く、リンク先が誤っていれば pair を直す、のいずれかを判断します。gate を黙らせる
ためだけに正しいリンクを削除しません。

## Git hook

共有チェックは個々のエージェント設定ではなく repository hook に置きます。
pre-commit では `docbridge check` を blocking gate とし、staged file について
次の結果を情報として提示できます。

```sh
git diff --cached --name-only | docbridge related --stdin --gate
```

必要なら `docbridge context --stdin` で相手の内容も添えます。hook はファイルを自動
書き換えず、通常の品質 gate を置き換えません。hook は回避できるため、最終的な強制点は
Pull Request の CI です。

## CI

project 全体への `docbridge check` を hard gate にします。Pull Request では base と
head の差分を `related --stdin --gate` に渡し、`context` の内容を reviewer に提示
できます。差分計算に必要な commit を checkout してください。

一般的な方針はこのガイドが所有します。GitHub Actions のコピー可能な手順と sticky PR
comment の挙動は [CI recipe](../../integrations/ci.md) を参照してください。

## エージェント別の recipe

配布 skill は [`templates/skills/docbridge`](../../../templates/skills/docbridge) にあります。
client の設定や prompt の例は、次の recipe を参照してください。

- [Claude Code](../../integrations/claude-code.md)
- [Codex](../../integrations/codex.md)
- [CI](../../integrations/ci.md)

次は [コマンド](commands.md)、[リンク](linking.md)、または
[トラブルシューティング](troubleshooting.md) を参照してください。
