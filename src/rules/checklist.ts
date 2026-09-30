// 「確認した項目」の組み立て。
//
// ★ なぜ要るか
// 検出が0件だったとき、レポートに「問題は検出されませんでした」しか出ないと、
// **何を見たうえでの0件なのかが伝わらない**。診断の価値がいちばん疑われる場面で、
// 示せる材料が無い状態だった（docs/delivery-templates.md のテンプレートC）。
//
// ★ 固定の一覧を書かないこと
// 文言は各ルールの `check`（src/rules/types.ts）から組み立てる。ここに一覧を
// 直書きすると、ルールを足したり消したりしたときに実態とずれ、**やっていないことを
// やったと書く**ことになる。CLAUDE.md §7-7 に反する。

import { RULES } from "./index";
import { CHECK_CATEGORY_LABEL, CHECK_CATEGORY_ORDER } from "./types";
import type { CheckCategory } from "./types";

/** 表示用にまとめた1区分。 */
export interface CheckGroup {
  category: CheckCategory;
  /** 画面に出す見出し（英語のキーは出さない）。 */
  label: string;
  items: { ruleId: string; label: string }[];
}

/**
 * 確認しきれなかった範囲。
 *
 * **「確認していない範囲は、その旨を明記します」**（CLAUDE.md）を実装で担保する。
 * 該当がなければ空配列。
 */
export interface CoverageNote {
  /** 影響を受けた確認項目の ruleId。 */
  ruleIds: string[];
  /** なぜ確認しきれなかったか。非エンジニアが読む前提。 */
  reason: string;
}

/**
 * 実際に登録されているルールから「確認した項目」を組み立てる。
 * `informational` なルール（基礎指標）は検出/非検出の性質を持たないので含めない。
 */
export function buildCheckGroups(): CheckGroup[] {
  const byCategory = new Map<CheckCategory, { ruleId: string; label: string }[]>();

  for (const rule of RULES) {
    if (rule.informational === true) continue;
    if (rule.check === undefined) continue; // tests/checklist.test.ts が存在を強制している
    const items = byCategory.get(rule.check.category) ?? [];
    items.push({ ruleId: rule.id, label: rule.check.label });
    byCategory.set(rule.check.category, items);
  }

  return CHECK_CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => ({
    category,
    label: CHECK_CATEGORY_LABEL[category],
    items: byCategory.get(category) ?? [],
  }));
}

/** 「確認した項目」の総数。 */
export function countCheckItems(): number {
  return buildCheckGroups().reduce((total, group) => total + group.items.length, 0);
}

/**
 * 実際の解析状態から「確認しきれなかった範囲」を求める。
 *
 * ★ 憶測で足さないこと。**解析側が持っているフラグだけを根拠にする。**
 * 「たぶん見きれていない」を書くと、事実でない限定を顧客に伝えることになる。
 */
export function buildCoverageNotes(input: {
  formulasTruncated: boolean;
  errorsTruncated: boolean;
  /** VBA のモジュール本体ストリーム数。VBA が無ければ 0。 */
  vbaStreamCount: number;
  /** そのうちソースを読み取れた数。 */
  vbaAnalyzedModules: number;
}): CoverageNote[] {
  const notes: CoverageNote[] = [];

  if (input.formulasTruncated) {
    notes.push({
      ruleIds: ["FORMULA_DEEP_NEST", "VLOOKUP_HARDCODED_INDEX", "VOLATILE_FUNCTION"],
      reason:
        "数式の数が非常に多いため、数式に関する確認は一部にとどめました。" +
        "件数の集計は全体に対して行っています。",
    });
  }

  if (input.errorsTruncated) {
    notes.push({
      ruleIds: ["REF_ERROR"],
      reason:
        "エラー表示の数が非常に多いため、該当箇所の記載は一部にとどめました。" +
        "件数の集計は全体に対して行っています。",
    });
  }

  // マクロはあるが、中身を読み取れなかった場合。
  // **「マクロが無い」場合はここに入れない** — 確認した結果として無かっただけで、
  // 確認できなかったわけではない。
  if (input.vbaStreamCount > 0 && input.vbaAnalyzedModules < input.vbaStreamCount) {
    const unread = input.vbaStreamCount - input.vbaAnalyzedModules;
    notes.push({
      ruleIds: [
        "VBA_NETWORK_ACCESS",
        "VBA_SHELL_EXEC",
        "VBA_HARDCODED_CREDENTIAL",
        "VBA_FILE_ACCESS",
        "VBA_EXTERNAL_DB",
        "VBA_AUTO_RUN",
      ],
      reason:
        `マクロ ${input.vbaStreamCount} 件のうち ${unread} 件は中身を読み取れませんでした。` +
        "マクロの内容に関する確認は、読み取れた分に限られます。",
    });
  }

  return notes;
}
