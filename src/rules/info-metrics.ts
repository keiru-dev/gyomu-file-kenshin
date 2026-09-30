// INFO: 基礎指標（引き継ぎ書 §5.3 の INFO 群）。
//
// 問題の指摘ではなく、規模と複雑度を把握するための参考値。
// このルールだけは検出/非検出という性質を持たないため、レジストリ側で informational として扱う。
//
// ★ ファイル名は引き継ぎ書 §6.4 の JSON スキーマが明示的に許可しているが（パスは不可）、
// ここでは指標に含めない。ファイル名は Finding ではなくレポートのヘッダ側で扱う。

import { functionNamesOf } from "./helpers";
import type { Finding, Rule, RuleContext } from "./types";

function metric(ruleId: string, title: string, detail: string, occurrences: number): Finding {
  return {
    ruleId,
    severity: "INFO",
    title,
    detail,
    locations: [],
    occurrences,
    impact: "参考値です。対応が必要なものではありません。",
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} バイト`;
}

/** ISO 8601 を "2015年6月30日" 形式にする。解釈できなければ undefined。 */
function formatDate(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return undefined;
  const date = new Date(parsed);
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

export const infoMetricsRule: Rule = {
  id: "INFO_METRICS",

  evaluate(context: RuleContext): Finding[] {
    const { container, cells } = context;

    const functionNames = new Set<string>();
    for (const sheet of cells.sheets) {
      for (const entry of sheet.formulas) {
        for (const name of functionNamesOf(entry.formula)) functionNames.add(name);
      }
    }

    const findings: Finding[] = [
      metric(
        "INFO_SHEET_COUNT",
        "シートの数",
        `${container.sheets.length} 枚のシートがあります。`,
        container.sheets.length,
      ),
      metric(
        "INFO_CELL_COUNT",
        "入力されているセルの数",
        `値または数式が入っているセルは ${cells.totalCellCount.toLocaleString("ja-JP")} 個です。`,
        cells.totalCellCount,
      ),
      metric(
        "INFO_FORMULA_COUNT",
        "数式の数",
        `計算式が入っているセルは ${cells.totalFormulaCount.toLocaleString("ja-JP")} 個です。`,
        cells.totalFormulaCount,
      ),
      metric(
        "INFO_FUNCTION_VARIETY",
        "使われている関数の種類",
        `${functionNames.size} 種類の関数が使われています。`,
        functionNames.size,
      ),
      metric(
        "INFO_DEFINED_NAME_COUNT",
        "名前の定義の数",
        `セル範囲につけられた名前が ${container.definedNames.length} 件あります。`,
        container.definedNames.length,
      ),
      metric(
        "INFO_FILE_SIZE",
        "ファイルの大きさ",
        `${formatBytes(context.fileSizeBytes)} です。`,
        context.fileSizeBytes,
      ),
    ];

    const modified = formatDate(container.docProps?.modified);
    if (modified !== undefined) {
      findings.push(metric("INFO_LAST_MODIFIED", "最後に更新された日", `${modified} です。`, 1));
    }

    return findings;
  },
  informational: true,
};
