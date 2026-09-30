// MERGED_CELL_HEAVY / PROTECTED_WITH_PASSWORD: シートの構造と保護。

import { limitLocations } from "./helpers";
import { THRESHOLDS } from "./thresholds";
import type { Finding, Rule, RuleContext } from "./types";

export const mergedCellHeavyRule: Rule = {
  id: "MERGED_CELL_HEAVY",
  check: { category: "FRAGILE", label: "セルの結合が多く使われていないか" },

  evaluate(context: RuleContext): Finding[] {
    const heavySheets = context.container.sheets.filter(
      (sheet) => sheet.mergedCellCount >= THRESHOLDS.mergedCellsPerSheet,
    );
    if (heavySheets.length === 0) return [];

    const total = heavySheets.reduce((sum, sheet) => sum + sheet.mergedCellCount, 0);

    return [
      {
        ruleId: "MERGED_CELL_HEAVY",
        severity: "YELLOW",
        title: "セルの結合が多く使われています",
        detail:
          `セルを結合した箇所が多いシートが ${heavySheets.length} 枚あります（合計 ${total} 件）。` +
          "帳票の見た目を整えるために使われることが多い作りです。",
        locations: limitLocations(
          heavySheets.map((sheet) => `${sheet.name}（${sheet.mergedCellCount} 件）`),
        ),
        occurrences: total,
        impact:
          "結合されたセルがあると、並べ替え・絞り込み・自動集計が正しく動きません。" +
          "後からデータとして活用したり、別のしくみへ移したりするときに、" +
          "まず結合を解く作業から始めることになります。",
      },
    ];
  },
};

export const protectedWithPasswordRule: Rule = {
  id: "PROTECTED_WITH_PASSWORD",
  check: { category: "HIDDEN", label: "パスワードで保護されて中身を確認できないシートがないか" },

  evaluate(context: RuleContext): Finding[] {
    const locked = context.container.sheets.filter((sheet) => sheet.hasPasswordProtection);
    if (locked.length === 0) return [];

    return [
      {
        ruleId: "PROTECTED_WITH_PASSWORD",
        severity: "YELLOW",
        title: "パスワードで保護されたシートがあります",
        detail:
          `内容を変更できないよう、パスワード付きで保護されたシートが ${locked.length} 枚あります。` +
          "このツールはパスワードの解除や取得は行いません。",
        locations: limitLocations(locked.map((sheet) => sheet.name)),
        occurrences: locked.length,
        impact:
          "パスワードを知っている方が異動・退職している場合、修正が必要になっても変更できません。" +
          "作り直しが必要になることがあります。",
      },
    ];
  },
};
