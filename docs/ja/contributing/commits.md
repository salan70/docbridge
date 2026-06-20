# Commit Message Convention

DocBridge のコミットメッセージは英語で書き、Gitmoji と Conventional Commits style prefix を組み合わせます。

## Format

```text
<gitmoji> <type>(<scope>): <summary>
```

scope は任意です。

```text
<gitmoji> <type>: <summary>
```

例:

```text
✨ feat(scanner): parse @doc annotations
🐛 fix(resolver): report missing Markdown anchors
📝 docs: document commit rules
```

## Rules

- コミットメッセージは英語で書きます。
- subject の先頭に Gitmoji を 1 つ付けます。
- Gitmoji の後に Conventional Commits の type を付けます。
- summary は命令形で簡潔に書き、可能なら 72 文字以内にします。
- 変更範囲が明確になる場合は scope を使います。
- summary の末尾にピリオドは付けません。
- 無関係な変更は別コミットに分けます。

## Types

- `feat`: ユーザー向け機能、または新しい capability
- `fix`: bug fix
- `docs`: ドキュメントのみの変更
- `style`: 振る舞いに影響しない formatting や style 変更
- `refactor`: 機能追加や bug fix ではないコード整理
- `perf`: performance improvement
- `test`: test 追加、または test のみの変更
- `build`: build system、package、dependency の変更
- `ci`: CI configuration や workflow の変更
- `chore`: 他の type に当てはまらない maintenance
- `revert`: 以前の commit の revert

## Gitmoji

まずは最小限の Gitmoji set を使います。

- `✨` for `feat`
- `🐛` for `fix`
- `📝` for `docs`
- `✅` for `test`
- `♻️` for `refactor`
- `⚡️` for `perf`
- `💄` for `style`
- `👷` for `ci`
- `📦` for `build`
- `🔧` for `chore`
- `⏪` for `revert`

新しさより一貫性を優先します。既存 set で変更内容を表せない場合だけ Gitmoji を追加します。

## Body

subject だけでは理由、tradeoff、migration detail が明らかでない場合は body を書きます。

```text
✨ feat(scanner): parse exported function docs

Read JSDoc comments attached to top-level exported functions and collect
@doc targets for resolver input.
```

## Breaking Changes

breaking change では type または scope の後に `!` を付け、`BREAKING CHANGE:` footer を書きます。

```text
💥 feat(cli)!: change JSON output shape

BREAKING CHANGE: check --json now returns an object instead of an array.
```
