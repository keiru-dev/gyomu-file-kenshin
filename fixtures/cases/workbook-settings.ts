// ブック全体の計算設定に関するルール。
//
// CIRCULAR_REF     : 反復計算が有効（＝循環参照を許容する設定になっている）
// MANUAL_CALC_MODE : 計算モードが手動（更新漏れによる誤値のリスク）
//
// Phase 1 は設定レベルの検出にとどめる。数式依存グラフの構築は過剰実装（引き継ぎ書 §8 R-3）。

import { buildXlsx } from "../ooxml";
import { baseSheet } from "./common";
import type { FixtureCase } from "./types";

const iterate: FixtureCase = {
  id: "circular-ref--detected",
  ruleId: "CIRCULAR_REF",
  expectation: "detected",
  description: "calcPr の反復計算が有効。循環参照を許容する設定として検出されること。",
  build: () => buildXlsx({ sheets: [baseSheet()], calcPr: { iterate: true } }),
};

const iterateClean: FixtureCase = {
  id: "circular-ref--clean",
  ruleId: "CIRCULAR_REF",
  expectation: "clean",
  description: "calcPr はあるが反復計算は無効。検出されないこと。",
  build: () => buildXlsx({ sheets: [baseSheet()], calcPr: { calcMode: "auto" } }),
};

const manualCalc: FixtureCase = {
  id: "manual-calc-mode--detected",
  ruleId: "MANUAL_CALC_MODE",
  expectation: "detected",
  description: "計算モードが手動。更新漏れのリスクとして検出されること。",
  build: () => buildXlsx({ sheets: [baseSheet()], calcPr: { calcMode: "manual" } }),
};

const manualCalcClean: FixtureCase = {
  id: "manual-calc-mode--clean",
  ruleId: "MANUAL_CALC_MODE",
  expectation: "clean",
  description: "計算モードが自動。検出されないこと。",
  build: () => buildXlsx({ sheets: [baseSheet()], calcPr: { calcMode: "auto" } }),
};

export const workbookSettingsCases: FixtureCase[] = [
  iterate,
  iterateClean,
  manualCalc,
  manualCalcClean,
];
