# 業務ファイル健診

Microsoft Excel のブック（`.xlsx` / `.xlsm`）を診断する、**通信を一切行わない単一HTMLツール**です。
外部ブック参照・壊れた数式・非表示シート・個人情報らしき列・VBA の構成などを検出し、
信号機（赤・黄・緑）で報告します。診断のみで、ファイルの修正は行いません。

## 特徴

- **完全オフライン / 単一ファイル** — 成果物は `dist/index.html` 1つ。`file://` で開いて動きます
- **通信の機械的禁止** — CSP で `connect-src 'none'` などを指定しています。`<head>` 先頭の `<meta>` で確認できます
- **何も保存しない** — `localStorage` / Cookie / IndexedDB を使いません。ファイルの内容はメモリ上だけで処理し、タブを閉じると消えます
- **レポートに元データを含めない** — セル値・シート内の文字列・ファイルパスは出力しません（自動テストで検証）
- 解析は Web Worker 上で実行します（50MB / 30シートで約10〜16秒）

## 使い方

Node 22 以上が必要です。

```sh
npm install
npm run build        # dist/index.html を生成（成果物検査まで自動実行）
```

`dist/index.html` をブラウザで開き、診断したいブックをドラッグ＆ドロップします。

| 用途 | コマンド |
|---|---|
| 開発サーバ | `npm run dev` |
| 型検査 | `npm run typecheck` |
| テスト | `npm test` |
| 成果物検査のみ | `npm run verify` |
| 実ブラウザでの通し確認 | `npm run browser-check` / `npm run firefox-check` |

## 診断しないもの

- Access（`.accdb` / `.mdb`）は解析しません
- VBA は構成とソースの静的解析までで、実行はしません
- 個人情報の検出は「可能性があります」の表現にとどめ、断定しません

## 設計資料

- 仕様: [HANDOFF-legacy-asset-scanner.md](HANDOFF-legacy-asset-scanner.md)
- 実装計画と実測記録: [docs/plan-phase1.md](docs/plan-phase1.md) / [docs/plan-phase2.md](docs/plan-phase2.md)
- コントリビューター向けの制約（C-1〜C-5）: [CLAUDE.md](CLAUDE.md)

`npm run build` の成果物検査（`scripts/verify-artifact.mjs`）は、外部URL・通信API・ストレージ API の混入を
ビルド出力から機械的に確認します。この検査を緩める変更は受け付けません。

## 免責

診断結果は、ファイルの構造から機械的に読み取れる事実と、それに基づく推定です。
ファイルの正しさや安全性を保証するものではありません。

## ライセンス

[MIT](LICENSE) © 2026 keiru

同梱する依存ライブラリ（SheetJS Community Edition: Apache-2.0、fflate: MIT）のライセンス表記は、
ツール画面の「このツールについて」に出力されます。
