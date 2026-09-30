// VBA ソースの静的解析にかかるルール（Phase 2-C）。
//
// ★ VBA ソースは顧客の業務ロジックそのもの。数式以上に機微であり、**Finding には
// 件数と類型しか載せない**（引き継ぎ書 §7-2）。該当行の内容・行番号・モジュール名も出さない。
// 解析層（src/worker/vba.ts）がそもそも件数しか返さない設計なので、ここで漏らしようがない。
//
// 重大度の割り当て（2026-08-16 開発者承認）:
//   RED    … 外部通信 / シェル実行 / パスワード直書き（情報漏洩・任意コード実行にあたる）
//   YELLOW … ファイル操作 / 外部DB接続 / 自動実行（壊れやすさ・把握されていない挙動）

import type { VbaCodeSignals } from "../worker/vba";
import type { CheckCategory, Finding, Rule, RuleContext, Severity } from "./types";

interface VbaRuleSpec {
  id: string;
  signal: keyof VbaCodeSignals;
  severity: Severity;
  title: string;
  detail: (count: number) => string;
  impact: string;
  /** 「確認した項目」に出す文言（types.ts の Rule.check）。 */
  check: { category: CheckCategory; label: string };
}

const SPECS: VbaRuleSpec[] = [
  {
    id: "VBA_NETWORK_ACCESS",
    check: { category: "OUTBOUND", label: "マクロが外部と通信していないか" },
    signal: "network",
    severity: "RED",
    title: "マクロが外部と通信しています",
    detail: (count) =>
      `マクロの中に、インターネットや社内の別システムへ接続する記述が ${count} 箇所あります。` +
      "接続先はこのレポートには記載していません。",
    impact:
      "ブックの中のデータが外部へ送られている可能性があります。" +
      "接続先が停止した場合には、マクロが途中で止まることもあります。" +
      "何をどこへ送っているかが把握されていない場合、まず確認をおすすめします。",
  },
  {
    id: "VBA_SHELL_EXEC",
    check: { category: "OUTBOUND", label: "マクロが外部のプログラムを起動していないか" },
    signal: "shell",
    severity: "RED",
    title: "マクロが外部のプログラムを起動しています",
    detail: (count) =>
      `マクロの中に、別のプログラムやコマンドを起動する記述が ${count} 箇所あります。`,
    impact:
      "ブックを開いた利用者の権限で、Excel の外の処理が実行されます。" +
      "何が起動されるかが把握されていない場合、意図しない動作につながる可能性があります。",
  },
  {
    id: "VBA_HARDCODED_CREDENTIAL",
    check: { category: "OUTBOUND", label: "マクロにパスワードが書かれていないか" },
    signal: "credential",
    severity: "RED",
    // 断定しない（引き継ぎ書 §7-6）。
    title: "マクロにパスワードが書かれている可能性があります",
    detail: (count) =>
      `マクロの中に、パスワードを指定していると見られる記述が ${count} 箇所あります。` +
      "実際の値は、このレポートには記載していません。",
    impact:
      "このファイルを受け取った方が、同じパスワードを知ることができる状態です。" +
      "メールや共有フォルダで配布している場合は、配布範囲をご確認ください。",
  },
  {
    id: "VBA_FILE_ACCESS",
    check: { category: "OUTBOUND", label: "マクロがファイルを読み書きしていないか" },
    signal: "fileAccess",
    severity: "YELLOW",
    title: "マクロがファイルを読み書きしています",
    detail: (count) =>
      `マクロの中に、ファイルの書き出し・削除・保存を行う記述が ${count} 箇所あります。` +
      "対象のファイル名はこのレポートには記載していません。",
    impact:
      "保存先のフォルダ構成が変わると動かなくなります。" +
      "また、意図せず既存のファイルを上書きしてしまう作りになっている場合があります。",
  },
  {
    id: "VBA_EXTERNAL_DB",
    check: { category: "OUTBOUND", label: "マクロが外部のデータベースに接続していないか" },
    signal: "database",
    severity: "YELLOW",
    title: "マクロが外部のデータベースに接続しています",
    detail: (count) =>
      `マクロの中に、データベースへ接続してデータを取り込む記述が ${count} 箇所あります。` +
      "接続先はこのレポートには記載していません。",
    impact:
      "接続先が停止したり権限が変わったりすると、データを取得できなくなります。" +
      "取り込み元が分からないまま運用されている場合、数値の出どころを確認できない状態になります。",
  },
  {
    id: "VBA_AUTO_RUN",
    check: { category: "HIDDEN", label: "ブックを開くと自動で動くマクロがないか" },
    signal: "autoRun",
    severity: "YELLOW",
    title: "ブックを開くと自動で動くマクロがあります",
    detail: (count) =>
      `利用者の操作を待たずに実行される仕掛けが ${count} 箇所あります` +
      "（ブックを開いたとき、閉じるときなど）。",
    impact:
      "開いただけで処理が走るため、内容を確認する前に動作してしまいます。" +
      "何が起きるかが引き継がれていないと、思わぬ変更が加わっていても気づけません。",
  },
];

function buildRule(spec: VbaRuleSpec): Rule {
  return {
    id: spec.id,
    check: spec.check,

    evaluate(context: RuleContext): Finding[] {
      const count = context.container.vba?.signals[spec.signal] ?? 0;
      if (count === 0) return [];

      return [
        {
          ruleId: spec.id,
          severity: spec.severity,
          title: spec.title,
          detail: spec.detail(count),
          // 該当箇所は出さない。行番号やモジュール名から中身が推測されうるため。
          locations: [],
          occurrences: count,
          impact: spec.impact,
        },
      ];
    },
  };
}

export const vbaCodeRules: Rule[] = SPECS.map(buildRule);
