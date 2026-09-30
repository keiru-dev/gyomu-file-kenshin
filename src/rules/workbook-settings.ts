// CIRCULAR_REF / MANUAL_CALC_MODE: ブック全体の計算設定。
//
// ★ CIRCULAR_REF の重大度について
// 引き継ぎ書 §5.3 の一覧では RED に分類されているが、同 §8 R-3 は
// 「Phase 1 では設定レベルの検出にとどめ、YELLOW 扱いにするのが妥当」としている。
// 実際に循環しているセルを特定するには数式の依存グラフ構築が必要で、Phase 1 では過剰実装。
// 「反復計算が有効」は循環参照の存在を意味せず（意図した反復計算の場合もある）、
// RED（すでに壊れている）とは言い切れないため、より具体的な §8 R-3 に従って YELLOW とした。
// **2026-08-16 開発者承認済み。** 引き継ぎ書 §5.3 の一覧より §8 R-3 を優先する。

import type { Finding, Rule, RuleContext } from "./types";

export const circularRefRule: Rule = {
  id: "CIRCULAR_REF",
  check: { category: "BROKEN_CALC", label: "計算を繰り返す設定（反復計算）が有効になっていないか" },

  evaluate(context: RuleContext): Finding[] {
    if (!context.container.calc.iterate) return [];

    return [
      {
        ruleId: "CIRCULAR_REF",
        severity: "YELLOW",
        title: "計算を繰り返す設定が有効になっています",
        detail:
          "計算が自分自身を参照していてもエラーとして止めず、繰り返し計算する設定（反復計算）が" +
          "有効になっています。この設定は、意図して使われている場合もあります。",
        locations: [],
        occurrences: 1,
        impact:
          "意図しない参照の循環が含まれている場合、計算が途中で打ち切られ、" +
          "正しい値になっていない可能性があります。設定の理由が引き継がれていないと、" +
          "数値が合わない原因を突き止めるのが難しくなります。",
      },
    ];
  },
};

export const manualCalcModeRule: Rule = {
  id: "MANUAL_CALC_MODE",
  check: { category: "BROKEN_CALC", label: "計算方法が「手動」のままになっていないか" },

  evaluate(context: RuleContext): Finding[] {
    if (context.container.calc.calcMode !== "manual") return [];

    return [
      {
        ruleId: "MANUAL_CALC_MODE",
        severity: "YELLOW",
        title: "計算方法が「手動」に設定されています",
        detail:
          "数値を入力し直しても、再計算の操作をするまで結果が更新されない設定になっています。" +
          "計算に時間がかかるブックで、動作を軽くするために使われることがあります。",
        locations: [],
        occurrences: 1,
        impact:
          "更新のし忘れに気づかないまま、古い計算結果を印刷・提出してしまうことがあります。" +
          "画面上はエラーにならないため、間違いに気づく手がかりがありません。",
      },
    ];
  },
};
