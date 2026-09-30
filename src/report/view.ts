// 画面描画。
//
// ★ ファイル由来の文字列（シート名・列名など）を DOM に入れるのは textContent 経由のみ。
// innerHTML / insertAdjacentHTML / outerHTML は使わない（CLAUDE.md ★節）。
// ビルド時に scripts/verify-artifact.mjs が成果物を検査して機械的に担保している。

import type { AnalysisResult } from "../analysis";
import { buildCheckGroups, countCheckItems } from "../rules/checklist";
import type { Finding } from "../rules/types";
import { CONTACT_NOTE, CONTACT_URL } from "./branding";
import { formatDigest } from "../worker/digest";
import { overallComment } from "./export";

const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  RED: "要対応",
  YELLOW: "注意",
  GREEN: "良好",
  INFO: "参考",
};

export function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function findingElement(finding: Finding): HTMLElement {
  const section = element("section", `finding ${finding.severity.toLowerCase()}`);

  const title = element("h3");
  title.append(element("span", "badge", SEVERITY_LABEL[finding.severity]));
  title.append(document.createTextNode(finding.title));

  section.append(title, element("p", undefined, finding.detail));
  section.append(element("p", "impact", `放置した場合: ${finding.impact}`));

  if (finding.locations.length > 0) {
    const suffix =
      finding.occurrences > finding.locations.length ? `　ほか（全 ${finding.occurrences} 件）` : "";
    section.append(
      element("p", "loc", `該当箇所: ${finding.locations.join(" / ")}${suffix}`),
    );
  }

  return section;
}

export interface ResultActions {
  onSaveHtml: () => void;
  onSaveJson: () => void;
  onReset: () => void;
}

/** 結果サマリ + 詳細 + 出力（引き継ぎ書 §6.1 の [3][4][5]）。 */
/**
 * 「確認した項目」。
 *
 * ★ 検出が0件のときにこそ効く。「問題は検出されませんでした」だけでは、
 * 何を見たうえでの0件なのかが伝わらず、診断の価値そのものが疑われる。
 *
 * 一覧は src/rules/checklist.ts が**登録されているルールから組み立てる**ので、
 * ルールを足せばここにも出る。固定文言を書かないこと。
 *
 * ★ DOM 挿入は textContent 経由のみ（CLAUDE.md の★節）。element() が担保している。
 */
function checkedItemsSection(result: AnalysisResult): HTMLElement {
  const wrapper = element("section", "checked");
  const groups = buildCheckGroups();

  wrapper.append(element("h2", undefined, "確認した項目"));
  wrapper.append(
    element(
      "p",
      "lead",
      `次の ${countCheckItems()} 項目を確認しました。` +
        "検出されなかった項目は、この診断の範囲では問題が見つからなかったことを示します。",
    ),
  );

  for (const group of groups) {
    wrapper.append(element("h3", undefined, group.label));
    const list = element("ul", "checked-list");
    for (const item of group.items) {
      const entry = element("li", undefined, item.label);
      // 確認しきれなかった項目には印を付ける。黙って「確認済み」に混ぜない。
      if (result.limitations.some((note) => note.ruleIds.includes(item.ruleId))) {
        entry.append(element("span", "partial", "（一部のみ）"));
      }
      list.append(entry);
    }
    wrapper.append(list);
  }

  if (result.limitations.length > 0) {
    wrapper.append(element("h3", undefined, "確認しきれなかった範囲"));
    const list = element("ul", "limitations");
    for (const note of result.limitations) list.append(element("li", undefined, note.reason));
    wrapper.append(list);
  }

  return wrapper;
}

export function renderResult(result: AnalysisResult, actions: ResultActions): HTMLElement {
  const container = element("div");

  container.append(element("h2", undefined, "診断結果"));
  container.append(
    element(
      "p",
      "lead",
      `対象: ${result.file.name}（${result.file.sizeBytes.toLocaleString("ja-JP")} バイト）`,
    ),
  );

  // 指紋。どのファイルに対する結果かを後から特定するために出す（docs/operations.md）。
  if (result.file.sha256 !== undefined) {
    container.append(
      element("p", "digest", `ファイルの指紋（SHA-256）: ${formatDigest(result.file.sha256)}`),
    );
  }

  const summary = element("div", "summary");
  const red = element("div", "red");
  red.append(element("strong", undefined, String(result.summary.red)), document.createTextNode("要対応"));
  const yellow = element("div", "yellow");
  yellow.append(element("strong", undefined, String(result.summary.yellow)), document.createTextNode("注意"));
  summary.append(red, yellow);
  container.append(summary);

  container.append(element("p", undefined, overallComment(result)));

  const problems = result.findings.filter((finding) => finding.severity !== "INFO");
  if (problems.length > 0) {
    container.append(element("h2", undefined, "検出された項目"));
    for (const finding of problems) container.append(findingElement(finding));
  }

  container.append(checkedItemsSection(result));

  const metrics = result.findings.filter((finding) => finding.severity === "INFO");
  if (metrics.length > 0) {
    container.append(element("h2", undefined, "基礎指標"));
    const list = element("ul", "metrics");
    for (const finding of metrics) {
      list.append(element("li", undefined, `${finding.title}: ${finding.detail}`));
    }
    container.append(list);
  }

  container.append(element("h2", undefined, "結果の保存"));
  container.append(
    element(
      "p",
      "lead",
      "保存するファイルには、元のファイルのセル値・数式・保存場所は含まれません。",
    ),
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

/**
 * 問い合わせリンク付きの案内ブロック。
 * Access のように「このツールでは扱えないが、相談は受けられる」ものに使う
 * （引き継ぎ書 §8 R-2 の選択肢B）。
 */
export function noticeWithContact(message: string): HTMLElement {
  const box = element("div", "notice");
  box.append(element("p", undefined, message));

  // URL を持たない版（ココナラ向けなど）では、リンクではなく案内文を出す。
  if (CONTACT_URL === null) {
    box.append(element("p", undefined, CONTACT_NOTE));
  } else {
    const line = element("p");
    const link = document.createElement("a");
    link.href = CONTACT_URL;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "お問い合わせフォーム";
    line.append(document.createTextNode("ご相談: "), link);
    box.append(line);
  }

  return box;
}
