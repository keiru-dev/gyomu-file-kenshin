// 検出ルールの共通型（引き継ぎ書 §5.1 / §5.2）。
//
// ★ Finding に載せてよい情報の範囲（引き継ぎ書 §7-2、§5.4）
//
//   載せてよい : ruleId / セル参照（"C15"）/ シート名 / 列名 / 件数 / 日付 / ファイル名
//   載せてはならない:
//     - セル値（2行目以降の内容）… そもそも L2 が保持していない
//     - 数式文字列 … 顧客由来の文字列リテラルが埋まっていることがある
//     - ファイルパス … 外部参照先のパス、接続文字列、接続名を含む
//
// ファイル名だけは引き継ぎ書 §6.4 の JSON スキーマが明示的に許可している（パスは不可）。

import type { ContainerInfo } from "../worker/container";
import type { WorkbookCells } from "../worker/cells";

/** 信号機式の重大度。表示ラベルに英語を出さないこと（引き継ぎ書 §5.1 / §6.2）。 */
export type Severity = "RED" | "YELLOW" | "GREEN" | "INFO";

/**
 * 「確認した項目」のまとまり。
 *
 * ★ 申し込み用LP（site/src/pages/index.astro）の6観点と同じ区分にしてある。
 * 商談で見せた枠組みと、納品するレポートの枠組みがずれると、説明のたびに
 * 対応を取り直すことになる。**片方を変えるならもう片方も変えること。**
 */
export type CheckCategory =
  | "BROKEN_CALC"
  | "HIDDEN"
  | "OUTBOUND"
  | "PII"
  | "FRAGILE"
  | "HANDOVER";

/** 表示名。英語のキーを画面に出さないための対応表。 */
export const CHECK_CATEGORY_LABEL: Record<CheckCategory, string> = {
  BROKEN_CALC: "壊れている計算",
  HIDDEN: "見えていないもの",
  OUTBOUND: "外に出ている可能性",
  PII: "個人情報らしき列",
  FRAGILE: "壊れやすい作り",
  HANDOVER: "引き継ぎの難しさ",
};

/** 表示順。LP の並びに合わせる。 */
export const CHECK_CATEGORY_ORDER: CheckCategory[] = [
  "BROKEN_CALC",
  "HIDDEN",
  "OUTBOUND",
  "PII",
  "FRAGILE",
  "HANDOVER",
];

export interface Finding {
  /** 例: "EXT_LINK_PRESENT" */
  ruleId: string;
  severity: Severity;
  /** 日本語・非エンジニアに通じる表現。 */
  title: string;
  /** 何が問題か。専門用語を避ける。 */
  detail: string;
  /** 例: ["集計表!C15", "名簿!A列（氏名）"]。最大 20 件。 */
  locations: string[];
  /** 総検出数（locations が打ち切られていても正確な値）。 */
  occurrences: number;
  /** 放置した場合に何が起きるか。 */
  impact: string;
}

export interface RuleContext {
  /** L1: コンテナ層の読み取り結果。 */
  container: ContainerInfo;
  /** L2: セル層の読み取り結果。 */
  cells: WorkbookCells;
  /** ファイル名のみ（パスは含めない）。 */
  fileName: string;
  fileSizeBytes: number;
  /**
   * 判定の基準日時。
   * 「最終更新から N 日以上」の判定に使う。テストが実行日に依存しないよう、
   * 呼び出し側から必ず注入する（内部で new Date() を呼ばない）。
   */
  now: Date;
}

export interface Rule {
  id: string;
  /**
   * 顧客向けの「何を確認したか」。**検出が0件のときにこそ効く**（診断した事実を示せる）。
   *
   * - `informational` なルール以外は必須。テストで機械的に検査している
   *   （tests/checklist.test.ts）。新しいルールを、何を見るか書かずに追加できない
   * - 文言は非エンジニアが読む前提。ルール名の直訳にしない
   * - **検出時の文言ではなく、検出しなかったときにも成り立つ書き方にする**
   *   （「〜がないか」であって「〜があります」ではない）
   */
  check?: { category: CheckCategory; label: string };
  /**
   * 検出結果を返す。検出しなければ空配列。
   * 1つのルールが複数の Finding を返してよい（INFO の基礎指標など）。
   */
  evaluate(context: RuleContext): Finding[];
  /**
   * 参考値を出すだけで、検出/非検出という性質を持たないルール（INFO 群）。
   * 「各ルールについて検出・非検出の両方をフィクスチャで検証する」対象から外れる。
   */
  informational?: boolean;
}
