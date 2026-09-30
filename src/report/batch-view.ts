// 一括スキャン結果の描画。
//
// ★ 描画は textContent / createElement のみ。ファイル名は顧客由来の未信頼文字列である。

import type { BatchEntry, BatchResult } from "../batch";
import { sortBySeverity } from "../batch";
import { element, noticeWithContact } from "./view";
import { ACCESS_NOTICE } from "./branding";

const STATUS_LABEL: Record<BatchEntry["status"], string> = {
  done: "",
  unsupported: "対象外",
  error: "読み取れず",
};

/** Access は「対象外」ではなく、相談を受けられるものとして見せる。 */
function skipLabel(entry: BatchEntry): string {
  if (entry.reason === "access") return "Accessファイル";
  return STATUS_LABEL[entry.status];
}

/** 一覧の1行。要対応が多いファイルほど上に来る。 */
function entryRow(entry: BatchEntry, onSelect: (entry: BatchEntry) => void): HTMLElement {
  const row = element("tr");

  const name = element("td");
  if (entry.status === "done") {
    const button = element("button", "link", entry.fileName) as HTMLButtonElement;
    button.type = "button";
    button.addEventListener("click", () => onSelect(entry));
    name.append(button);
  } else {
    name.append(document.createTextNode(entry.fileName));
  }
  row.append(name);

  if (entry.status === "done") {
    const red = entry.result?.summary.red ?? 0;
    const yellow = entry.result?.summary.yellow ?? 0;
    row.append(element("td", red > 0 ? "count red" : "count", String(red)));
    row.append(element("td", yellow > 0 ? "count yellow" : "count", String(yellow)));
  } else {
    const note = element("td", "note", skipLabel(entry));
    note.setAttribute("colspan", "2");
    row.append(note);
  }

  return row;
}

export interface BatchActions {
  onSelect: (entry: BatchEntry) => void;
  onSaveHtml: () => void;
  onSaveJson: () => void;
  onReset: () => void;
}

/** 一括スキャンの総括 + ファイル一覧。 */
export function renderBatchResult(result: BatchResult, actions: BatchActions): HTMLElement {
  const container = element("div");

  container.append(element("h2", undefined, "一括診断の結果"));
  container.append(
    element(
      "p",
      "lead",
      `${result.summary.files} ファイルを確認し、${result.summary.analyzed} ファイルを診断しました` +
        (result.summary.skipped > 0 ? `（${result.summary.skipped} ファイルは対象外）` : "") +
        "。",
    ),
  );

  const summary = element("div", "summary");
  const red = element("div", "red");
  red.append(
    element("strong", undefined, String(result.summary.red)),
    document.createTextNode("要対応（合計）"),
  );
  const yellow = element("div", "yellow");
  yellow.append(
    element("strong", undefined, String(result.summary.yellow)),
    document.createTextNode("注意（合計）"),
  );
  summary.append(red, yellow);
  container.append(summary);

  const withFindings = result.files.filter(
    (entry) => entry.status === "done" && (entry.result?.summary.red ?? 0) > 0,
  ).length;
  container.append(
    element(
      "p",
      undefined,
      withFindings > 0
        ? `対応をご検討いただきたい項目を含むファイルが ${withFindings} 件あります。ファイル名を選ぶと内訳が見られます。`
        : "対応をご検討いただきたい項目は見つかりませんでした。ファイル名を選ぶと内訳が見られます。",
    ),
  );

  const table = element("table", "batch");
  const head = element("thead");
  const headRow = element("tr");
  headRow.append(element("th", undefined, "ファイル"), element("th", undefined, "要対応"), element("th", undefined, "注意"));
  head.append(headRow);

  const body = element("tbody");
  for (const entry of sortBySeverity(result.files)) body.append(entryRow(entry, actions.onSelect));

  table.append(head, body);
  container.append(table);

  // Access が混ざっていたら、突き放さずに相談の導線を出す（§8 R-2 の選択肢B）。
  if (result.files.some((entry) => entry.reason === "access")) {
    container.append(noticeWithContact(ACCESS_NOTICE));
  }

  container.append(element("h2", undefined, "結果の保存"));
  container.append(
    element("p", "lead", "保存するファイルには、元のファイルのセル値・数式・保存場所は含まれません。"),
  );

  const actionRow = element("div", "actions");
  const saveHtml = element("button", "primary", "レポートを保存") as HTMLButtonElement;
  saveHtml.type = "button";
  saveHtml.addEventListener("click", actions.onSaveHtml);

  const saveJson = element("button", undefined, "JSONで保存") as HTMLButtonElement;
  saveJson.type = "button";
  saveJson.addEventListener("click", actions.onSaveJson);

  const reset = element("button", undefined, "別のファイルを診断") as HTMLButtonElement;
  reset.type = "button";
  reset.addEventListener("click", actions.onReset);

  actionRow.append(saveHtml, saveJson, reset);
  container.append(actionRow);

  return container;
}
