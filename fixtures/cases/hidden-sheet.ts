// HIDDEN_SHEET: 非表示 / 完全非表示（veryHidden）シートの検出。
//
// 類型としての問題: 引き継ぎを受けた担当者から見えないシートに計算やマスタが置かれていると、
// ブックの全体像が把握できず、改修時に壊しやすい。veryHidden は Excel の UI から再表示できないため、
// 作成者以外には存在自体が分からない。
//
// C-4: 以下のシート名・セル値はすべて架空。ありふれた語のみを使う。

import { buildXlsx, FIXTURE_SENTINEL } from "../ooxml";
import { baseSheet } from "./common";
import type { FixtureCase } from "./types";

/** 通常の可視シート1枚ぶんの中身。検出/非検出の両方で共通に使う。 */
const visibleSheet = baseSheet();

const detected: FixtureCase = {
  id: "hidden-sheet--detected",
  ruleId: "HIDDEN_SHEET",
  expectation: "detected",
  description: "hidden シートと veryHidden シートを1枚ずつ含む。両方が検出されること。",
  build: () =>
    buildXlsx({
      sheets: [
        visibleSheet,
        {
          name: "作業用",
          state: "hidden",
          // 1行目は列名、2行目以降が値。番兵は必ず2行目以降に置く
          // （1行目は列名として保持される層があるため、漏洩テストの対象にならない）。
          cells: [
            { ref: "A1", value: "中間計算" },
            { ref: "A2", value: `途中の値 ${FIXTURE_SENTINEL}` },
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
      ],
    }),
};

const clean: FixtureCase = {
  id: "hidden-sheet--clean",
  ruleId: "HIDDEN_SHEET",
  expectation: "clean",
  description: "すべて可視シート。非表示シートとして検出されないこと。",
  build: () =>
    buildXlsx({
      sheets: [
        visibleSheet,
        {
          name: "入力フォーム",
          cells: [
            { ref: "A1", value: "入力欄" },
            { ref: "A2", value: `入力値 ${FIXTURE_SENTINEL}` },
          ],
        },
      ],
    }),
};

export const hiddenSheetCases: FixtureCase[] = [detected, clean];
