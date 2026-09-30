# 設定

DocBridge は、`--root` で指定した project root、または現在の directory から
`docbridge.config.json` を読みます。path と glob はその root からの相対指定です。
各 key、pattern、値の厳密な規則は
[Configuration specification](https://github.com/salan70/docbridge/blob/main/docs/specs/configuration.md)
（英語）にあります。

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

他の言語も、それぞれの key の下に同じ形で書きます。`internal` 配下の package を
対象にする Go project の例です。

```json
{
  "$schema": "./node_modules/docbridge/schemas/docbridge.schema.json",
  "include": {
    "code": {
      "go": {
        "patterns": ["internal/**/*.go"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

複数言語を同時に設定できますが、同じソースファイルを複数言語の pattern に一致させる
ことはできません。

## 言語

| Key          | ファイル              | `visibility` の値                | 既定値                | Scanner                   |
| ------------ | --------------------- | -------------------------------- | --------------------- | ------------------------- |
| `typescript` | `.ts`（`.d.ts` 以外） | `public`、`protected`、`private` | `public`、`protected` | 組み込み                  |
| `swift`      | `.swift`              | `public`、`open`、`internal`     | `public`、`open`      | `docbridge-swift-scanner` |
| `dart`       | `.dart`               | `public`                         | `public`              | `docbridge_dart_scanner`  |
| `rust`       | `.rs`                 | `pub`、`private`                 | `pub`                 | `docbridge-rust-scanner`  |
| `go`         | `.go`                 | `exported`、`unexported`         | `exported`            | `docbridge-go-scanner`    |

pattern は言語の拡張子で終わる必要があります。npm package は Swift、Dart、Rust、Go の
scanner を `darwin-arm64` と `linux-x64` 向けに同梱します。TypeScript と Markdown には
scanner binary は不要です。

各言語は任意の `visibility` 配列を受け取り、省略時は上の既定値を使います。TypeScript の
`visibility` は型の member にだけ適用され、top-level の宣言は export されている必要が
あります。Rust の `pub` は制限なしの `pub`、`private` はそれより狭いすべての可視性です。
visibility で対象外になった宣言は endpoint になりません。対象外の TypeScript member
に `@doc` を書くと `unsupported_declaration` になり、Swift、Dart、Rust、Go の scanner は
対象外の宣言の `@doc` を診断なしで無視します。Dart の先頭 underscore による private や、Go の
method の exported 判定など、言語ごとの宣言規則は [リンク](linking.md) を参照して
ください。scanner の厳密な挙動と platform key は
[Scanning specification](https://github.com/salan70/docbridge/blob/main/docs/specs/scanning.md)
（英語）が定めます。

## 対象外のファイル

設定に `exclude` property や glob の否定はありません。test、fixture、生成物、一般文書を
除くには、肯定の include pattern を狭くします。

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

Go では `**/*.go` より `cmd/**/*.go` と `internal/**/*.go` の方が対象は少なく
なりますが、その配下の `_test.go` は引き続き走査されます。

dependency directory、Git metadata、dot で始まる path segment、symbolic link、
TypeScript declaration file（`.d.ts`）は常に無視されます。`docbridge check --audit`
が実装の細部や一般的な文書まで報告せず、有用な不足箇所を示すように pattern を
絞ります。

## 設定変更を検証する

変更後に `docbridge check` を実行します。ファイルの欠落、読み取り不能、JSON の不備は
`config_file_invalid`、未知の key は `config_unknown_key`、受け付けられない値は
`config_invalid_value` です。既存ファイルを変更せずに開始案を確認するには
`docbridge init --dry-run` を使います。

次は [リンク](linking.md) でアノテーション規則を確認するか、
[コマンド](commands.md) で検査方法を選びます。
