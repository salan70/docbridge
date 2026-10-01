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

| Key          | ファイル                                               | `visibility` の値                           | 既定値                | Scanner                   |
| ------------ | ------------------------------------------------------ | ------------------------------------------- | --------------------- | ------------------------- |
| `typescript` | `.ts`、`.tsx`、`.mts`、`.cts`（declaration file 以外） | `public`、`protected`、`private`            | `public`、`protected` | 組み込み                  |
| `javascript` | `.js`、`.jsx`、`.mjs`、`.cjs`                          | `public`、`protected`、`private`            | `public`、`protected` | 組み込み                  |
| `swift`      | `.swift`                                               | `public`、`open`、`internal`                | `public`、`open`      | `docbridge-swift-scanner` |
| `dart`       | `.dart`                                                | `public`                                    | `public`              | `docbridge_dart_scanner`  |
| `rust`       | `.rs`                                                  | `pub`、`private`                            | `pub`                 | `docbridge-rust-scanner`  |
| `go`         | `.go`                                                  | `exported`、`unexported`                    | `exported`            | `docbridge-go-scanner`    |
| `python`     | `.py`                                                  | `public`、`private`                         | `public`              | CPython 3.10 以降         |
| `ruby`       | `.rb`                                                  | `public`、`protected`、`private`            | `public`              | CRuby 3.3 以降            |
| `java`       | `.java`                                                | `public`、`protected`、`package`、`private` | `public`              | JDK 17 以降               |

pattern は言語の拡張子のいずれかで終わる必要があります。npm package は Swift、Dart、
Rust、Go の scanner を `darwin-arm64` と `linux-x64` 向けに同梱します。TypeScript、
JavaScript、Markdown には scanner binary は不要です。Python、Ruby、Java は、package に
含まれる worker をマシンにインストールされた interpreter や JDK で実行して走査するため、
platform を問いません。[Scanner の実行環境](#scanner-の実行環境) を参照してください。

各言語は任意の `visibility` 配列を受け取り、省略時は上の既定値を使います。TypeScript と
JavaScript の `visibility` は class や型の member にだけ適用され、top-level の宣言は
export されている必要があります。JavaScript の member はすべて `public` です。Rust の
`pub` は制限なしの `pub`、`private` はそれより狭いすべての可視性です。visibility で
対象外になった宣言は endpoint になりません。対象外の TypeScript / JavaScript member や、
対象外の Python / Ruby / Java の宣言に `@doc` を書くと `unsupported_declaration` になり、
Swift、Dart、Rust、Go の scanner は対象外の宣言の `@doc` を診断なしで無視します。
Dart と Python の先頭 underscore による private、Go の method の exported 判定、Ruby の
`private` 呼び出し、Java の interface member が暗黙に public になることなど、言語ごとの
宣言規則は [リンク](linking.md) を参照してください。scanner の厳密な挙動と platform key は
[Scanning specification](https://github.com/salan70/docbridge/blob/main/docs/specs/scanning.md)
（英語）が定めます。

## Scanner の実行環境

Python、Ruby、Java のファイルは、マシンにインストールされた実行環境で動く worker が
走査します。CPython 3.10 以降、同梱の Prism が source を解析する CRuby 3.3 以降、
`jdk.compiler` module が source を解析する JDK 17 以降が必要です。JRE にはこの module が
ないため、Java を走査できません。DocBridge は `PATH` から `python3`、次に `python`
（Windows では `py -3`、次に `python`）と、`ruby`、`java` を探し、使う前にそれぞれを
検査します。worker が project のコードを import、compile、実行することはありません。

別の実行環境を使うには `scanners` に指定します。

```json
{
  "include": {
    "code": { "python": { "patterns": ["src/**/*.py"] } },
    "docs": ["docs/**/*.md"]
  },
  "scanners": {
    "python": { "command": ["/opt/python3.12/bin/python3"] }
  }
}
```

`command` は実行環境の実行ファイルとその引数を並べた配列で、shell の文字列では
ありません。相対 path は project root から解決します。Java では
`["/opt/jdk-21/bin/java"]` のように JDK の `java` を指定します。設定で command を
指定しない場合は、環境変数 `DOCBRIDGE_PYTHON_RUNTIME`、`DOCBRIDGE_RUBY_RUNTIME`、
`DOCBRIDGE_JAVA_RUNTIME` で実行ファイルを 1 つ指定できます。設定の command や環境変数を
指定すると、その実行環境だけを試します。存在しない、または使えない場合、`PATH` に戻らず各ファイルが
`code_scanner_unavailable` を報告します。

設定した command は、CLI でも editor extension でも、DocBridge を実行するユーザーの
権限で動きます。信頼できない repository では、DocBridge を実行する前に `scanners` を
確認してください。

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
なりますが、その配下の `_test.go` は引き続き走査されます。Python、Ruby、Java でも、
`tests/`、`spec/`、`src/test/` などの test directory は同じように pattern の外に置きます。
Maven や Gradle の構成では `src/main/java/**/*.java` がそうなります。

dependency directory、Git metadata、dot で始まる path segment、symbolic link、
TypeScript declaration file（`.d.ts`、`.d.mts`、`.d.cts`）は常に無視されます。`docbridge check --audit`
が実装の細部や一般的な文書まで報告せず、有用な不足箇所を示すように pattern を
絞ります。

## 設定変更を検証する

変更後に `docbridge check` を実行します。ファイルの欠落、読み取り不能、JSON の不備は
`config_file_invalid`、未知の key は `config_unknown_key`、受け付けられない値は
`config_invalid_value` です。既存ファイルを変更せずに開始案を確認するには
`docbridge init --dry-run` を使います。

次は [リンク](linking.md) でアノテーション規則を確認するか、
[コマンド](commands.md) で検査方法を選びます。
