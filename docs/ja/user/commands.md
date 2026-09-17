# コマンド

知りたいことに対して最も狭いコマンドを使います。正確な option と終了条件は
`docbridge <command> --help` で確認できます。

## check: プロジェクトを検証する

```sh
docbridge check
```

設定、アノテーション、target、双方向性、および任意の link manifest を検証します。
`--audit` は未文書化の宣言と
未リンクの Markdown section を warning として追加し、`--json` は機械可読な結果を
返します。error があれば終了コード `1`、warning のみなら `0` です。

## related: カウンターパートを探す

```sh
git diff --name-only | docbridge related --stdin
```

変更ファイルにリンクされた相手を列挙します。`--gate` は変更セットに含まれない相手が
あれば `1` になりますが、更新が必要かどうかは判断しません。

## context: カウンターパートを読む

```sh
docbridge context src/auth.ts
```

リンクされた Markdown section またはコード宣言を出力します。通常出力は agent prompt
向け、`--json` は構造化された context、diagnostic、summary 向けです。

## graph: リンク構造を調べる

```sh
docbridge graph --json --include-content
```

endpoint、edge、双方向 pair、未解決リンクを表示します。path を渡すと、そのファイルと
直接のカウンターパートに絞れます。`--include-content` は `--json` と併用します。

## upgrade: CLI と skill の版を揃える

```sh
docbridge upgrade --check
```

読み取り専用の診断です。インストール済み version、npm の最新安定版、利用中の
package manager に応じた upgrade コマンド、管理対象 `docbridge` skill の状態、
旧 5 skill 構成の残骸、symlink、ローカル編集を報告します。

DocBridge は自身を upgrade せず、package manager を代行実行もしません。表示された
コマンドで CLI を更新してから、`docbridge upgrade` を再実行してください。

```sh
docbridge upgrade --dry-run
docbridge upgrade --force --yes
```

`--dry-run` はファイルを書かずに計画のみ出力します。`--force` なしでは既存の skill
directory を保持し、移行を pending として報告します。`--force` は管理対象 skill を
同梱 template で置き換え、既知の legacy skill directory のみを削除します。削除するのは
通常の directory を辿って到達できる通常の directory だけです。symlink、legacy 名の
通常ファイル、symlink された `.agents/skills` や `.claude/skills` の配下は、報告する
だけで変更しません。skill の置き換えは同梱 template を厳密に再現するため、その
directory 内に自分で追加したファイルは `--force` で残りません。ローカルのメモは管理
対象 directory の外に置くか、自分で管理するコピーへの symlink にしてください。破壊的
操作は `--yes` がなければ確認を求め、非対話実行では失敗します。設定、hook、CI recipe、
利用者のファイルは変更しません。

## 更新通知

対話端末では、より新しい安定版がある場合に stderr へ1行だけ通知します。短い timeout
と1日単位の user 単位 cache を使い、オフラインでは無言で失敗し、stdout と終了コードは
変えません。CI、`--json`、language server、出力のリダイレクト、
`DOCBRIDGE_NO_UPDATE_CHECK=1` では抑止されます。この環境変数は `upgrade` の registry
参照も停止します。その場合、最新 version は unknown と表示され、ローカルの asset 状態
のみを報告します。

## docs: 同梱ガイドを読む

`docbridge docs list` は CLI と同じ version のガイドを一覧し、
`docbridge docs show <name>` は1件を出力します。canonical 名は
`getting-started`、`configuration`、`linking`、`commands`、`automation`、
`troubleshooting` です。

別 directory を project root にする場合は project command に `--root <path>` を
指定します。リンク作成は [リンク](linking.md)、自動化は [自動化](automation.md)、
失敗時は [トラブルシューティング](troubleshooting.md) を参照してください。
