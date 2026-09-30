// REF_ERROR: 参照先が失われたことを示す #REF! エラー。
//
// セル側（L2）と名前定義側（L1）の両方を見る。

import { cellLocation, limitLocations } from "./helpers";
import type { Finding, Rule, RuleContext } from "./types";

const REF_ERROR = "#REF!";

export const refErrorRule: Rule = {
  id: "REF_ERROR",
  check: { category: "BROKEN_CALC", label: "参照先を失った数式（#REF!）が残っていないか" },

  evaluate(context: RuleContext): Finding[] {
    const locations: string[] = [];
    let occurrences = 0;

    for (const sheet of context.cells.sheets) {
      for (const entry of sheet.errors) {
        if (entry.error !== REF_ERROR) continue;
        occurrences += 1;
        locations.push(cellLocation(sheet.name, entry.ref));
      }
    }

    const brokenNames = context.container.definedNames.filter((definedName) =>
      definedName.formula.includes(REF_ERROR),
    );
    occurrences += brokenNames.length;
    for (const definedName of brokenNames) {
      locations.push(`名前定義「${definedName.name}」`);
    }

    if (occurrences === 0) return [];

    const parts: string[] = [];
    const cellCount = occurrences - brokenNames.length;
    if (cellCount > 0) parts.push(`セル ${cellCount} 件`);
    if (brokenNames.length > 0) parts.push(`名前の定義 ${brokenNames.length} 件`);

    return [
      {
        ruleId: "REF_ERROR",
        severity: "RED",
        title: "参照先が見つからなくなっている箇所があります",
        detail:
          `計算の参照先が失われていることを示す表示（#REF!）が ${parts.join("・")} で見つかりました。` +
          "参照していた行・列・シートが削除されたときに発生します。",
        locations: limitLocations(locations),
        occurrences,
        impact:
          "その箇所の計算結果は正しい値になりません。合計や集計に含まれている場合、" +
          "ほかの数値まで誤ったまま使われている可能性があります。",
      },
    ];
  },
};
