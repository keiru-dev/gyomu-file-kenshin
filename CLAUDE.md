# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**製品名は「業務ファイル健診」**（2026-08-16 決定。J-PlatPat 確認済み）。リポジトリ名は `gyomu-file-kenshin`（旧作業名 `legacy-asset-scanner`。引き継ぎ書にはこの名前が残っている）。

- **「レガシー」を顧客向けの文言に使わないこと。** 対象を古い・負債と決めつける語で、引き継ぎ書 §6.2 の「責めない」に反する
- **製品名・ファイル名・ドメイン名に「Excel」を含めないこと。** Microsoft の Trademark and Brand Guidelines が禁じている。「Microsoft Excel のブックを診断します」のような**説明文での言及は許容される**ので、対象は説明側で伝える
- **名前を提案するときは、まず不採用の記録（引き継ぎ書 §9）を見ること。**「Excelドック」「ブックカルテ」「ブックドック」は検討済み
- **Access（.accdb / .mdb）は解析しない。** 有償診断への導線にする（§8 R-2 の選択肢B・2026-08-16 決定）。ただし「非対応」で終わらせず、相談の導線を出す実装になっている
- **★ MIT ライセンスで GitHub に無料公開する**（2026-09-30 方針転換。リポジトリ直下の `LICENSE`）。有償診断・ココナラ出品・申し込み用LPの構想は取りやめ、事業運営ドキュメントは公開リポジトリから外した。**C-1 / C-2 は緩めない** — 公開した今は「誰でもソースで通信しないことを検証できる」ことがそのまま価値になる
- **「ツールは通信しない」と「改変版は保証外」は分けて説明すること。** MIT で改変・再配布が自由になったため、通信機能を足した改変版が出回りうる。保証はこの配布物の CSP とソースに対するもので、[src/report/branding.ts](src/report/branding.ts) の `TERMS` がそれを断っている
- **外部URLを含まない版は維持する。** `CONTACT_URL=none` でビルドすると URL を一切埋め込まない版ができ、`verify-artifact` も**外部URLが1件も無いこと**を確かめる側に切り替わる。フォーク先が自分の問い合わせ先に差し替える用途にも使える

## このリポジトリの現状（最終更新 2026-09-30）

**Phase 1 完了。Phase 2 完了（一括スキャン / VBA構成 / VBAソース抽出と静的解析）。** 運用は Phase 1（承認付き書き込み）。テスト611件パス。

**2026-09-30 に MIT ライセンスでの無料公開へ転換し、申し込み用LP（`site/`）を削除した。** 公開用の README は [README.md](README.md)。**GitHub の private → public 切替は未実施**（公開前に git 履歴に事業情報が残っていないか確認すること）。

- 仕様は [HANDOFF-legacy-asset-scanner.md](HANDOFF-legacy-asset-scanner.md)。**作業前に必ず通読すること。** 本ファイルはその §2（絶対制約）と §7（禁止事項）を転記したもので、検出ルール一覧・UI仕様・JSONスキーマの詳細は引き継ぎ書側にある
- 実装指示書は [docs/plan-phase1.md](docs/plan-phase1.md) と [docs/plan-phase2.md](docs/plan-phase2.md)。**M0 / M1 の実測結果と、踏んだ罠の記録は [docs/plan-phase1.md](docs/plan-phase1.md) にある。読まずに足場やフィクスチャを触らないこと**。これらの docs には旧・有償診断運用への言及が残っている箇所があるが、現行の方針は本ファイルが優先する
- 実装済み: 足場一式 / [scripts/verify-artifact.mjs](scripts/verify-artifact.mjs) / `vendor/xlsx-0.20.3.tgz` / [src/worker/xml.ts](src/worker/xml.ts)（Worker で動く自前 XML リーダー）/ [src/worker/container.ts](src/worker/container.ts)（L1）/ [src/worker/cells.ts](src/worker/cells.ts)（L2）/ [src/rules/](src/rules/)（Phase 1 全17ルール + INFO）/ [src/analysis.ts](src/analysis.ts)（通し実行）/ [src/worker/analyze.ts](src/worker/analyze.ts) + [client.ts](src/worker/client.ts)（Worker 配線）/ [fixtures/](fixtures/)（Phase 1 全17ルールの検出・非検出フィクスチャ 35件）/ [tests/](tests/)
- UI・レポート出力まで実装済み（[src/main.ts](src/main.ts) / [src/report/](src/report/) / [src/styles/](src/styles/)）
- **レポートの「確認した項目」は [src/rules/checklist.ts](src/rules/checklist.ts) が登録済みルールから組み立てる。固定の一覧を書かないこと**（実態とずれると「やっていないことをやったと書く」ことになる）。検出ルールには `check`（区分と文言）が必須で、[tests/checklist.test.ts](tests/checklist.test.ts) が書き忘れを機械的に弾く。区分は6観点（旧LPと同じ並び）
- **50MB / 30シートを 9.6〜16.4 秒**で解析（目標30秒以内）。通信を遮断した状態での通し動作も確認済み
- **ブラウザ確認済み:** Chrome 151 / Edge 151 / Firefox 153 を自動実測（`npm run browser-check` / `BROWSER=edge` / `npm run firefox-check`）、Safari は目視確認。**引き継ぎ書 §10 の完了条件をすべて充足**
- **L2 は2行目以降のセル値を保持しない。** 数式文字列は保持するが Finding に載せてはならない（顧客由来の文字列リテラルが埋まっていることがあるため）。詳細は [docs/plan-phase1.md](docs/plan-phase1.md) の M3
- **`DOMParser` は使わない。** Worker に存在しないことを実測済み（[docs/plan-phase1.md](docs/plan-phase1.md) の R-E）。XML の読み取りは [src/worker/xml.ts](src/worker/xml.ts) を使うこと

**検出ルールは、対象フィクスチャが無い状態では書かない**（引き継ぎ書の指示）。Phase 1 の全17ルールのフィクスチャは M1 で揃っているので、M4 以降はこの制約に抵触しない。

### コマンド

| 用途 | コマンド |
|---|---|
| 開発サーバ | `npm run dev` |
| ビルド（`verify` まで自動実行） | `npm run build` |
| 成果物検査のみ | `npm run verify` |
| 型検査 | `npm run typecheck` |
| テスト | `npm test` / 単体は `npx vitest run <パス>` |
| フィクスチャを `fixtures/out/` に書き出し | `npm run fixtures` |
| 配布用ファイルの作成 | `npm run dist` |
| 外部URLを含まない版のビルド | `CONTACT_URL=none npm run dist` |
| 閾値見直しのための分布計測 | `npm run calibrate -- <フォルダ>` |
| 実ブラウザ（file:// / 通信遮断）での通し確認 | `npm run browser-check`（Edge は `BROWSER=edge`、一括は `BATCH=1`） |
| Firefox での確認（BiDi・別実装） | `npm run firefox-check` |
| デモ用サンプルの生成 | `npm run demo` |
| 性能計測（大きなブックを生成して測る） | `npm run perf -- 30 20000 10` |

**型検査は tsconfig を2つ通す。** `tsconfig.json` はブラウザ側（`src/`）専用で `"types": []` により `@types/node` を締め出している。ここに Node のグローバルが見えると C-1 違反を型検査が見逃すため、この分離を崩さないこと。Node 上でだけ動くコード（`fixtures/` `tests/` `vite.config.ts`）は `tsconfig.node.json`。

`npm run build` は必ず [scripts/verify-artifact.mjs](scripts/verify-artifact.mjs) を通る。**この検査を緩めて通すことは禁止**（C-1〜C-3 と ★DOM挿入対策の最後の砦）。

### 足場で触ってはいけない設定

いずれも `http://localhost` では露見せず、`file://` でのみ壊れる。詳細と実測記録は [docs/plan-phase1.md](docs/plan-phase1.md) の R-A / R-D。

- `vite-plugin-singlefile` の `removeViteModuleLoader` を `true` にしない（アプリ本体が丸ごと消える）
- 出力は IIFE 固定。script タグは `</body>` 直前（`type="module"` を外すと暗黙の `defer` も失われるため）
- `vite.config.ts` の HTML 後処理で `String.replace()` に置換**文字列**を渡さない（`$&` / `` $` `` が解釈されバンドルが壊れる）

### 公開方針

**難読化しない。** 誰でも grep で検証できることがこのツールの価値であり、難読化はそれを自ら壊す。最小化は grep 可能性を壊さないので現状のままでよい。

**利用条件に「解析を制限する文言」を入れてはならない。** ライセンスは MIT。改変版の配布禁止や文言転用の禁止は MIT と矛盾するため置かない（テストが `TERMS` を検査している）。

配布経路ごとに `DIST_TAG=xxx npm run build` でビルドIDにタグを付けられる。

### 開発環境

**Node 22 LTS を使う**（2026-08-17 更新。Homebrew の `node@22`）。

- 切り替えたのは、当時の LP（`site/`・削除済み）が使う Astro 7 が Node 22 以上を要求したため
- ツール本体は Node 20 / 22 のどちらでも動く（更新前後の両方で全テスト・実ブラウザ確認済み）
- `node@20` は Homebrew に残してあるので、必要なら `brew unlink node@22 && brew link node@20` で戻せる
- 検証スクリプトの `--experimental-websocket` は Node 22 では不要だが、Node 20 でも動くよう残してある

### バージョン管理

`https://github.com/keiru-dev/gyomu-file-kenshin`。default branch は `main`。

2026-09-30 に、旧リポジトリ（`uulab14/legacy-asset-scanner`・非公開）から**履歴なしの新規リポジトリとして出し直した。** 旧履歴には価格・NDA・運用方針などの事業情報が含まれていたため。**旧履歴を公開リポジトリに持ち込まないこと。**

コミットの author は `keiru-dev`（GitHub の noreply メール）を使う。実メールを含むコミットは、メール保護設定によりプッシュが拒否される。

## 絶対制約（違反した実装は無条件でリジェクト）

### C-1. 完全オフライン / 単一ファイル

- 成果物は `.html` **1ファイルのみ**。外部CSS・外部JS・外部フォント・CDN参照を一切含まない
- ビルド後のファイルをネットワーク未接続のPCにコピーして、ダブルクリックで完全動作すること
- `file://` プロトコルで動作すること（ローカルサーバ不要）

### C-2. 通信の機械的禁止

以下の CSP を `<head>` 先頭に必ず含めること。

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               script-src 'unsafe-inline';
               worker-src blob:;
               style-src 'unsafe-inline';
               img-src data:;
               font-src data:;
               connect-src 'none';
               form-action 'none';
               base-uri 'none';">
```

**これは単なる安全策ではなく、顧客の情シスに提示できる検証可能な証拠である。**「通信しません」という口約束ではなく、「CSPで機械的に禁止しています。ソースをご確認ください」と言えることに価値がある。`connect-src 'none'` を緩めてはならない。

**`worker-src blob:` は引き継ぎ書 §2 C-2 の原文に対する唯一の追加**（2026-08-09 開発者承認）。CSP3 の Worker 取得は `worker-src` → `child-src` → `script-src` → `default-src` とフォールバックし、原文には前2つが無いため `script-src 'unsafe-inline'` に落ちる。`'unsafe-inline'` は `blob:` を許可しないため、引き継ぎ書 §4.3 が必須とする Blob URL 製 Worker が起動できなかった（Chrome 151 で実測。[docs/plan-phase1.md](docs/plan-phase1.md) の R-B）。この1行が許すのは「自分で生成したメモリ上のコードをワーカーとして起動すること」だけで、ネットワークアクセスは増えない。

**これ以上ディレクティブを足さないこと。** 追加が必要に思えたら、まず実装側を疑う。

### C-3. データの非永続化

- `localStorage` / `sessionStorage` / `IndexedDB` / Cookie を一切使わない
- 読み込んだファイルの内容はメモリ上のみで処理し、タブを閉じたら消える
- ユーザーが明示的に「レポート保存」を押したときのみ、ローカルにファイルを書き出す

### C-4. 守秘義務由来の制約 ★最重要

- **開発者の勤務先に由来する業務知見・データ構造・命名規則・業種特有の用語を、コード・コメント・サンプルデータ・テストフィクスチャ・ドキュメントのいずれにも含めてはならない**
- テスト用のサンプルファイルは、**すべて架空の事業体を想定してゼロから生成すること**
- 検出ロジックは「特定企業の事例」ではなく「一般的な設計欠陥の類型」として実装・記述する
- 判断に迷う記述があれば、実装せずに引き継ぎ書 §9 の未決事項に追記して開発者に確認を上げること

### C-5. 依存関係の最小化

- 実行時の外部依存はゼロ（すべてインライン化）
- ビルド時の依存は必要最小限。ライセンスは MIT / Apache-2.0 / BSD 系のみ許容。**GPL系は不可**（顧客への再配布が発生するため）
- 使用ライブラリのライセンス表記を、成果物内の「このツールについて」に含めること

## やってはいけないこと

1. **通信を行う機能を追加しない** — 解析ライブラリのCDN読み込み、フォント取得、エラー送信、アナリティクス、すべて禁止
2. **元データの内容を出力に含めない** — セル値、シート内の文字列、ファイルパスをレポートやJSONに書き出さない
3. **勤務先由来の情報を混入させない** — C-4 参照。サンプルデータは必ず架空
4. **修正機能を作らない** — 診断のみ。修正はビジネス上、有償フェーズの商品
5. **煽り文言を入れない** — 「今すぐ対処しないと重大な損失が」等。検出事実と想定される影響のみを書く
6. **断定しない** — 特に個人情報検出は「可能性があります」にとどめる
7. **未検証の技術を「できます」と書かない** — 引き継ぎ書 §8 参照

## ★ 未信頼データのDOM挿入（引き継ぎ書に無い追加制約）

**顧客のExcelファイルは未信頼入力である。** シート名・列ヘッダ名・名前定義名・作成者名・外部リンクのパスをレポートに描画する以上、細工されたファイルによる XSS が成立しうる。

- **C-2 の CSP はこれを止めない。** `script-src 'unsafe-inline'` を許可しているため、インラインで注入されたスクリプトは実行される。CSP が保証するのは「外へ出さない」ことだけで、「中で実行させない」ことではない
- `file://` で開かれる単一HTMLなので、成立すればローカルファイル読み取りの足がかりになりうる
- **ファイル由来の文字列を DOM に入れるときは必ず `textContent` / `createElement` / `setAttribute` を使う。`innerHTML` / `insertAdjacentHTML` / `outerHTML` を使わない**（lint で禁止するのが望ましい）
- レポート保存時に生成するHTMLでも同様。文字列連結でHTMLを組み立てる箇所は必ずエスケープする

出典: devkit [docs/security-checklist.md](../keiru-devkit/docs/security-checklist.md) §5。営業上、情シスに「CSPで通信を機械的に禁止しています」と説明する製品でXSSが出るのは致命的なので、優先度を落とさないこと。

## アーキテクチャの要点

### 二層読み取り（この設計を崩さない）

`.xlsx` / `.xlsm` の実体は ZIP アーカイブ。目的別に2経路を使い分ける。

| 層 | 手段 | 取得対象 |
|---|---|---|
| L1: コンテナ層 | `fflate` で必要パートのみ解凍 → [src/worker/xml.ts](src/worker/xml.ts) で内部XMLを直接パース | 外部リンク定義、接続定義、名前定義、シート属性、シート保護、結合セル数、ドキュメントプロパティ、ピボットキャッシュ、VBAバイナリの有無 |
| L2: セル層 | SheetJS (`xlsx`, community edition) | 数式文字列、エラー種別、使用範囲、1行目の列名 |

**引き継ぎ書 §4.1 は L1 に `DOMParser` を挙げているが、これは使えない**（Worker に存在しない。R-E で実測）。代わりに自前の `src/worker/xml.ts` を使う。

**外部ブック参照・外部データ接続・非表示シート属性・作成者メタデータは L1 で直接読むこと**（`xl/externalLinks/`, `xl/connections.xml`, `xl/workbook.xml`, `docProps/core.xml`）。SheetJS だけで済ませようとすると取りこぼす／検出精度が落ちる。

### 処理フロー

```
File入力(D&D or picker) → ArrayBuffer
  → ZIPシグネチャ(PK\x03\x04)判定
      ├ OK → L1: fflateで必要パートのみ解凍 → src/worker/xml.ts で解析
      │      L2: SheetJS read (dense: true, bookVBA: true)
      └ NG → 非対応形式として明示的にエラー表示
  → 検出ルール群を順次適用 → Finding[] を蓄積
  → 重大度で集計 → レポート描画
```

### 解析は必ず Web Worker で

現場のExcelは100MB超が普通。単一HTML内での Worker 起動は `Blob` + `URL.createObjectURL` で行う（外部 worker ファイルは C-1 違反）。進捗表示・中断ボタン必須。目標は 50MB / 30シートを30秒以内。

### 想定ディレクトリ構成

```
src/main.ts, src/worker/{analyze,container,cells}.ts,
src/rules/（1ファイル1ルール + types.ts）, src/report/, src/styles/
fixtures/generate.ts（架空データのみ・C-4厳守）, tests/, build/（単一HTMLインライン化）
```

ビルドは Vite + `vite-plugin-singlefile` 系、またはカスタムのインライン化スクリプト。

### 重大度モデルと Finding

`RED`（すでに壊れている/漏洩リスク）/ `YELLOW`（将来壊れる/属人化）/ `GREEN` / `INFO` の信号機式。ルール一覧と `Finding` の型定義は引き継ぎ書 §5 にある。

`Finding` の `title` / `detail` / `impact` は**非エンジニアが読む前提**。「循環参照」ではなく「計算が自分自身を参照しており、正しい値が出ない可能性があります」のように書く。表示ラベルに `CRITICAL`/`HIGH` 等の英語重大度を出さない（信号機のみ）。

トーン: 顧客担当者は「自分が作ったわけではないファイル」を診断される立場。責めない、煽らない、RED 0件なら素直に「問題は検出されませんでした」と出す。

## 実装前に検証が必要な項目（楽観視しない）

- **VBAソース抽出（Phase 2）**: `xl/vbaProject.bin` は OLE2 複合ドキュメント + 独自RLE圧縮（MS-OVBA）。展開しただけでは読めない。**実際に動くまで「対応済み」と書かない。** 難航したら「有無・モジュール数・おおよその規模」に縮小してよい
- **`.accdb`/`.mdb`（Phase 3）**: ブラウザ内解析の確立手段は未確認。有償診断への導線にする「選択肢B」が現実的な可能性が高い。着手前に開発者へ判断を上げること
- **循環参照の完全検出**: Phase 1 は `calcPr@iterate` の設定レベル検出（YELLOW）にとどめる。数式依存グラフの構築は過剰実装

## keiru-devkit 方針との関係

devkit（`~/Documents/aidev/keiru-devkit`）はグローバル CLAUDE.md 経由で全プロジェクトに効くが、**本プロジェクトは例外が多い**。以下の対応表で判断すること。

| devkit の既定 | 本プロジェクトでの扱い |
|---|---|
| TypeScript + React で統一 | TS は従う。**React は使わない** — 単一HTMLにバンドルする以上、素のDOMのほうが C-1/C-5 に適合する（引き継ぎ書も React を要求していない） |
| Cloudflare をハブに（Pages/Workers/D1/R2/KV） | **適用不可**（C-2 の `connect-src 'none'`）。LP は削除済み |
| 5つの成果物タイプ → 対応スキル | **どれにも当てはまらない**。`astro-site` / `nextjs-cloudflare` / `wxt-extension` 等を本体に使わない |
| セキュリティは認証/エッジ層でコストを払う | 認証もエッジも無い。**守りの実体は「そもそも送信しない」構造** + 上記のDOM挿入対策 |
| Clerk / Stripe / Supabase / D1 | 全て非該当 |

### security-checklist.md の適用範囲

出荷前に [docs/security-checklist.md](../keiru-devkit/docs/security-checklist.md) を読むのは devkit の必須要件。本プロジェクトでの該当・非該当は以下。

- **§1 シークレット** — ほぼ非該当（秘密が無い）。ただし**「ビルド出力を grep する」手法は流用する** → 外部URL・`fetch` / `XMLHttpRequest` / `localStorage` / CDN参照 の混入検査に読み替え、C-1〜C-3 の自動検証にする
- **§2 データ層 / §3 認証 / §4 決済 / §8 モバイル** — 非該当
- **§5 ブラウザ拡張** — **実質該当**。「リモートコードなし・CSP維持」と「`innerHTML` に未信頼データを入れない」の2項目（前述の★節）
- **§6 エッジ/ネットワーク** — 非該当（LP 削除済み）
- **§7 CI** — 該当。`npm audit`（high/critical をブロック）/ Dependabot / Secret Scanning / SAST

### 進め方（team-governance.md）

- **Phase 0（読み取り専用）から始める。** `keiru-devkit/.claude/profiles/team-readonly.settings.json` を本プロジェクトの `.claude/settings.local.json` にコピーし、`planner`（計画）→ **人間承認** → `implementer`（唯一の書き手）→ `reviewer` / `security-auditor` / `fact-checker`（評価）で回す
- **事実の主張には出典（`file:行` か URL）を付ける。確認できないことは「未確認」と明記し、それらしい作り話で埋めない。** これは引き継ぎ書 §8（VBA抽出・Access対応を「動くまで対応済みと書かない」）と同じ要求
- `guard-scope.mjs` がプロジェクト外パスへのアクセスを拒否する。devkit を参照する必要が出たら `~/.claude/keiru-team/allowed-paths` に追記済み（2026-08-09）

### ブランディング / 法務

keiru 帰属の横断規約に従い、成果物内の「このツールについて」に `© <発行年> keiru`（**年はビルド時に自動出力。手書きの固定値にしない**）とライセンス表記（C-5）を入れる。

問い合わせ導線は devkit 規約により **keiru ポートフォリオサイトのお問い合わせフォーム**に一本化する（サービス個別の連絡先を新設しない）。

**実装方針（2026-08-09 開発者判断で確定）: クリック可能な `<a>` リンクにする。** 引き継ぎ書 §9 の当該項目はこれで解決済み（残る未決は URL 実体と文言）。

実装上の注意:

- CSP は**リンク遷移をブロックしない**。`default-src 'none'` が禁じるのはリソース取得であり、ユーザー操作によるナビゲーションは対象外（`form-action 'none'` はフォーム送信のみを止める）。したがって C-2 との衝突は無い
- ただし**「このファイルは自動通信を一切しない。外部へ出るのはユーザーが明示的にリンクを押したときだけ」**と、情シス向け説明で明確に区別して書く。ここを曖昧にすると CSP を示す信頼性が損なわれる
- `target="_blank"` を付けるなら `rel="noopener"` は必須。ただし `noreferrer` を付けると**リファラが消えて流入元が追えなくなる** — 本ツールはファネル最上段のリード獲得装置（引き継ぎ書 §1.1）なので、遷移先URLに固定の識別子（例: `?from=scanner`）を持たせて計測する。**顧客データやファイル情報をクエリに載せてはならない**（C-2/§7-2）

## Phase 1 完了の定義

引き継ぎ書 §10 のチェックリスト全項目。特に自動テストで保証すべきもの:

- 各ルールについて、架空フィクスチャで**検出・非検出の両方**を検証
- **レポート・JSON に元データのセル値が一切含まれない**ことをテストで保証
