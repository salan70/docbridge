# 設定

DocBridge は、`--root` で指定した project root、または現在の directory から
`docbridge.config.json` を読みます。path と glob はその root からの相対指定です。

## 最小設定

ドキュメントと、少なくとも1つのコード言語を指定します。

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

使用できる言語 key は `typescript`、`swift`、`dart`、`rust` です。複数言語を
同時に設定できますが、同じソースファイルを複数言語の pattern に一致させることは
できません。

## 可視性

各言語は任意の `visibility` 配列を受け取ります。省略時は TypeScript が
`public` と `protected`、Swift が `public` と `open`、Dart が `public` のみ、
Rust が制限なしの `pub` を対象にします。対象外の宣言に `@doc` を書くと
`unsupported_declaration` になります。言語ごとの宣言規則は
[リンク](linking.md) を参照してください。

## 対象外のファイル

設定に `exclude` property はありません。test、fixture、生成物、一般文書を除くには
include pattern を狭くします。

```json
{
  "include": {
    "code": {
      "typescript": {
        "patterns": ["src/domain/**/*.ts", "src/services/**/*.ts"]
      }
    },
    "docs": ["docs/specs/**/*.md"]
  }
}
```

dependency directory、Git metadata、dot で始まる path segment、symbolic link、
TypeScript declaration file（`.d.ts`）は常に無視されます。

## 設定変更を検証する

変更後に `docbridge check` を実行します。ファイルの欠落、読み取り不能、JSON の不備は
`config_file_invalid`、未知の key は `config_unknown_key`、受け付けられない値は
`config_invalid_value` です。既存ファイルを変更せずに開始案を確認するには
`docbridge init --dry-run` を使います。

次は [リンク](linking.md) でアノテーション規則を確認するか、
[コマンド](commands.md) で検査方法を選びます。
