// VBA_PRESENT / AUTHOR_SINGLE_LEGACY / PIVOT_CACHE_STALE: メタデータ・付随パーツ。
//
// ★ 作成者名は Finding に載せない。個人名であり、レポートを共有した時点で当人の情報が広がる。
// 「作成者と最終更新者が同一である」という事実だけを伝えれば足りる。

import { daysBetween } from "./helpers";
import { THRESHOLDS } from "./thresholds";
import type { Finding, Rule, RuleContext } from "./types";

/** 「およそ n KB」の形にする。規模感が伝わればよいので細かい精度は要らない。 */
function approximateSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `およそ ${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `およそ ${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const vbaPresentRule: Rule = {
  id: "VBA_PRESENT",
  check: { category: "HIDDEN", label: "マクロ（VBA）が含まれていないか" },

  evaluate(context: RuleContext): Finding[] {
    if (!context.container.hasVba) return [];

    // ★ モジュール名は Finding に載せない。顧客が付けた名前であり、業務内容を推測させうる。
    // 出すのは種別ごとの件数と、おおよその規模だけ（src/worker/vba.ts の方針と対）。
    const vba = context.container.vba;
    const parts: string[] = [];
    if (vba) {
      if (vba.counts.module > 0) parts.push(`標準モジュール ${vba.counts.module} 本`);
      if (vba.counts.class > 0) parts.push(`クラスモジュール ${vba.counts.class} 本`);
      if (vba.counts.form > 0) parts.push(`ユーザーフォーム ${vba.counts.form} 本`);
      if (vba.counts.document > 0) parts.push(`シートやブックに紐づくもの ${vba.counts.document} 本`);
    }

    const composition =
      parts.length > 0
        ? `内訳は${parts.join("、")}で、全体で${approximateSize(vba?.totalStreamBytes ?? 0)} です。`
        : "";

    return [
      {
        ruleId: "VBA_PRESENT",
        severity: "YELLOW",
        title: "マクロ（VBA）が含まれています",
        detail:
          "自動処理のためのプログラム（マクロ）が保存されています。" +
          composition +
          // Phase 2-B の時点では中身を読んでいない。できていないことを「できる」と書かない。
          "このツールで確認しているのは構成までで、プログラムの中身は解析していません。",
        locations: [],
        occurrences: vba?.streamCount ?? 1,
        impact:
          "マクロの動作が文書として残っていない場合、このファイルが何をしているのかを" +
          "全体として把握できません。作成した方が不在だと、修正も動作確認も難しくなります。",
      },
    ];
  },
};

export const authorSingleLegacyRule: Rule = {
  id: "AUTHOR_SINGLE_LEGACY",
  check: { category: "HANDOVER", label: "ひとりだけが更新してきた状態が続いていないか" },

  evaluate(context: RuleContext): Finding[] {
    const props = context.container.docProps;
    if (!props) return [];

    const { creator, lastModifiedBy } = props;
    if (creator === undefined || lastModifiedBy === undefined) return [];
    if (creator === "" || creator !== lastModifiedBy) return [];

    const days = daysBetween(props.modified, context.now);
    if (days === undefined || days < THRESHOLDS.staleAuthorDays) return [];

    const years = Math.floor(days / 365);

    return [
      {
        ruleId: "AUTHOR_SINGLE_LEGACY",
        severity: "YELLOW",
        title: "ひとりだけが更新してきた状態が続いています",
        detail:
          "作成した方と最後に更新した方が同じで、最後の更新から" +
          `${years} 年以上が経過しています。作成者のお名前は、このレポートには記載していません。`,
        locations: [],
        occurrences: 1,
        impact:
          "作り方や前提が共有されないまま使われてきた可能性があります。" +
          "内容について確認できる方が社内にいない場合、変更が必要になったときに" +
          "一から中身を読み解く必要が出てきます。",
      },
    ];
  },
};

export const pivotCacheStaleRule: Rule = {
  id: "PIVOT_CACHE_STALE",
  check: { category: "BROKEN_CALC", label: "集計表が古いデータの控えを抱えていないか" },

  evaluate(context: RuleContext): Finding[] {
    let staleCount = 0;
    let largeCount = 0;
    let oldestDays = 0;

    for (const cache of context.container.pivotCaches) {
      const days = daysBetween(cache.refreshedDate, context.now);
      const isStale = days !== undefined && days >= THRESHOLDS.pivotCacheStaleDays;
      const isLarge =
        cache.recordCount !== undefined &&
        cache.recordCount >= THRESHOLDS.pivotCacheRecordCount;

      if (isStale) {
        staleCount += 1;
        if (days !== undefined && days > oldestDays) oldestDays = days;
      }
      if (isLarge) largeCount += 1;
    }

    const occurrences = Math.max(staleCount, largeCount);
    if (occurrences === 0) return [];

    const parts: string[] = [];
    if (staleCount > 0) {
      parts.push(`最後の更新から ${Math.floor(oldestDays / 365)} 年以上経過しているもの ${staleCount} 件`);
    }
    if (largeCount > 0) parts.push(`控えのデータが大きいもの ${largeCount} 件`);

    return [
      {
        ruleId: "PIVOT_CACHE_STALE",
        severity: "YELLOW",
        title: "集計表が古いデータの控えを抱えています",
        detail:
          "集計表（ピボットテーブル）は、集計元データの控えをブック内に保存します。" +
          `その控えについて、${parts.join("・")}が見つかりました。`,
        locations: [],
        occurrences,
        impact:
          "画面に表示されている集計が、元データの最新の状態を反映していない可能性があります。" +
          "控えのデータが大きい場合は、ファイルサイズが膨らんで開くのが遅くなる原因にもなります。",
      },
    ];
  },
};
