# テスト規約

> この翻訳は部分的で、テストの配置と共有ヘルパーだけを扱います。型検査、scanner
> worker のテスト、conformance fixture、examples、self-audit を含む最新の規約は
> 英語版の [Testing Convention](../../contributing/testing.md) が正です。

DocBridge は Bun のテストランナー(`bun test`、ラッパーは `just test`)を
使用します。

## テストの配置

- テストは対象モジュールと同じディレクトリにコロケーションします。
  `src/link/graph.ts` のテストは同階層の `src/link/graph.test.ts` です。
- トップレベルの `test/` ディレクトリは存在しません。新たに作らないで
  ください。
- テストファイル名は `<module>.test.ts` とします。ランナーが自動検出する
  ため、テストパスを列挙する設定はありません。

## 共有テストヘルパー

- 複数のテストファイルで共有するヘルパーは、`.test` サフィックスを付けずに
  テストの隣に置きます。これによりランナーがスイートとして実行することは
  ありません。例: `src/lsp/fixtures.ts`。

## 補足

- コロケーションしたテストファイルが `dist/` に混入することはありません。
  `bun build` は CLI エントリポイント(`src/cli/index.ts`)起点で、import
  されたものだけをバンドルします。
- ロジック変更はテストファーストで行います(`tdd` スキルを参照)。
