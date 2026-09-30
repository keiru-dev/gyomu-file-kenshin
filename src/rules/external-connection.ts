// EXTERNAL_CONNECTION / HARDCODED_CREDENTIAL: 外部データ接続と、接続設定内の資格情報。
//
// ★ 接続文字列・接続名・接続先サーバ名は Finding に載せない。
// サーバ名や DB 名は社内構成そのもので、レポートを外部に渡すと構成情報が漏れる。

import type { Finding, Rule, RuleContext } from "./types";

export const externalConnectionRule: Rule = {
  id: "EXTERNAL_CONNECTION",
  check: { category: "OUTBOUND", label: "外部からデータを取り込む設定がないか" },

  evaluate(context: RuleContext): Finding[] {
    const count = context.container.connections.length;
    if (count === 0) return [];

    return [
      {
        ruleId: "EXTERNAL_CONNECTION",
        severity: "RED",
        title: "外部からデータを取り込む設定があります",
        detail:
          `データベースやWebサイトなど、ブックの外からデータを取り込む設定が ${count} 件あります。` +
          "接続先の情報は、情報保護のためこのレポートには記載していません。",
        locations: [],
        occurrences: count,
        impact:
          "接続先が停止したり、権限が変わったりすると、データを取得できなくなります。" +
          "取り込み元が分からないまま運用されている場合、数値の出どころを確認できない状態になります。",
      },
    ];
  },
};

/**
 * 接続文字列にパスワードらしき値が入っているか。
 * `Password=` / `Pwd=` に空でない値が続くものを拾う。
 * `Persist Security Info=True` のような、パスワードではない項目は拾わない。
 */
function containsCredential(connectionString: string): boolean {
  const match = /(?:^|;)\s*(?:password|pwd)\s*=\s*([^;]*)/i.exec(connectionString);
  if (match === null) return false;
  const value = (match[1] ?? "").trim();
  return value !== "";
}

export const hardcodedCredentialRule: Rule = {
  id: "HARDCODED_CREDENTIAL",
  check: { category: "OUTBOUND", label: "接続設定にパスワードが保存されていないか" },

  evaluate(context: RuleContext): Finding[] {
    const count = context.container.connections.filter((connection) =>
      containsCredential(connection.connectionString),
    ).length;
    if (count === 0) return [];

    return [
      {
        ruleId: "HARDCODED_CREDENTIAL",
        severity: "RED",
        // 断定しない（引き継ぎ書 §7-6）。
        title: "接続設定にパスワードが保存されている可能性があります",
        detail:
          `外部データを取り込む設定のうち ${count} 件に、パスワードにあたる項目が値つきで保存されています。` +
          "実際の値は、このレポートには記載していません。",
        locations: [],
        occurrences: count,
        impact:
          "このファイルを受け取った人が、同じ接続先にアクセスできてしまう可能性があります。" +
          "メールや共有フォルダでファイルを配布している場合は、配布範囲をご確認ください。",
      },
    ];
  },
};
