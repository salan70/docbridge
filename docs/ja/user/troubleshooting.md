# トラブルシューティング

最初に表示された diagnostic code を確認し、原因の層ごとに切り分けます。

## 設定エラー

`config_file_invalid` は設定の欠落、不正な JSON、schema 不一致を示します。
`config_unknown_key` は未対応 property、`config_invalid_value` は pattern、language、
visibility などの値が不正です。[設定](configuration.md) の最小例と比較し、
`docbridge init --dry-run` で生成案を確認してください。

## Scanner エラー

`code_scanner_unavailable` は必要な scanner を起動できない状態、
`code_scanner_failed` は worker の実行失敗、`code_parse_error` は対象 source の解析失敗
です。対応 platform、実行権限、runtime、source syntax を順に確認します。

## リンク作成エラー

- `invalid_link_target`: `file#fragment` の形式を直す
- `doc_file_not_found` / `code_file_not_found`: root 相対 path と include pattern を確認する
- `doc_anchor_not_found`: ATX 見出しから作る anchor を確認する
- `code_symbol_not_found`: link manifest の `code` を実在する canonical ID に直す（`Did you mean` の候補を参照）
- `code_backlink_not_found` / `doc_backlink_not_found`: 逆向きアノテーションを追加する
- `duplicate_doc_anchor` / `duplicate_code_symbol`: endpoint が一意になるよう整理する
- `dangling_code_annotation`: `@code` comment を対応見出しの直前へ移す
- `unsupported_declaration`: 対応形式と visibility を [リンク](linking.md) で確認する

修正後は `docbridge check` を再実行します。関係する endpoint を調べるには
`docbridge graph --json`、相手の内容を読むには `docbridge context` を使います。

## CLI 呼び出しエラー

未知の command や option、必要な引数の欠落は usage と復旧方法を stderr に表示して
終了コード `1` になります。`docbridge --help` または
`docbridge <command> --help` で有効な形を確認します。

`docbridge upgrade --force` は、管理対象 skill directory の置換や削除を非対話環境で
確認なしに行おうとした場合もこれに該当します。`--yes` を付けて再実行するか、
`docbridge upgrade --check` または `docbridge upgrade --force --dry-run` で先に計画を
確認してください。

`docbridge docs show <name>` が見つからない場合は `docbridge docs list` に表示された
canonical 名を使います。旧名には v0.9.x の間だけ置換先を示す warning が出ます。

通常の終了コードと出力は [コマンド](commands.md)、自動化環境での扱いは
[自動化](automation.md) を参照してください。
