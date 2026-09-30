// FORMULA_DEEP_NEST / VLOOKUP_HARDCODED_INDEX / VOLATILE_FUNCTION: 数式の作りに起因するもの。
//
// ★ 数式文字列そのものは Finding に載せない（引き継ぎ書 §7-2）。
// 数式には `IF(A1="○○",...)` のように顧客由来の文字列リテラルが埋まっていることがある。
// 判定にのみ使い、外に出すのはセル参照と件数だけ。

import {
  cellLocation,
  limitLocations,
  maxParenDepth,
  usesHardcodedLookupIndex,
  usesVolatileFunction,
} from "./helpers";
import { THRESHOLDS } from "./thresholds";
import type { Finding, Rule, RuleContext } from "./types";

export const formulaDeepNestRule: Rule = {
  id: "FORMULA_DEEP_NEST",
  check: { category: "FRAGILE", label: "入れ子が深すぎる数式がないか" },

  evaluate(context: RuleContext): Finding[] {
    const locations: string[] = [];
    let occurrences = 0;
    let deepest = 0;

    for (const sheet of context.cells.sheets) {
      for (const entry of sheet.formulas) {
        const depth = maxParenDepth(entry.formula);
        if (depth < THRESHOLDS.formulaNestDepth) continue;
        occurrences += 1;
        if (depth > deepest) deepest = depth;
        locations.push(cellLocation(sheet.name, entry.ref));
      }
    }

    if (occurrences === 0) return [];

    return [
      {
        ruleId: "FORMULA_DEEP_NEST",
        severity: "YELLOW",
        title: "入れ子が深い数式があります",
        detail:
          `かっこの入れ子が ${THRESHOLDS.formulaNestDepth} 段以上ある数式が ${occurrences} 件あります` +
          `（最も深いもので ${deepest} 段）。条件分岐を数式の中で重ねると、こうした形になります。`,
        locations: limitLocations(locations),
        occurrences,
        impact:
          "式の意味を追うのに時間がかかり、修正の際に誤りが入りやすくなります。" +
          "作成した方以外には、どこを直せばよいか判断しづらい状態です。",
      },
    ];
  },
};

export const vlookupHardcodedIndexRule: Rule = {
  id: "VLOOKUP_HARDCODED_INDEX",
  check: { category: "FRAGILE", label: "取り出す列を番号で指定した表引きがないか" },

  evaluate(context: RuleContext): Finding[] {
    const locations: string[] = [];
    let occurrences = 0;

    for (const sheet of context.cells.sheets) {
      for (const entry of sheet.formulas) {
        if (!usesHardcodedLookupIndex(entry.formula)) continue;
        occurrences += 1;
        locations.push(cellLocation(sheet.name, entry.ref));
      }
    }

    if (occurrences === 0) return [];

    return [
      {
        ruleId: "VLOOKUP_HARDCODED_INDEX",
        severity: "YELLOW",
        title: "取り出す列を番号で指定した表引きがあります",
        detail:
          `別表から値を取り出す数式のうち ${occurrences} 件が、取り出す列を` +
          "「左から何番目」という番号で指定しています。",
        locations: limitLocations(locations),
        occurrences,
        impact:
          "参照している表の途中に列を追加・削除すると、取り出す位置がずれて別の値を拾います。" +
          "エラーにならず数値だけが変わるため、間違いに気づきにくいのが難しい点です。",
      },
    ];
  },
};

export const volatileFunctionRule: Rule = {
  id: "VOLATILE_FUNCTION",
  check: { category: "FRAGILE", label: "開くたびに再計算される関数を多用していないか" },

  evaluate(context: RuleContext): Finding[] {
    const locations: string[] = [];
    let occurrences = 0;

    for (const sheet of context.cells.sheets) {
      for (const entry of sheet.formulas) {
        if (!usesVolatileFunction(entry.formula)) continue;
        occurrences += 1;
        locations.push(cellLocation(sheet.name, entry.ref));
      }
    }

    if (occurrences === 0) return [];

    const totalFormulas = context.cells.totalFormulaCount;
    const ratio = totalFormulas === 0 ? 0 : occurrences / totalFormulas;
    const exceedsCount = occurrences >= THRESHOLDS.volatileCellCount;
    const exceedsRatio = ratio >= THRESHOLDS.volatileCellRatio;
    if (!exceedsCount && !exceedsRatio) return [];

    const percent = Math.round(ratio * 100);

    return [
      {
        ruleId: "VOLATILE_FUNCTION",
        severity: "YELLOW",
        title: "開くたびに再計算される関数を多く使っています",
        detail:
          `再計算のたびに結果が変わりうる関数（INDIRECT・OFFSET・TODAY など）が ${occurrences} 件` +
          `使われています（数式全体の約 ${percent}%）。`,
        locations: limitLocations(locations),
        occurrences,
        impact:
          "ファイルを開くたびに計算が走るため、動作が重くなります。" +
          "日付の関数を使っている場合は、記録として残したはずの値が開くたびに変わってしまい、" +
          "後から当時の内容を確認できなくなることがあります。",
      },
    ];
  },
};
