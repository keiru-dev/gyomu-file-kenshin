// EXT_LINK_PRESENT / EXT_LINK_BROKEN: 他ブックへの外部参照。
//
// ★ 参照先のパスは Finding に載せない（引き継ぎ書 §7-2 が「ファイルパス」を明示的に禁止）。
// パスには取引先名や部署名が含まれていることが多く、レポートを他者に渡した時点で漏れる。
// 件数と種別だけを伝え、そのことをレポート上でも明示する（黙って省くと不親切なため）。

import { classifyExternalPath } from "./helpers";
import type { Finding, Rule, RuleContext } from "./types";

export const externalLinkPresentRule: Rule = {
  id: "EXT_LINK_PRESENT",
  check: { category: "BROKEN_CALC", label: "ほかのExcelファイルを参照していないか" },

  evaluate(context: RuleContext): Finding[] {
    const count = context.container.externalLinks.length;
    if (count === 0) return [];

    return [
      {
        ruleId: "EXT_LINK_PRESENT",
        severity: "RED",
        title: "ほかのExcelファイルを参照しています",
        detail:
          `このブックは、別のExcelファイルの値を参照しています（${count} 件）。` +
          "参照先の場所は、情報保護のためこのレポートには記載していません。",
        locations: [],
        occurrences: count,
        impact:
          "参照先のファイルが移動・改名・削除されると、計算結果が失われます。" +
          "参照先が開かれていない間は古い値が表示され続けるため、気づかないまま使われることがあります。",
      },
    ];
  },
};

export const externalLinkBrokenRule: Rule = {
  id: "EXT_LINK_BROKEN",
  check: { category: "BROKEN_CALC", label: "参照先が特定の保存場所に固定されていないか" },

  evaluate(context: RuleContext): Finding[] {
    const kinds = context.container.externalLinks.map((link) => classifyExternalPath(link.target));
    const uncCount = kinds.filter((kind) => kind === "unc").length;
    const absoluteCount = kinds.filter((kind) => kind === "absolute").length;
    const occurrences = uncCount + absoluteCount;
    if (occurrences === 0) return [];

    const breakdown: string[] = [];
    if (uncCount > 0) breakdown.push(`共有フォルダを直接指すもの ${uncCount} 件`);
    if (absoluteCount > 0) breakdown.push(`特定のパソコン内の場所を指すもの ${absoluteCount} 件`);

    return [
      {
        ruleId: "EXT_LINK_BROKEN",
        severity: "RED",
        title: "参照先が特定の場所に固定されています",
        detail:
          `ほかのファイルへの参照のうち ${occurrences} 件が、決まった保存場所を直接指しています` +
          `（${breakdown.join("・")}）。参照先の場所は、情報保護のためこのレポートには記載していません。`,
        locations: [],
        occurrences,
        impact:
          "その場所にアクセスできない環境でファイルを開くと、値を取得できません。" +
          "別のパソコンに渡したときや、共有フォルダの構成が変わったときに動かなくなります。",
      },
    ];
  },
};
