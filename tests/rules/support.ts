// ルールのテストで共有する組み立て処理。
// L1 / L2 を実際に通してから RuleContext を作る（ルール単体ではなく、読み取りから通しで検証する）。

import { allCases, type FixtureCase } from "../../fixtures/cases";
import { readCells } from "../../src/worker/cells";
import { readContainer } from "../../src/worker/container";
import type { RuleContext } from "../../src/rules/types";

/**
 * 判定の基準日。実行日に依存させないため固定する。
 * 「最終更新から N 日以上」を見るルールがあるので、ここが動くとテストが不安定になる。
 */
export const FIXED_NOW = new Date("2026-08-09T00:00:00Z");

export function caseById(caseId: string): FixtureCase {
  const testCase = allCases.find((entry) => entry.id === caseId);
  if (!testCase) throw new Error(`ケースが見つかりません: ${caseId}`);
  return testCase;
}

export function contextForCase(testCase: FixtureCase): RuleContext {
  const bytes = testCase.build();
  return {
    container: readContainer(bytes),
    cells: readCells(bytes),
    fileName: `${testCase.id}.xlsx`,
    fileSizeBytes: bytes.length,
    now: FIXED_NOW,
  };
}

export function contextFor(caseId: string): RuleContext {
  return contextForCase(caseById(caseId));
}
