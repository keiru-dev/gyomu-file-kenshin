// 数式まわりのルール。
//
// REF_ERROR             : #REF! エラーを含むセル・名前定義
// FORMULA_DEEP_NEST     : 数式のネストが深く、読み解けない
// VLOOKUP_HARDCODED_INDEX: 列番号をリテラル指定した参照関数（列挿入で破綻する）
// VOLATILE_FUNCTION     : 揮発性関数の多用（再計算が重くなる / 値が安定しない）
//
// 閾値は docs/plan-phase1.md の承認済み暫定値に合わせてある。
// C-4: 数式・シート名・値はすべて架空。

import { buildXlsx, FIXTURE_SENTINEL, type CellSpec } from "../ooxml";
import { baseSheet } from "./common";
import type { FixtureCase } from "./types";

// --- REF_ERROR -------------------------------------------------------------

const refError: FixtureCase = {
  id: "ref-error--detected",
  ruleId: "REF_ERROR",
  expectation: "detected",
  description: "#REF! エラーのセルと、参照が壊れた名前定義を含む。両方が検出されること。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          name: "集計表",
          cells: [
            { ref: "A1", value: "項目" },
            { ref: "A2", value: `品目1 ${FIXTURE_SENTINEL}` },
            { ref: "B2", error: "#REF!" },
            { ref: "B3", formula: "#REF!+1" },
          ],
        },
      ],
      definedNames: [{ name: "旧集計範囲", formula: "#REF!#REF!$A$1" }],
    }),
};

const refErrorClean: FixtureCase = {
  id: "ref-error--clean",
  ruleId: "REF_ERROR",
  expectation: "clean",
  description: "エラー値も壊れた名前定義も無い。検出されないこと。",
  build: () =>
    buildXlsx({
      sheets: [baseSheet()],
      definedNames: [{ name: "集計範囲", formula: "集計表!$A$1:$B$4" }],
    }),
};

// --- FORMULA_DEEP_NEST -----------------------------------------------------

/** 深さ n の入れ子 IF を作る。閾値は 7 なので、検出側は 8 にする。 */
function nestedIf(depth: number): string {
  let formula = '"最終"';
  for (let level = depth; level >= 1; level -= 1) {
    formula = `IF(A${level}=${level},"区分${level}",${formula})`;
  }
  return formula;
}

const deepNest: FixtureCase = {
  id: "formula-deep-nest--detected",
  ruleId: "FORMULA_DEEP_NEST",
  expectation: "detected",
  description: "ネスト深度 8 の数式を含む（閾値 7 超え）。検出されること。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          name: "集計表",
          cells: [
            { ref: "A1", value: "判定元" },
            { ref: "A2", value: `判定値 ${FIXTURE_SENTINEL}` },
            { ref: "C1", formula: nestedIf(8) },
          ],
        },
      ],
    }),
};

const deepNestClean: FixtureCase = {
  id: "formula-deep-nest--clean",
  ruleId: "FORMULA_DEEP_NEST",
  expectation: "clean",
  description: "ネスト深度 3 まで。閾値 7 に達しないため検出されないこと。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          name: "集計表",
          cells: [
            { ref: "A1", value: "判定元" },
            { ref: "A2", value: `判定値 ${FIXTURE_SENTINEL}` },
            { ref: "C1", formula: nestedIf(3) },
          ],
        },
      ],
    }),
};

// --- VLOOKUP_HARDCODED_INDEX ----------------------------------------------

const hardcodedIndex: FixtureCase = {
  id: "vlookup-hardcoded-index--detected",
  ruleId: "VLOOKUP_HARDCODED_INDEX",
  expectation: "detected",
  description: "列番号をリテラル指定した VLOOKUP / HLOOKUP を含む。列挿入で破綻する型として検出されること。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          name: "集計表",
          cells: [
            { ref: "A1", value: "検索キー" },
            { ref: "A2", value: `検索値 ${FIXTURE_SENTINEL}` },
            { ref: "B2", formula: 'VLOOKUP(A2,マスタ!$A:$D,3,FALSE)' },
            { ref: "B3", formula: 'HLOOKUP(A3,マスタ!$A$1:$D$9,4,FALSE)' },
          ],
        },
        {
          name: "マスタ",
          cells: [
            { ref: "A1", value: "コード" },
            { ref: "B1", value: "名称" },
            { ref: "C1", value: "数量" },
            { ref: "D1", value: "単価" },
          ],
        },
      ],
    }),
};

const hardcodedIndexClean: FixtureCase = {
  id: "vlookup-hardcoded-index--clean",
  ruleId: "VLOOKUP_HARDCODED_INDEX",
  expectation: "clean",
  description: "列番号を MATCH で解決している。列挿入に耐えるため検出されないこと。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          name: "集計表",
          cells: [
            { ref: "A1", value: "検索キー" },
            { ref: "A2", value: `検索値 ${FIXTURE_SENTINEL}` },
            { ref: "B2", formula: 'VLOOKUP(A2,マスタ!$A:$D,MATCH("数量",マスタ!$A$1:$D$1,0),FALSE)' },
          ],
        },
        {
          name: "マスタ",
          cells: [
            { ref: "A1", value: "コード" },
            { ref: "B1", value: "名称" },
            { ref: "C1", value: "数量" },
            { ref: "D1", value: "単価" },
          ],
        },
      ],
    }),
};

// --- VOLATILE_FUNCTION -----------------------------------------------------
// 閾値: 揮発性関数を含むセル >= 100、または全数式セルの 10%。

const VOLATILE_FORMULAS = [
  'INDIRECT("集計表!A"&ROW())',
  "OFFSET($A$1,ROW(),0)",
  "TODAY()",
  "NOW()",
  "RAND()",
];

function volatileCells(count: number, startRow: number): CellSpec[] {
  return Array.from({ length: count }, (_unused, index) => {
    const formula = VOLATILE_FORMULAS[index % VOLATILE_FORMULAS.length];
    if (formula === undefined) throw new Error("揮発性関数のサンプルがありません");
    return { ref: `D${startRow + index}`, formula };
  });
}

function plainFormulaCells(count: number, startRow: number): CellSpec[] {
  return Array.from({ length: count }, (_unused, index) => ({
    ref: `E${startRow + index}`,
    formula: `B${startRow + index}*2`,
  }));
}

const volatile: FixtureCase = {
  id: "volatile-function--detected",
  ruleId: "VOLATILE_FUNCTION",
  expectation: "detected",
  description: "揮発性関数を 120 セルで使用（閾値 100 超え）。検出されること。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          name: "集計表",
          cells: [
            { ref: "A1", value: "見出し" },
            { ref: "A2", value: `明細 ${FIXTURE_SENTINEL}` },
            ...volatileCells(120, 2),
          ],
        },
      ],
    }),
};

const volatileClean: FixtureCase = {
  id: "volatile-function--clean",
  ruleId: "VOLATILE_FUNCTION",
  expectation: "clean",
  description: "数式 102 セル中、揮発性関数は 2 セルのみ（約2%）。閾値のどちらにも達しないこと。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          name: "集計表",
          cells: [
            { ref: "A1", value: "見出し" },
            { ref: "A2", value: `明細 ${FIXTURE_SENTINEL}` },
            ...volatileCells(2, 2),
            ...plainFormulaCells(100, 2),
          ],
        },
      ],
    }),
};

export const formulaCases: FixtureCase[] = [
  refError,
  refErrorClean,
  deepNest,
  deepNestClean,
  hardcodedIndex,
  hardcodedIndexClean,
  volatile,
  volatileClean,
];
