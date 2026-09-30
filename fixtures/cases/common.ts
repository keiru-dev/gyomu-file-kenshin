// ケース間で使い回す、当たり障りのないシート定義。
// C-4: すべて架空。ありふれた語のみを使い、業種特有の用語は入れない。

import { FIXTURE_SENTINEL, type SheetSpec } from "../ooxml";

/** 欠陥を含まない、ごく普通のシート。どのケースでも1枚目に置く。 */
export function baseSheet(name = "集計表"): SheetSpec {
  return {
    name,
    cells: [
      { ref: "A1", value: "項目" },
      { ref: "B1", value: "数量" },
      { ref: "A2", value: `品目1 ${FIXTURE_SENTINEL}` },
      { ref: "B2", value: "10" },
      { ref: "A3", value: "品目2" },
      { ref: "B3", value: "20" },
      { ref: "B4", formula: "SUM(B2:B3)" },
    ],
  };
}

/** 個人情報らしき列名のヘッダ行。PII 検出の再現に使う（値は入れず、列名だけ）。 */
export const PII_HEADERS: readonly string[] = [
  "氏名",
  "住所",
  "電話番号",
  "メールアドレス",
  "生年月日",
];

/** 個人情報を思わせない、一般的なヘッダ行。 */
export const PLAIN_HEADERS: readonly string[] = ["区分", "数量", "単価", "金額", "備考"];

const COLUMN_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** ヘッダ行を1行目のセル定義に変換する。 */
export function headerRow(headers: readonly string[]): { ref: string; value: string }[] {
  return headers.map((header, index) => {
    const letter = COLUMN_LETTERS[index];
    if (letter === undefined) throw new Error("ヘッダ列が多すぎます");
    return { ref: `${letter}1`, value: header };
  });
}
