// 動作確認・デモ用のサンプルを1ファイルにまとめて書き出す。
//
//   npm run demo   → fixtures/out/デモ_問題の多いブック.xlsx / デモ_良好なブック.xlsx
//
// テスト用フィクスチャ（fixtures/cases/）は1ファイル1ルールに絞ってあり、実際の業務ファイルの
// 「いろいろ混ざっている感じ」が出ない。画面の見え方や文言のトーンを確かめるにはこちらを使う。
//
// C-4 厳守: すべて架空。実在の事業体・業務知見・命名規則を一切含まない。
// テストからは参照しないので allCases には登録していない（1ケース1ルールの前提を崩さないため）。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildXlsx, FIXTURE_SENTINEL, type CellSpec } from "./ooxml";

const OUT_DIR = join(import.meta.dirname, "out");

/** 深さ n の入れ子 IF。 */
function nestedIf(depth: number): string {
  let formula = '"該当なし"';
  for (let level = depth; level >= 1; level -= 1) {
    formula = `IF(B${level}=${level},"区分${level}",${formula})`;
  }
  return formula;
}

const VOLATILE = ['INDIRECT("集計!B"&ROW())', "OFFSET($A$1,ROW(),0)", "TODAY()", "NOW()"];

function volatileCells(count: number): CellSpec[] {
  return Array.from({ length: count }, (_unused, index) => ({
    ref: `F${index + 2}`,
    formula: VOLATILE[index % VOLATILE.length]!,
  }));
}

function mergeRanges(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `A${index + 2}:C${index + 2}`);
}

/** 現場でありがちな欠陥をひととおり含むブック。 */
function problematicWorkbook(): Uint8Array {
  return buildXlsx({
    sheets: [
      {
        name: "集計",
        cells: [
          { ref: "A1", value: "区分" },
          { ref: "B1", value: "数量" },
          { ref: "C1", value: "単価" },
          { ref: "D1", value: "金額" },
          { ref: "A2", value: `品目1 ${FIXTURE_SENTINEL}` },
          { ref: "B2", value: "10" },
          { ref: "C2", value: "1200" },
          { ref: "D2", formula: "B2*C2" },
          { ref: "D3", error: "#REF!" },
          { ref: "D4", formula: "VLOOKUP(A2,マスタ!$A:$D,3,FALSE)" },
          { ref: "E2", formula: nestedIf(9) },
          ...volatileCells(130),
        ],
        merges: mergeRanges(70),
      },
      {
        name: "名簿",
        cells: [
          { ref: "A1", value: "氏名" },
          { ref: "B1", value: "住所" },
          { ref: "C1", value: "電話番号" },
          { ref: "D1", value: "メールアドレス" },
          { ref: "E1", value: "生年月日" },
          // 値は入れない。個人情報らしき値そのものはサンプルにも置かない。
          { ref: "A2", value: `（サンプル行）${FIXTURE_SENTINEL}` },
        ],
      },
      {
        name: "マスタ",
        state: "hidden",
        cells: [
          { ref: "A1", value: "コード" },
          { ref: "B1", value: "名称" },
          { ref: "C1", value: "数量" },
          { ref: "D1", value: "単価" },
          { ref: "A2", value: `M-001 ${FIXTURE_SENTINEL}` },
        ],
      },
      {
        name: "旧様式",
        state: "veryHidden",
        cells: [
          { ref: "A1", value: "旧項目" },
          { ref: "A2", value: `旧データ ${FIXTURE_SENTINEL}` },
        ],
      },
      {
        name: "様式（保護）",
        protection: { passwordHash: "CC1A" },
        cells: [
          { ref: "A1", value: "帳票見出し" },
          { ref: "A2", value: `記入欄 ${FIXTURE_SENTINEL}` },
        ],
      },
    ],
    definedNames: [
      { name: "集計範囲", formula: "集計!$A$1:$D$100" },
      { name: "旧集計範囲", formula: "#REF!#REF!$A$1" },
    ],
    calcPr: { iterate: true, calcMode: "manual" },
    externalLinks: [
      { target: "\\\\filesrv01\\共有\\単価表.xlsx", sheetNames: ["単価"] },
      { target: "../共有/前年度実績.xlsx", sheetNames: ["実績"] },
    ],
    connections: [
      {
        name: "基幹データ取込",
        connectionString:
          "Provider=SQLOLEDB;Data Source=dbsrv01;Initial Catalog=sample_db;User ID=sample_user;Password=DummyPass123;",
        command: "SELECT * FROM sample_table",
      },
    ],
    pivotCaches: [{ refreshedDate: "2016-03-15T10:00:00Z", recordCount: 250_000 }],
    docProps: {
      creator: "担当者A",
      lastModifiedBy: "担当者A",
      created: "2014-04-01T09:00:00Z",
      modified: "2015-06-30T17:30:00Z",
    },
    vba: true,
  });
}

/** 何も検出されないブック。「問題は検出されませんでした」の見え方を確かめる用。 */
function healthyWorkbook(): Uint8Array {
  return buildXlsx({
    sheets: [
      {
        name: "集計",
        cells: [
          { ref: "A1", value: "区分" },
          { ref: "B1", value: "数量" },
          { ref: "C1", value: "単価" },
          { ref: "D1", value: "金額" },
          { ref: "A2", value: "品目1" },
          { ref: "B2", value: "10" },
          { ref: "C2", value: "1200" },
          { ref: "D2", formula: "B2*C2" },
          { ref: "A3", value: "品目2" },
          { ref: "B3", value: "4" },
          { ref: "C3", value: "980" },
          { ref: "D3", formula: "B3*C3" },
          { ref: "D4", formula: "SUM(D2:D3)" },
        ],
      },
    ],
    definedNames: [{ name: "集計範囲", formula: "集計!$A$1:$D$4" }],
    calcPr: { calcMode: "auto" },
    docProps: {
      creator: "担当者A",
      lastModifiedBy: "担当者B",
      created: "2025-04-01T09:00:00Z",
      modified: "2026-07-01T10:00:00Z",
    },
  });
}

mkdirSync(OUT_DIR, { recursive: true });

for (const [name, build] of [
  ["デモ_問題の多いブック.xlsx", problematicWorkbook],
  ["デモ_良好なブック.xlsx", healthyWorkbook],
] as const) {
  const bytes = build();
  writeFileSync(join(OUT_DIR, name), bytes);
  console.log(`  ${name}  ${bytes.length.toLocaleString("en-US")} bytes`);
}

console.log(`\n${OUT_DIR} に書き出しました。`);
