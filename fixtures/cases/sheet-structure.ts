// シート構造・保護に関するルール。
//
// MERGED_CELL_HEAVY      : 結合セルが多く、並べ替え・集計・自動処理を阻害する
// PROTECTED_WITH_PASSWORD: パスワード保護されており、解除できる人が不在の可能性がある
// PII_COLUMN_UNPROTECTED : 個人情報らしき列名があり、かつシート保護が無い
//
// PII について（引き継ぎ書 §5.4）: 誤検知は許容するが断定しない。
// フィクスチャ側でも「列名だけ」を置き、個人情報らしき値そのものは一切書かない。
//
// C-4: 列名は一般的な語のみ。値は架空。

import { buildXlsx, FIXTURE_SENTINEL, type CellSpec } from "../ooxml";
import { baseSheet, headerRow, PII_HEADERS, PLAIN_HEADERS } from "./common";
import type { FixtureCase } from "./types";

// --- MERGED_CELL_HEAVY -----------------------------------------------------
// 閾値: 結合セル数 >= 50 / シート

function merges(count: number): string[] {
  // 1行につき A..C を結合していく。範囲は重ならない。
  return Array.from({ length: count }, (_unused, index) => {
    const row = index + 2;
    return `A${row}:C${row}`;
  });
}

const mergedHeavy: FixtureCase = {
  id: "merged-cell-heavy--detected",
  ruleId: "MERGED_CELL_HEAVY",
  expectation: "detected",
  description: "結合セル 60 個（閾値 50 超え）。検出されること。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          name: "帳票",
          cells: [
            { ref: "A1", value: "見出し" },
            { ref: "A2", value: `明細 ${FIXTURE_SENTINEL}` },
          ],
          merges: merges(60),
        },
      ],
    }),
};

const mergedHeavyClean: FixtureCase = {
  id: "merged-cell-heavy--clean",
  ruleId: "MERGED_CELL_HEAVY",
  expectation: "clean",
  description: "結合セル 5 個のみ。閾値 50 に達しないため検出されないこと。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          name: "帳票",
          cells: [
            { ref: "A1", value: "見出し" },
            { ref: "A2", value: `明細 ${FIXTURE_SENTINEL}` },
          ],
          merges: merges(5),
        },
      ],
    }),
};

// --- PROTECTED_WITH_PASSWORD ----------------------------------------------

const passwordProtected: FixtureCase = {
  id: "protected-with-password--detected",
  ruleId: "PROTECTED_WITH_PASSWORD",
  expectation: "detected",
  description: "パスワード付きのシート保護。解除できる人が不在の可能性として検出されること。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          ...baseSheet(),
          // 実在のパスワードから計算した値ではなく、見せかけの固定ハッシュ。
          protection: { passwordHash: "CC1A" },
        },
      ],
    }),
};

const passwordProtectedClean: FixtureCase = {
  id: "protected-with-password--clean",
  ruleId: "PROTECTED_WITH_PASSWORD",
  expectation: "clean",
  description: "シート保護はあるがパスワード無し。パスワード保護としては検出されないこと。",
  build: () => buildXlsx({ sheets: [{ ...baseSheet(), protection: {} }] }),
};

// --- PII_COLUMN_UNPROTECTED -----------------------------------------------

function piiSheetCells(): CellSpec[] {
  return [
    ...headerRow(PII_HEADERS),
    // 値は入れない。個人情報らしき値そのものはフィクスチャにも置かない。
    { ref: "A2", value: `サンプル行 ${FIXTURE_SENTINEL}` },
  ];
}

const piiUnprotected: FixtureCase = {
  id: "pii-column-unprotected--detected",
  ruleId: "PII_COLUMN_UNPROTECTED",
  expectation: "detected",
  description: "個人情報らしき列名があり、シート保護が無い。可能性がある旨として検出されること。",
  build: () => buildXlsx({ sheets: [{ name: "名簿", cells: piiSheetCells() }] }),
};

const piiProtected: FixtureCase = {
  id: "pii-column-unprotected--clean-protected",
  ruleId: "PII_COLUMN_UNPROTECTED",
  expectation: "clean",
  description: "個人情報らしき列名はあるがシート保護あり。保護済みのため検出されないこと。",
  build: () =>
    buildXlsx({
      sheets: [{ name: "名簿", cells: piiSheetCells(), protection: { passwordHash: "CC1A" } }],
    }),
};

const piiAbsent: FixtureCase = {
  id: "pii-column-unprotected--clean-no-pii",
  ruleId: "PII_COLUMN_UNPROTECTED",
  expectation: "clean",
  description: "保護は無いが列名に個人情報らしさが無い。検出されないこと。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          name: "集計表",
          cells: [...headerRow(PLAIN_HEADERS), { ref: "A2", value: `サンプル行 ${FIXTURE_SENTINEL}` }],
        },
      ],
    }),
};

export const sheetStructureCases: FixtureCase[] = [
  mergedHeavy,
  mergedHeavyClean,
  passwordProtected,
  passwordProtectedClean,
  piiUnprotected,
  piiProtected,
  piiAbsent,
];
