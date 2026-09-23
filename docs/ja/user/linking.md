# リンク

このガイドでは、意味のあるドキュメントセクションを選び、`@doc` / `@code` の
双方向リンクを作成し、その関係が現在も正しいかレビューするまでを扱います。

## リンク対象を選ぶ

挙動、契約、入出力、制約、ユーザーに見える仕様、設計判断を説明するセクションを
優先します。README、changelog、コントリビューションガイド、runbook、release note は、
特定のセクションが継続的な仕様として機能する場合を除いて対象外にします。

コード側は、仕様を実装または代表する対応済み public API 宣言を優先します。適切な
宣言がなければ無理にリンクせず、採用・除外・保留をセクション単位で判断します。

## 候補をドキュメント側から探す

1. 対象にするドキュメント directory を確認する。
2. 未リンクの仕様セクションを優先する。
3. 1セクションにつき最大3つの候補 symbol と理由、不確実な点を示す。
4. 採用・除外・保留を決めてからアノテーションを追加する。

`docbridge check --audit` は候補を探す助けになりますが、すべてをリンクせよという指示
ではありません。

## リンク先の文法

両方のアノテーションは project root 相対の `file#fragment` を取ります。

- path separator は `/` を使う
- file と fragment の両方を書く
- アノテーションを書いたファイル自身を target にしない（同一ファイルの target は無効）
- `./`、`../`、絶対 path、target 内の空白は使わない
- target の後ろには説明用テキストを追加できる

同じ宣言に複数の `@doc`、同じ見出しに複数の `@code` を書けます。同じ source から
同じ target を重複指定すると `duplicate_link` です。

## コードからドキュメントへ

宣言の documentation comment に `@doc` を書きます。

```ts
/** @doc docs/auth.md#login-flow */
export function login(): void {}
```

```swift
/// @doc docs/auth.md#login-flow
public func login(email: String, password: String) {}
```

```dart
/// @doc docs/auth.md#login-flow
void login(String email, String password) {}
```

```rust
/// @doc docs/auth.md#login-flow
pub fn login(email: &str, password: &str) {}
```

対応形式と visibility は [設定](configuration.md) で選びます。対象外の宣言に
`@doc` を書くと `unsupported_declaration` です。

### TypeScript の宣言

top-level の export された function、class、interface、type alias、enum、1つだけを
宣言する const と、対応する `declare` / 名前付き default 形式を扱います。class の
method、property、accessor、constructor、static member、interface member、object literal
型 alias の member も対象です。

member ID は引数を含まず、`AuthService.login` や `AuthService.constructor` の形式です。
既定では `public` と `protected` を含み、`private` は明示的に設定します。匿名 default
export、namespace、re-export、複数 declarator の const、computed member 名、enum member、
call / index / construct signature は endpoint になりません。

### Swift の宣言

top-level と member の型、function、variable、constant、initializer、actor、protocol、
extension member を扱います。既定は `public` と `open` で、`internal` は明示的に設定
します。member ID は `AuthService.login(email:password:)` のように argument label を
含みます。

### Dart の宣言

top-level function、accessor、variable、class、enum、mixin、constructor、field、method、
extension member を扱います。public endpoint のみ対応し、canonical ID のいずれかの
segment が `_` で始まれば private です。member ID は引数を含みません。setter の末尾は
`=`、無名 constructor は `.new`、名前付き constructor は名前を保持します。

### Rust の宣言

module、struct、enum、free function、inherent `impl` method を扱います。既定は制限なしの
`pub` で、非 `pub` は `private` を設定した場合に含めます。trait 定義と実装、macro、
const、static、union、extern block は endpoint ではありません。ID は
`TypingEngine::advance` のように `::` で修飾します。

## ドキュメントからコードへ

リンクする ATX 見出しの直前に、独立した HTML comment を置きます。0〜3文字の先頭
space と、comment と見出しの間の空行は許可されます。それ以外の内容を挟むと
`dangling_code_annotation` になります。

```md
<!-- @code src/auth.ts#login -->

## Login Flow
```

fragment には scanner が生成した canonical symbol ID をそのまま使います。

## 見出し anchor と双方向性

DocBridge は ATX 見出しだけを小文字化し、空白と記号の連続を `-` に変換し、先頭と
末尾の `-` を除いて anchor を作ります。Unicode の文字と数字は保持されます。
たとえば `## Login Spec (v2)` は `#login-spec-v2` です。
空見出しは anchor を持たず、空見出しに付けた `@code` は
`dangling_code_annotation` になります。同じファイルの重複 anchor は
`duplicate_doc_anchor` で、GitHub のような連番は追加しません。

各方向は独立して検証されます。片方向の target が存在しても backlink がなければ
診断になります。編集後は必ず `docbridge check` を実行します。

## manifest でリンクを宣言する

ソースファイルにツール固有のマーカーを置けないチームもあります。そうしたプロジェクト
は、任意の root ファイル `docbridge.links.json` にすべてのリンクを宣言し、アノテー
ションを一切書かずに済ませられます。推奨スタイルはアノテーションのままで、両方式は
1 つのプロジェクトで併用できます。

```json
{
  "$schema": "./node_modules/docbridge/schemas/docbridge.links.schema.json",
  "links": [
    {
      "code": "src/auth.ts#AuthService.login",
      "doc": "docs/auth.md#login-flow",
      "note": "任意。人間の読み手向けのメモ"
    }
  ]
}
```

1 エントリが双方向を宣言するため、manifest のリンクで backlink 不足は報告されません。
DocBridge は両端の存在だけを検証します。`check`、`related`、`context`、`graph`、
エディタのナビゲーションは、結果をアノテーション対と同じものとして扱います。

`code` のファイルは scope 内なのに symbol が存在しない場合は、manifest 固有の
`code_symbol_not_found` を `Did you mean` 候補つきで報告します。別のエントリや
アノテーションと同じリンクを繰り返すエントリは `duplicate_link` を報告します。

代償は、宣言されたリンクがコードやドキュメントの読み手から見えないことです。CI で
`related --gate` を実行し、片側の変更がもう片側を必ず表面化するようにしてください。

## 意味をレビューする

`docbridge check` はリンクの機械的な整合性を証明します。意味のレビューでは、リンク
されたセクションと宣言が同じ挙動や契約を説明しているかを確認します。

1. `docbridge graph --json --include-content` を実行し、まず診断を読む。
2. ドキュメントファイル単位で両 endpoint の内容を読む。
3. 挙動、入出力、制約、設計意図を比較する。
4. 明確に誤ったリンクは High、部分的・曖昧な関係は Medium、整理候補は Low とする。
5. endpoint、両側の根拠、推奨修正を報告する。

不確実という理由だけでアノテーションを削除しません。広い many-to-many より、少数の
正確なリンクを優先します。

次は [コマンド](commands.md)、[自動化](automation.md)、または
[トラブルシューティング](troubleshooting.md) を参照してください。
