// PII_COLUMN_UNPROTECTED: 個人情報らしき列名があり、かつシート保護が無い。
//
// 引き継ぎ書 §5.4 の設計上の注意:
//   - 誤検知は許容する。**「該当する可能性があります」にとどめ、断定しない**
//   - 検出した値そのものは画面にもレポートにも一切出さない。**列名と列位置のみ**を示す
//
// このルールは営業上「このファイル、メールで送っていませんか？」という会話の入口になる。
// 重要度が高いので、実装品質を落とさないこと。

import { limitLocations, looksLikePiiHeader } from "./helpers";
import type { Finding, Rule, RuleContext } from "./types";

export const piiColumnUnprotectedRule: Rule = {
  id: "PII_COLUMN_UNPROTECTED",
  check: { category: "PII", label: "個人情報にあたる可能性のある列があり、保護されていない状態でないか" },

  evaluate(context: RuleContext): Finding[] {
    // シート保護の有無は L1 側が持っているため、シート名で突き合わせる。
    const protectedSheets = new Set(
      context.container.sheets.filter((sheet) => sheet.isProtected).map((sheet) => sheet.name),
    );

    const locations: string[] = [];
    const sheetNames = new Set<string>();

    for (const sheet of context.cells.sheets) {
      if (protectedSheets.has(sheet.name)) continue;
      for (const header of sheet.headers) {
        if (!looksLikePiiHeader(header.text)) continue;
        // 列名と列位置のみ。値は出さない。
        locations.push(`${sheet.name}!${header.column}列（${header.text}）`);
        sheetNames.add(sheet.name);
      }
    }

    if (locations.length === 0) return [];

    return [
      {
        ruleId: "PII_COLUMN_UNPROTECTED",
        severity: "RED",
        title: "個人情報にあたる可能性のある列があります",
        detail:
          `個人情報を思わせる列名が ${locations.length} 件見つかりました（${sheetNames.size} シート）。` +
          "これらのシートには、内容を変更できないようにする保護が設定されていません。" +
          "列名から推測したものであり、実際に個人情報が入力されているとは限りません。",
        locations: limitLocations(locations),
        occurrences: locations.length,
        impact:
          "個人情報が含まれている場合、ファイルをそのまま共有・送付すると、" +
          "意図した範囲を超えて情報が伝わる可能性があります。" +
          "保護が無いため、内容を書き換えられても気づきにくい状態です。",
      },
    ];
  },
};
