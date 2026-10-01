# トラブルシューティング

最初に表示された diagnostic code を確認し、原因の層ごとに切り分けます。

## 設定エラー

`config_file_invalid` は設定ファイルの欠落、読み取り不能（path が directory である、
読み取り権限がないなど）、または不正な JSON を示します。欠落と読み取り不能のどちらでも
message は file が見つからないと表示します。
`config_unknown_key` は未対応 property、`config_invalid_value` は pattern、language、
visibility などの値が不正です。[設定](configuration.md) の最小例と比較し、
include pattern が選んだ `--root` からの相対 path で実在ファイルに一致するか確認します。

ファイルが欠落している場合は `docbridge init --dry-run` で生成案を確認します。path が
存在する場合は、有効な JSON を持つ読み取り可能なファイルにするか、削除して
`docbridge init` で作り直してから、`check` を再実行します。

同じ 3 つの code は、任意の link manifest `docbridge.links.json` にも使われます。
このファイルを読めない、または解析できない場合、CLI は修復か削除を促す案内を表示します。
形式は [リンク](linking.md) を参照してください。

## Scanner エラー

Swift、Dart、Rust、Go は package に同梱された scanner worker を使います。
`code_scanner_unavailable` は必要な scanner を起動できない状態で、多くの場合は
現在の platform 用 binary が package にないか、binary を実行できないことを示します。
まず package を再インストールします。platform が非対応なら、対応環境で DocBridge を
実行するか、repository から scanner を build します。

`code_scanner_failed` は worker の実行失敗で、壊れたリンクに変換せずに失敗内容を
含みます。worker は 1 回の実行でその言語の全ファイルを scan するため、失敗した実行は
それらの各ファイルに同じメッセージを報告します。project 自身の toolchain で source を
解析できるか確認し、設定対象を最小の file set に絞って再現します。

`code_parse_error` は TypeScript、Swift、Dart、Rust、Go の source file の構文エラーです。
診断は、その言語の parser が最初に見つけたエラーの位置を指し、parser のメッセージを含みます。
そのファイルからはリンクも symbol も抽出されないため、先に構文を直してから関係する
リンクの診断を確認します。`code_scanner_failed` と違い、worker 自体は正常に動作して
おり、source が解析できなかったことを示します。
`file_read_error` は設定に一致したファイルを読めなかったことを示し、message に OS の
理由が含まれます。

## リンク作成エラー

- `invalid_link_target`: `file#fragment` の形式を直す
- `doc_file_not_found` / `code_file_not_found`: root 相対 path と include pattern を確認する
- `doc_anchor_not_found`: ATX 見出しから作る anchor を確認する
- `code_symbol_not_found`: link manifest の `code` を実在する canonical ID に直す（`Did you mean` の候補を参照）
- `code_backlink_not_found` / `doc_backlink_not_found`: 逆向きアノテーションを追加する
- `duplicate_doc_anchor` / `duplicate_code_symbol`: endpoint が一意になるよう整理する
- `dangling_code_annotation`: `@code` comment を対応見出しの直前へ移す
- `unsupported_declaration`: 対応形式と visibility を [リンク](linking.md) で確認する
- `duplicate_link`: 同じ source から同じ target への重複を削除する

`undocumented_symbol` と `unlinked_doc_section` は `docbridge check --audit` のときだけ
出る warning で、リンクのない endpoint を示します。作成エラーではありません。

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
名前を使います。以前の guide 名は受け付けられません。

通常の終了コードと出力は [コマンド](commands.md)、自動化環境での扱いは
[自動化](automation.md) を参照してください。
