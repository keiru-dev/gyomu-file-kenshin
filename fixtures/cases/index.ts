// 全フィクスチャケースのレジストリ。
// ルールを1つ実装するごとに、ここへ検出・非検出の対を追加していく。

import { externalConnectionCases } from "./external-connection";
import { externalLinkCases } from "./external-link";
import { formulaCases } from "./formula";
import { hiddenSheetCases } from "./hidden-sheet";
import { metadataCases } from "./metadata";
import { sheetStructureCases } from "./sheet-structure";
import { vbaCodeCases } from "./vba-code";
import { workbookSettingsCases } from "./workbook-settings";
import type { FixtureCase } from "./types";

export type { FixtureCase } from "./types";

export const allCases: FixtureCase[] = [
  ...hiddenSheetCases,
  ...externalLinkCases,
  ...externalConnectionCases,
  ...formulaCases,
  ...workbookSettingsCases,
  ...sheetStructureCases,
  ...metadataCases,
  ...vbaCodeCases,
];

/** 指定ルールのケースだけを取り出す。テストで使う。 */
export function casesForRule(ruleId: string): FixtureCase[] {
  return allCases.filter((testCase) => testCase.ruleId === ruleId);
}

/** フィクスチャを用意したルールの一覧。 */
export function coveredRuleIds(): string[] {
  return [...new Set(allCases.map((testCase) => testCase.ruleId))].sort();
}
