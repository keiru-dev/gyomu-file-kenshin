// 検出ルールのレジストリ。
// ルールを追加したら RULES に登録する。並び順は表示順ではなく、重大度で並べ替えて返す。

import { externalConnectionRule, hardcodedCredentialRule } from "./external-connection";
import { externalLinkBrokenRule, externalLinkPresentRule } from "./external-link";
import { formulaDeepNestRule, vlookupHardcodedIndexRule, volatileFunctionRule } from "./formula";
import { hiddenSheetRule } from "./hidden-sheet";
import { infoMetricsRule } from "./info-metrics";
import { authorSingleLegacyRule, pivotCacheStaleRule, vbaPresentRule } from "./metadata";
import { piiColumnUnprotectedRule } from "./pii-column";
import { refErrorRule } from "./ref-error";
import { vbaCodeRules } from "./vba-code";
import { mergedCellHeavyRule, protectedWithPasswordRule } from "./sheet-structure";
import { circularRefRule, manualCalcModeRule } from "./workbook-settings";
import type { Finding, Rule, RuleContext, Severity } from "./types";

export type { Finding, Rule, RuleContext, Severity } from "./types";

export const RULES: Rule[] = [
  // RED
  refErrorRule,
  externalLinkPresentRule,
  externalLinkBrokenRule,
  externalConnectionRule,
  hardcodedCredentialRule,
  piiColumnUnprotectedRule,
  // YELLOW
  circularRefRule,
  manualCalcModeRule,
  hiddenSheetRule,
  mergedCellHeavyRule,
  protectedWithPasswordRule,
  formulaDeepNestRule,
  vlookupHardcodedIndexRule,
  volatileFunctionRule,
  vbaPresentRule,
  authorSingleLegacyRule,
  pivotCacheStaleRule,
  // VBA ソースの静的解析（Phase 2）
  ...vbaCodeRules,
  // INFO
  infoMetricsRule,
];

/** 表示順。信号機の重い順に並べる。 */
const SEVERITY_ORDER: Record<Severity, number> = { RED: 0, YELLOW: 1, GREEN: 2, INFO: 3 };

/**
 * すべてのルールを適用する。
 * 1つのルールが例外を投げても解析全体を止めない（壊れたファイルでも他の指摘は出す）。
 */
export function runRules(context: RuleContext): Finding[] {
  const findings: Finding[] = [];

  for (const rule of RULES) {
    try {
      findings.push(...rule.evaluate(context));
    } catch {
      // 失敗したルールは飛ばす。ここで握りつぶすのは「1ルールの不具合で
      // 診断そのものが出せなくなる」ほうが顧客にとって損失が大きいため。
    }
  }

  // 同じ重大度の中では登録順を保つ（sort は安定ソート）。
  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
