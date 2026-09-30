// HIDDEN_SHEET: 非表示 / 完全非表示（veryHidden）シート。
//
// 文言の方針（引き継ぎ書 §5.2 / §6.2）:
// 読むのは非エンジニアで、多くの場合「自分が作ったわけではないファイル」を診断される立場にある。
// 責めない・煽らない・断定しない。専門用語は括弧で補う程度にとどめる。

import { limitLocations } from "./helpers";
import type { Finding, Rule, RuleContext } from "./types";

export const hiddenSheetRule: Rule = {
  id: "HIDDEN_SHEET",
  check: { category: "HIDDEN", label: "画面に表示されないシートがないか" },

  evaluate(context: RuleContext): Finding[] {
    const hidden = context.container.sheets.filter((sheet) => sheet.state !== "visible");
    if (hidden.length === 0) return [];

    const veryHiddenCount = hidden.filter((sheet) => sheet.state === "veryHidden").length;

    const detail =
      veryHiddenCount > 0
        ? `通常の操作では表示されないシートが ${hidden.length} 枚あります。` +
          `そのうち ${veryHiddenCount} 枚は、Excel の画面から再表示する操作ができない設定になっています。`
        : `通常の操作では表示されないシートが ${hidden.length} 枚あります。`;

    return [
      {
        ruleId: "HIDDEN_SHEET",
        severity: "YELLOW",
        title: "画面に表示されないシートがあります",
        detail,
        locations: limitLocations(hidden.map((sheet) => sheet.name)),
        occurrences: hidden.length,
        impact:
          "隠れたシートに計算や一覧が置かれている場合、存在に気づかないまま修正して" +
          "集計が合わなくなることがあります。担当者が交代したときに、そのシートの役割が" +
          "分からなくなりやすい状態です。",
      },
    ];
  },
};
