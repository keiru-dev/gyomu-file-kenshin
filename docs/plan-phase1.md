# Phase 1 実装指示書

- 起票: 2026-08-09
- 承認: 2026-08-09（開発者承認済み。これに伴い `.claude/settings.local.json` を Phase 0 → Phase 1 へ移行）
- 対象: 引き継ぎ書 §3 Phase 1（`.xlsx` / `.xlsm`）
- 前提: [../CLAUDE.md](../CLAUDE.md) の絶対制約（C-1〜C-5）・禁止事項・★DOM挿入対策

進め方は keiru-devkit の作法に従い、**各マイルストーンの終わりで確認を取る**。指示書に無いことはやらない。

---

## 承認済みの決定事項

### 暫定閾値（2026-08-09 承認）

`src/rules/thresholds.ts` に集約する。**実データでの調整待ちである旨をコード内にコメントで明示すること。**

| ルール | 暫定閾値 |
|---|---|
| `MERGED_CELL_HEAVY` | 結合セル数 ≥ 50 / シート |
| `FORMULA_DEEP_NEST` | 数式のネスト深度 ≥ 7 |
| `VOLATILE_FUNCTION` | 揮発性関数を含むセル ≥ 100 または全数式セルの 10% |
| `AUTHOR_SINGLE_LEGACY` | 作成者＝最終更新者 かつ 最終更新から 730日以上 |

`PIVOT_CACHE_STALE` の閾値は **「最終更新から730日以上」または「レコード数 100,000 以上」**（2026-08-16 承認）。他の4件と同じく実データでの調整待ちの暫定値。

### 実装スタック

- TypeScript + Vite（`vite-plugin-singlefile` 系）+ Vitest
- **React は使わない。** 素の TS + DOM（C-1 / C-5 適合。引き継ぎ書も React を要求していない）
- ZIP: `fflate` / XML: ブラウザ標準 `DOMParser` / セル: SheetJS community edition

---

## ★ 先に潰す技術リスク（M0 で実物検証）

引き継ぎ書 §8 には記載が無いが、Phase 1 を丸ごと破壊しうるもの。**憶測で「対応済み」と書かない。**

### R-A. ES モジュールは `file://` で動かない — **解決済み（2026-08-09 実測）**

Vite の既定出力は `<script type="module">`。モジュールスクリプトは CORS の対象で `file://` は不透明オリジンのため読み込みに失敗する。`http://localhost` では完全に動作し、**ダブルクリックしたときだけ白画面**になる — C-1 の完了条件を直撃する、最も気づきにくい失敗。

対策として Rollup 出力を `format: 'iife'` + `inlineDynamicImports: true` に固定したうえで、以下3点を実装（[vite.config.ts](../vite.config.ts)）。**いずれも実測で踏んだ罠であり、外すと再発する。**

1. `<script type="module" crossorigin>` の属性を除去し古典スクリプトにする。IIFE 指定だけでは Vite はモジュール属性を付けて出力する
2. **`removeViteModuleLoader: true` にしない。** IIFE 出力をローダー shim と誤認してアプリ本体を丸ごと削除し、空の `<script></script>` を出力する
3. **script タグを `</body>` 直前へ移す。** `type="module"` には暗黙の `defer` があり、属性を外すだけだと `<head>` 内で body 生成前に実行され DOM 取得が null になって即例外。インラインの classic script に `defer` は効かないため、配置で解決するしかない

判定結果: **PASS**（`file://` でスクリプトが実行されることを確認）。

### R-B. Blob URL 製 Worker — **原因確定（2026-08-09 実測）。CSP の変更判断待ち**

`file://` オリジンではなく **C-2 の CSP 自体がブロックしていた。**

CSP3 の Worker 取得は `worker-src` → `child-src` → `script-src` → `default-src` の順にフォールバックする。C-2 の CSP には `worker-src` も `child-src` も無く、`script-src` は `'unsafe-inline'` のみ。`'unsafe-inline'` は `blob:` を許可しないため Worker 生成が拒否される。

実測（Google Chrome 151.0.7922.108 / macOS 26.5.1 / headless / `file://`）:

| 変種 | CSP | R-A | R-B |
|---|---|---|---|
| A | C-2 の指定どおり | PASS | **FAIL**（Worker がエラー） |
| B | A に `worker-src blob:` のみ追加 | PASS | **PASS**（Worker が応答） |

- 差分は `worker-src blob:` の1ディレクティブのみ。**`connect-src 'none'` は不変**なので通信禁止の保証と情シスへの説明は変わらない
- **未確認: Firefox / Safari / Edge での挙動**（当該環境に Firefox 未インストール）。Chrome 系以外は測っていないため「全ブラウザで動く」とは書かない
- 採用しない場合のフォールバック: メインスレッドでの分割処理（一定単位ごとに `await new Promise(r => setTimeout(r))` で UI に制御を返す）。性能要件は満たせるが**中断ボタンの応答性が落ちる**

再現手順: `npm run build` 後、`scratchpad/run-check.mjs` 相当で dist/index.html の CSP を差し替えて headless Chrome の `--dump-dom` で判定行を読む。

### R-C. SheetJS の入手経路とライセンス — **解決済み（2026-08-09 実測）**

npm の `xlsx` は **0.18.5 で停止**（非 deprecated、Apache-2.0）。以降は SheetJS 自社 CDN 配布に移行しており、**CDN の最新は 0.20.3**（Apache-2.0、実行時依存ゼロ、`browser` フィールドで Node 組み込みを無効化済み）。npm を離れた理由は publish トークン失効・2FA 強制と SheetJS LLC / npm, Inc. の係争とされる。

採用: **案1（vendoring）を開発者承認**。`vendor/xlsx-0.20.3.tgz` をリポジトリに取り込み `file:` 参照でインストールする。年間保守契約を伴う商品である以上、CDN 消滅後も再ビルドできることを優先した。

- sha256: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- ライセンスファイルは tarball 内に同梱（`package/LICENSE`）。**C-5 のライセンス表記義務は M6 の「このツールについて」で果たすこと**
- 併用: `fflate` 0.8.3 (MIT) / `vite-plugin-singlefile` 2.3.3 (MIT)

### R-D. 解析ライブラリを同梱しても単一HTML化と検査が通るか — **解決済み（2026-08-09 実測）**

M3 まで進んでから発覚すると痛いので M0 で前倒し検証した。結果、**2件の問題を先取りできた**。

1. **OOXML 名前空間 URI の誤検知。** SheetJS のバンドルには `http://schemas.openxmlformats.org/...` 等の名前空間識別子が36件含まれる。これらは取得先ではなく識別子であり、HTML属性・CSS `url()` には1件も現れない。`verify-artifact.mjs` を「名前空間ホストは許可」＋「属性 / `url()` の外部URLは常に違反」の2段構えに精密化した
2. **`String.replace()` の `$` 特殊シーケンス。** `vite.config.ts` の後処理で置換文字列を渡していたため、バンドル内の `$&` / `` $` `` が置換されコードが破損し、`Uncaught SyntaxError: Invalid regular expression: missing /` になった。**置換はコールバックで渡すこと**

判定結果: **PASS**。自作の最小 xlsx（生の OOXML を fflate で ZIP 化）を SheetJS が解析しシート名を取得できることを確認済み。**引き継ぎ書 §4.1 の二層読み取りが成立することの最小の証拠**でもある。成果物サイズは約 373 KB。

---

### R-E. Worker に `DOMParser` が無い — **実測で確定（2026-08-09）。M2 着手前に方式決定が必要**

引き継ぎ書 §4.1 は L1 の XML 解析に `DOMParser` を推奨するが、§4.3 は解析を Web Worker で行うことを必須とする。**この2つは両立しない。**

実測（Chrome 151 / `file://` / Blob URL 製 Worker）:

| スコープ | `DOMParser` | `document` | `TextDecoder` |
|---|---|---|---|
| メインスレッド | `function` | あり | `function` |
| **Worker** | **`undefined`** | **`undefined`** | `function` |

`DOMParser` は Window 専用インターフェースであり、Worker には DOM が無い。

**方式の選択肢:**

- **案A（推奨）: Worker 内で動く自前の軽量 XML リーダーを実装する。** L1 が必要とするのは属性値の取り出しと要素の列挙だけ（`sheet@name/@state`、`definedNames`、`calcPr@iterate/@calcMode`、`Relationship@Target`、`connections`、`docProps` の値）で、汎用 XML 解析は要らない。依存ゼロで C-5 に最も適合し、バンドルも増えず、§4.3 を守れる。**副次効果として、テストに jsdom / happy-dom が不要になる**（XML 文字列を直接検査できるため）。リスクは自前実装のバグと、未信頼入力ゆえのエスケープ処理（`&amp;` 等）の取りこぼし
- 案B: 小さな XML パーサライブラリ（`fast-xml-parser` 等、MIT）を追加する。実装リスクは下がるが依存が1つ増え、バンドルも増える
- 案C: L1 だけメインスレッドで `DOMParser` を使う。§4.3 に反する。L1 の対象XMLは小さいものが多いが、`xl/worksheets/*.xml`（`sheetProtection` 検出）は大きくなりうるため UI が固まるリスクが残る

**採用: 案A（2026-08-09 開発者承認）。** `src/worker/xml.ts` に自前の軽量 XML リーダーを実装する。

実装上の必須要件:

- **正規表現のバックトラッキングに依存しない**こと（未信頼入力による ReDoS を避けるため、インデックス走査で書く）
- 属性値の中に `>` が現れても正しくタグ終端を見つけること（XML では合法）
- `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` と数値文字参照を復号すること。**未知の実体は展開せず、そのまま残す**
- `<!DOCTYPE>` の内部サブセットで宣言された実体を**決して展開しない**（XXE / billion laughs への構造的な耐性。外部実体の取得は CSP でも止まるが、そもそも解決しない設計にする）
- コメント / 処理命令 / CDATA を正しく読み飛ばす・取り込むこと

**実装済み（2026-08-09）: [../src/worker/xml.ts](../src/worker/xml.ts)。テスト18件パス**（[../tests/worker/xml.test.ts](../tests/worker/xml.test.ts)）。上記要件はすべてテストで裏付けてある。特に:

- `<!DOCTYPE root [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>` を与えても `&xxe;` は展開されず文字列のまま残ることを検証済み
- 深さ 20,000 の入れ子を処理してもスタックが溢れないことを検証済み（再帰を使っていないことの裏付け）
- 属性値内の `>`、長大な実体らしき文字列、閉じられていないタグでも破綻しないことを検証済み

**未検証: 実際の Worker スコープでの実行。** 本リーダーは DOM API を一切使わない（`String` / `Map` / `Set` / ジェネレータのみ）ため動作するはずだが、**実測していないので「Worker で動く」とは書かない**。M5 で Worker を配線する際に実機で確認すること。

## マイルストーン

### M0: 足場 + リスク検証

- `package.json` / TypeScript / Vite / Vitest
- R-A / R-B / R-C を実物で検証
- **`scripts/verify-artifact.mjs`** — ビルド成果物を検査して C-1〜C-3 を機械的に保証する。devkit `docs/security-checklist.md` §1「ビルド出力を grep する」手法の読み替え:
  - `http://` / `https://` / `//cdn` 参照が無い（問い合わせリンク1本のみ許可リスト方式）
  - `fetch(` / `XMLHttpRequest` / `navigator.sendBeacon` / `EventSource` / `WebSocket` が無い
  - `localStorage` / `sessionStorage` / `indexedDB` / `document.cookie` が無い
  - CSP meta が C-2 と一字一句一致
  - `innerHTML` / `insertAdjacentHTML` / `outerHTML` が無い（★DOM挿入対策）
  - `npm run build` の一部として実行し、失敗したらビルドを落とす

**受け入れ条件: 空の成果物をネットワーク未接続でダブルクリックして動作し、`verify-artifact` が PASS。** これが通るまで M1 に進まない。

**→ 2026-08-09 達成。** R-A / R-B / R-C / R-D いずれも PASS、`tsc --noEmit` クリーン、`verify-artifact` PASS（成果物 約373KB）。measured: Google Chrome 151.0.7922.108 / macOS 26.5.1 / `file://`。**Firefox / Safari / Edge は未測定。**

M1 に進む前に `src/main.ts` の probe を本来の UI へ置き換えること。`buildMinimalXlsx()` は `fixtures/generate.ts` の土台として移設する。

### M1: フィクスチャ生成 — **完了（2026-08-09）**

Phase 1 の RED / YELLOW 全17ルールについて、検出用と非検出用のフィクスチャを対で用意した。**35ケース / テスト237件パス。**

- [../fixtures/ooxml.ts](../fixtures/ooxml.ts): 仕様から `.xlsx` / `.xlsm` を組み立てる。外部リンク・接続定義・名前定義・シート保護・結合セル・VBA・ピボットキャッシュ・計算設定に対応
- [../fixtures/cases/](../fixtures/cases/): ルール群ごとにファイルを分けたケース定義とレジストリ
- [../tests/fixtures/all-cases.test.ts](../tests/fixtures/all-cases.test.ts): 全ケース横断の健全性（SheetJS が読める / 再現性 / 必須パーツ / `r:id` の整合 / 番兵の存在）。**ケースを増やせば自動で網に掛かる**
- [../tests/fixtures/defects.test.ts](../tests/fixtures/defects.test.ts): 「検出用に意図した欠陥が実際に入っているか」を1ルールずつ確認。これが無いと、後段のルールテストが空振りでも緑になってしまう

実装上の注意（踏むと Excel / SheetJS が読めなくなる）:

- **OOXML のシーケンス制約を守ること。** workbook は `sheets` → `externalReferences` → `definedNames` → `calcPr` → `pivotCaches`、worksheet は `sheetData` → `sheetProtection` → `mergeCells`
- workbook.xml が参照する `r:id` は `workbook.xml.rels` の採番と必ず一致させる（all-cases テストで機械的に検証している）

**ダミーである旨の明示:** `xl/vbaProject.bin` は実在の VBA プロジェクト（OLE2 複合ドキュメント）ではなくダミーのバイト列。Phase 1 は有無しか見ないため十分だが、**Phase 2 で中身を解析するならここから作り直すこと。** シート保護の `password` 属性も、実在のパスワードから計算した値ではない見せかけの固定ハッシュ。


`fixtures/generate.ts`。**全て架空の事業体をゼロから生成**（C-4）。

申し送り: **フィクスチャ生成は解析より難しい可能性がある。** `#REF!` / 外部リンク / `connections.xml` / `veryHidden` / `sheetProtection` は SheetJS の書き出しでは作れないものが多く、生の OOXML パーツを組み立てて fflate で ZIP 化する必要が出る。M1 は見積もりが振れやすい区間。

- ルールごとに「検出されるべき」ファイルと「検出されるべきでない」正常ファイルを**対で**生成
- タイムスタンプは固定値（再現可能なテストのため）
- **番兵文字列**を各セルに埋め込む（例: `SENTINEL_CELL_VALUE_7F3A`）→ M7 の漏洩テストで使う

### M2: L1 コンテナ層 `src/worker/container.ts` — **完了（2026-08-09）**

`readContainer(bytes, onProgress?)` が `ContainerInfo` を返す。テスト58件（[../tests/worker/container.test.ts](../tests/worker/container.test.ts)）。**Phase 1 の全ルールが必要とする情報を、全35フィクスチャから取り出せることを確認済み。**

取得対象: シート名 / 表示状態 / シート保護（パスワード有無を区別）/ 結合セル数 / 名前定義 / `calcPr`（iterate・calcMode）/ 外部リンクの Target と TargetMode / 接続定義（接続文字列・command）/ docProps / ピボットキャッシュ / VBA の有無 / パート一覧 / 展開後サイズ。

設計上の要点:

- **ZIP を丸ごと展開しない。** fflate の `filter` で必要なパートだけを解凍し、シートXMLは1枚ずつ読んで捨てる。100MB級を想定した措置
- パート名を決め打ちせず、**`.rels` の Type 末尾セグメントから関係を解決**する（`officeDocument` / `worksheet` / `externalLink` / `externalLinkPath` / `connections` / `pivotCacheDefinition` / `core-properties`）。相対パス・`..`・先頭 `/` も解決する
- 接続文字列は `connection` の**子要素**（`dbPr` / `webPr`）にあるため、イベント走査で親子を対応付ける
- ZIP でない / workbook が無い場合は `UnsupportedFormatError`。旧 `.xls`（BIFF）を渡すと確実にここで止まることをテスト済み

**未対応（M7 の性能検証で確認すること）:** パートごとに `unzipSync` を呼ぶため、ZIP の中央ディレクトリをパート数ぶん走査する。シート数が多いブックで実測し、必要なら1回の走査でまとめて取り出す方式に変えること。

### M3: L2 セル層 `src/worker/cells.ts` — **完了（2026-08-09）**

`readCells(bytes, onProgress?)` が `WorkbookCells` を返す。SheetJS を `dense: true, bookVBA: true` で読む。テスト49件（[../tests/worker/cells.test.ts](../tests/worker/cells.test.ts)）。

**★ 何を保持し何を捨てるか（引き継ぎ書 §7-2 の要）**

この層は元データに最も近く、扱いを誤ると顧客のセル値がレポートに漏れる。保持するものを最小限に絞ってある。

| 保持する | 理由 |
|---|---|
| セル参照（`C15` 等） | 場所を示すのに必要。値ではない |
| エラー種別（`#REF!` 等） | Excel の固定語彙であり顧客データではない |
| 数式文字列 | ネスト深度・揮発性関数・列番号リテラルの判定に必要 |
| **1行目のテキストのみ** | 列名。引き継ぎ書 §5.4 が「列名と列位置のみ」を許可 |

**2行目以降のセル値は一切保持しない。** これがテストで担保されている（フィクスチャの番兵は必ず2行目以降に置く取り決めにしてあり、L2 の出力に番兵が現れないことを全35ケースで検証）。

**数式文字列は保持するがレポートに出してはならない。** 数式には `IF(A1="○○",...)` のように顧客由来の文字列リテラルが埋まっていることがある。`src/rules/` は数式を判定にのみ使い、Finding には ruleId とセル参照だけを載せること。

保持件数には上限を設けてある（数式20万件 / エラー5万件）。上限を超えた場合は `formulasTruncated` / `errorsTruncated` が立ち、**件数の集計は正確なまま**。黙って打ち切らない。

**実測で判明した罠:** 数式セルに計算結果のキャッシュ（`<v>`）が無いと、**SheetJS はそのセル自体を生成せず、数式が1件も読めない。** 実際の Excel は必ずキャッシュを書き込むため、フィクスチャ側を実ファイルに合わせて修正した。

### M4: ルールエンジン `src/rules/` — **完了（2026-08-09）**

Phase 1 の RED / YELLOW **全17ルール**と INFO 群を実装。テスト65件（[../tests/rules/rules.test.ts](../tests/rules/rules.test.ts)）。全35フィクスチャで**検出・非検出の両方**を検証済み。

- [../src/rules/types.ts](../src/rules/types.ts): `Finding` / `Rule` / `RuleContext`。`RuleContext` は L1 の `ContainerInfo` と L2 の `WorkbookCells`、加えて**判定基準日 `now`** を持つ。`now` を注入するのは「最終更新から N 日以上」を見るルールがあり、内部で `new Date()` を呼ぶとテストが実行日に依存して不安定になるため
- [../src/rules/thresholds.ts](../src/rules/thresholds.ts): 閾値を1か所に集約。承認済みの `THRESHOLDS` と、**未承認の `PROVISIONAL_THRESHOLDS` を型ごと分けてある**
- [../src/rules/helpers.ts](../src/rules/helpers.ts): 数式の括弧深度、揮発性関数の判定、`VLOOKUP` の列番号リテラル判定、PII 語彙、外部パスの種別分類
- [../src/rules/index.ts](../src/rules/index.ts): レジストリと `runRules()`。**1ルールが例外を投げても解析全体を止めない**（1ルールの不具合で診断そのものが出せなくなるほうが顧客の損失が大きい）

**★ Finding に載せない情報（引き継ぎ書 §7-2）。テストで機械的に担保している:**

| 載せない | 理由 |
|---|---|
| セル値 | そもそも L2 が保持していない |
| 数式文字列 | 顧客由来の文字列リテラルが埋まっていることがある |
| 外部参照のパス | 取引先名・部署名が含まれていることが多い |
| 接続文字列・接続名・サーバ名 | 社内構成そのもの |
| 作成者名 | 個人名 |

代わりに**件数と種別を伝え、「情報保護のためこのレポートには記載していません」と明示する**。黙って省くと不親切なうえ、情シス向けの説明としても弱い。

`PII_COLUMN_UNPROTECTED` だけは §5.4 が明示的に許可しているため、`名簿!A列（氏名）` の形で**列名と列位置**を出す。

**文言のテストも自動化した:** 英語の重大度ラベル（`CRITICAL` 等）を含まないこと、煽り文言（「今すぐ」「重大な損失」等）を含まないこと、`locations` が20件を超えないこと、`occurrences` が打ち切り後も正確であること。

**★ 判断が必要だった2件（いずれも 2026-08-16 開発者承認済み）:**

1. **`CIRCULAR_REF` の重大度は YELLOW。** 引き継ぎ書 §5.3 の一覧では RED だが、§8 R-3 は「Phase 1 では設定レベルの検出にとどめ、YELLOW 扱いにするのが妥当」としており矛盾していた。`calcPr@iterate` が有効でも循環参照の存在は意味せず（意図した反復計算の場合もある）、RED（すでに壊れている）とは言い切れないため、より具体的な §8 R-3 を優先した
2. **`PIVOT_CACHE_STALE` の閾値**は「最終更新から730日以上 **または** レコード数100,000以上」


`types.ts`（`Finding` / `Rule` / `RuleContext`）+ 1ファイル1ルール + レジストリ。RED 7種・YELLOW 10種・INFO 群（引き継ぎ書 §5.3）。

- `locations` は最大20件で打ち切り、`occurrences` は総数を保持
- 文言は非エンジニア向け日本語。表示ラベルは信号機のみ（英語重大度を出さない）
- `PII_COLUMN_UNPROTECTED` は**列名と列位置のみ**を出力し、値は一切出さない・断定しない

### M5: Worker 化 + 進捗 / 中断 — **完了（2026-08-09）**

- [../src/analysis.ts](../src/analysis.ts): `analyzeWorkbook()`（L1 → L2 → ルール適用）と Worker のメッセージ型。**Worker の外に出してあるので Node のテストからそのまま呼べる**
- [../src/worker/analyze.ts](../src/worker/analyze.ts): Worker エントリ。`analyzeWorkbook` に postMessage を被せているだけ
- [../src/worker/client.ts](../src/worker/client.ts): メインスレッド側の窓口
- テスト10件（[../tests/analysis.test.ts](../tests/analysis.test.ts)）。**JSON 出力に元データが含まれないこと**を全35フィクスチャで検証（引き継ぎ書 §10 の要求）

**実機確認済み（Chrome 151 / macOS 26.5.1 / `file://`）。** `npm run browser-check` で再現できる。これにより **M2 以来保留だった「自前 XML リーダーが Worker スコープで動く」ことが実証された**（進捗の「シートを読み取り中」は Worker 内の L1 から届いている）。所要は約1.2秒（ページ読み込み込み）。

実装上の要点:

- **Worker は `?worker&inline` で埋め込む。** 外部 worker ファイルを出力すると C-1 違反。加えて `vite.config.ts` に `worker: { format: "iife" }` が必須（ES モジュール形式の Worker は `file://` で読めない。R-A と同じ理由）
- Vite の inline worker は Blob URL を主経路、`data:` をフォールバックとして生成する。CSP は `worker-src blob:` のみ許可しているので、**Blob 経路が使えることが前提**（実測で確認済み）
- **中断は `worker.terminate()` で行う。** 解析は Worker 内で同期実行されるため、実行中に届いた「中断」メッセージは処理されない。擬似的な中断フラグを持たせても実際には止まらないので、あえて実装していない
- **`src/analysis.ts` をメインスレッド側から import しないこと。** import すると解析コードがバンドルに二重に入り、成果物が約 400KB → 約 780KB に膨らむ（Worker 側の inline バンドルと重複するため。実測）
- `__TOOL_VERSION__` / `__BUILD_YEAR__` を Vite の define で埋め込む。バージョンは package.json、年はビルド時刻が唯一の出所（**手書きの固定値にしない**という devkit のブランド規約への対応）

### ★ 実測手段の落とし穴（再発防止）

headless Chrome の **`--virtual-time-budget` + `--dump-dom` では Worker の実作業を待てない。** 仮想時間はタイマーを早送りするだけで、別スレッドの実処理の完了を待たないため、解析の途中で DOM がダンプされる。これを見て「Worker が動いていない」と誤読しかけた。

実時間でポーリングする [../scripts/browser-check.mjs](../scripts/browser-check.mjs)（CDP 経由）を使うこと。`npm run browser-check`。

### M6: UI / レポート — **完了（2026-08-16）**

5画面（ランディング / 解析中 / サマリ / 詳細 / 出力）を実装。テスト16件（[../tests/report/export.test.ts](../tests/report/export.test.ts)）。**`npm run browser-check` で端から端まで実機確認済み**（ランディング → ファイル読み込み → Worker 解析 → 結果 → HTML/JSON 保存）。

- [../src/main.ts](../src/main.ts): 画面遷移。ランディングには**実際に適用されている CSP を meta タグから読み取って表示**する（書き写しではないので、情シスへの説明で食い違いが起きない）
- [../src/report/view.ts](../src/report/view.ts): 結果描画。**`textContent` / `createElement` のみ**
- [../src/report/export.ts](../src/report/export.ts): 自己完結HTMLレポートと JSON の生成、ローカル保存
- [../src/report/branding.ts](../src/report/branding.ts): 問い合わせURL・著作権表記・情シス向け説明文
- [../src/styles/app.css](../src/styles/app.css): 可読性優先の実務トーン（引き継ぎ書 §6.3）

**★ エスケープ。** `export.ts` は文字列連結で HTML を組み立てる唯一の場所。細工されたシート名（`<img src=x onerror=...>`）やファイル名が実行可能な形にならないことをテストで担保している。保存物には `<script>` を一切含めない。

**保存物にも同じ CSP を入れている。** 顧客がレポートを転送した先でも「通信しない」ことを示せるようにするため。

**C-5 のライセンス表記を自動化した。** `vite.config.ts` が `node_modules` の実体から名前・版・ライセンスを読み、`__DEPENDENCY_LICENSES__` として埋め込む。**MIT / Apache-2.0 / BSD 系以外を見つけたらビルドを落とす**ので、GPL 系の混入は構造的に防がれる。

**問い合わせ導線（引き継ぎ書 §9 / 2026-08-16 確定）:** `https://www.keiru-ai.com/contact?from=scanner`、`rel="noopener"`、`noreferrer` は付けない。`verify-artifact.mjs` の ALLOWLIST に理由付きで登録済み。

**実測で確認した点:** `file://` + `default-src 'none'` の下でも、Blob URL を使った**ダウンロードは動作する**（CSP はリンク遷移・ダウンロードを止めない）。`npm run browser-check` が実際にファイルが書き出されることまで確認している。

### M7: 検証と完了条件 — **ほぼ完了（2026-08-16）。残るは他ブラウザの実機確認のみ**

#### 性能（引き継ぎ書 §4.3 / §10）

`npm run perf -- <シート数> <行数> <列数>` で大きなブックを生成して測る。

**50.3 MB / 30シート / 600万セル で 9.6〜16.4 秒**（実ブラウザの Worker、`file://`）。目標の30秒以内を達成。解析中も画面は応答し、進捗3段階がすべて観測できている。

最適化の記録:

| | 変更前 | 変更後 |
|---|---|---|
| L1 シート読み取り | 7.8 秒 | **0.86 秒** |
| 合計（Node 実測） | 16.9 秒 | **10.0 秒** |

- **L1 でシートXML全体を走査していたのが原因。** `sheetProtection` と `mergeCells` は `sheetData` の外にあるので、`indexOf` で位置を特定してからその周辺だけを解析するように変えた（[../src/worker/container.ts](../src/worker/container.ts)）。M2 の申し送りはこれで解消
- **SheetJS の展開（約9秒）が進捗の空白になっていた。** 最長の工程なのに報告が無く、画面が止まって見えた。`readCells` の先頭で「ブックを展開中」を出すようにした

#### ブラウザ横断の確認（2026-08-16）

**最大の未知数だった `worker-src blob:`（C-2 への唯一の追加）が、Chromium 系以外でも通ることを実測できた。** ここが通らなければ、その環境では解析そのものが動かなかった。

| ブラウザ | 版 | 手段 | 結果 |
|---|---|---|---|
| Chrome | 151.0.7922.138 | CDP（`npm run browser-check`） | PASS |
| Edge | 151.0.4129.86 | CDP（`BROWSER=edge npm run browser-check`） | PASS |
| Firefox | 153.0.4 | WebDriver BiDi（`npm run firefox-check`） | PASS |
| Safari | — | **自動化手段が無く目視確認** | 開発者が確認 |

Firefox は CDP を持たないため [../scripts/firefox-check.mjs](../scripts/firefox-check.mjs) を別実装にしてある。Safari には同等の手段が無いので、以後も目視に頼るしかない。

#### オフライン動作（§10）

`npm run browser-check` は**全通信を遮断した状態で走る**（`--proxy-server=127.0.0.1:1` と `--host-resolver-rules=MAP * ~NOTFOUND`）。この状態で、ランディング → 解析 → 結果 → HTML/JSON 保存まで通ることを確認済み。「ネットワーク未接続のPCで完全動作する」の実測になっている。

#### §10 チェックリストの状況

| 項目 | 状況 |
|---|---|
| 単一 `.html` / 外部依存ゼロ | **済** — `npm run verify` が毎ビルドで検査 |
| ネットワーク未接続の `file://` で完全動作 | **済** — 通信遮断下で `npm run browser-check` が PASS |
| CSP が C-2 のとおり | **済** — `verify-artifact` が照合。画面にも実物を表示 |
| RED / YELLOW 全ルール実装 + テスト通過 | **済** — 全17ルール |
| 各ルールで検出・非検出の両方を検証 | **済** — 架空フィクスチャ35件 |
| 50MB級で UI がフリーズしない | **済** — 50.3MB を 9.6〜16.4 秒、進捗も更新され続ける |
| レポート・JSON に元データが含まれない | **済** — 全フィクスチャで機械的に検証 |
| 勤務先由来情報が無いこと | **済** — 機械走査（法人格・役職・取引関係の語、実在ドメイン/メール）に加え、2026-08-16 に開発者が目視確認 |
| 他ブラウザでの動作 | **済** — Chrome 151 / Edge 151 / Firefox 153 を自動実測、Safari は開発者が目視確認（2026-08-16） |

---

## 配布方針（2026-08-16 開発者判断）

「無料配布によるコード・ノウハウ流出」への手当てとして、**難読化はせず（A）、表示と識別で手当てする（D）** 方針を採用した。

### なぜ難読化しないのか

引き継ぎ書 §1.3 の構造的優位は「通信しないローカルファイルは情シスの審査対象にならない」ことであり、その裏づけが「CSPで機械的に禁止しています。**ソースをご確認ください**」と言えることにある。情シスが実際に行う検証は **grep**（`fetch` / `XMLHttpRequest` が無いことの確認）である。

- **最小化は grep 可能性を壊さない**（現状のビルドは既に最小化済み）
- **難読化は grep 可能性を壊す** → 「確認できないものは通せない」となり、最大の武器を自ら手放すことになる

加えて、**最も模倣されやすい資産である日本語の診断文言は画面に表示されるため、技術的に隠すことが原理的にできない**。技術的に隠せるもの（ルール・閾値）は C-4 により「一般的な設計欠陥の類型」に限定されており、公知の内容で模倣価値が低い。**隠せるものは価値が低く、価値が高いものは隠せない**という構造になっている。

### 実施した手当て

- **利用条件を成果物とレポートに明記**（[../src/report/branding.ts](../src/report/branding.ts) の `TERMS`）
  - **先頭に「内容の確認・検証は自由」を置く。** ここを守ることが最優先
  - **リバースエンジニアリング禁止のような条項は書かない。** 書いた瞬間に上記の武器が無効化される。テストで機械的に禁止している（[../tests/report/export.test.ts](../tests/report/export.test.ts)）
  - 制限は「改変版の配布」と「検出内容・文言の転用」に絞る。前者は、通信する改変版が本物と見分けがつかない形で出回ると C-2 の保証そのものが崩れるため
- **配布識別子（ビルドID）を埋め込む**。`<git短縮SHA>-<YYYYMMDD>` 形式。配布経路ごとに `DIST_TAG=note npm run build` とすると `note/abc1234-20260816` になる。流出の**防止はできないが、どこから出たかの手がかりになる**

注: 利用条件の文面は法務の専門的助言ではない。公開前に専門家の確認を受けること。
