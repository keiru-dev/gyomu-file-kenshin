// レポートの書き出し（自己完結HTML / JSON）とローカル保存。
//
// ★ ここは文字列連結で HTML を組み立てる唯一の場所。
// シート名・列名など**ファイル由来の文字列を必ずエスケープする**（CLAUDE.md ★節）。
// 画面描画側（view.ts）は textContent しか使わないので安全だが、こちらは自前で守る必要がある。
//
// C-3: 保存はユーザーが明示的にボタンを押したときだけ行う。自動保存はしない。

import type { AnalysisResult } from "../analysis";
import { buildCheckGroups, countCheckItems } from "../rules/checklist";
import { sortBySeverity, type BatchResult } from "../batch";
import type { Finding } from "../rules/types";
import {
  ACCESS_NOTICE,
  BUILD_ID,
  CONTACT_NOTE,
  CONTACT_URL,
  COPYRIGHT,
  DEPENDENCY_LICENSES,
  NETWORK_STATEMENT,
  REPORT_TERMS,
  TOOL_NAME,
} from "./branding";

/** 問い合わせ導線の1行。URL を持たない版では案内文だけを出す。 */
function contactHtml(label: string): string {
  if (CONTACT_URL === null) return `<p>${escapeHtml(CONTACT_NOTE)}</p>`;
  return (
    `<p>${escapeHtml(label)}: ` +
    `<a href="${escapeHtml(CONTACT_URL)}" target="_blank" rel="noopener">お問い合わせフォーム</a></p>`
  );
}

/** HTML に埋め込む文字列のエスケープ。未信頼入力を通す前提で必ず使う。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 保存するレポートにも同じ CSP を入れる。顧客が転送した先でも通信しないことを示すため。 */
const REPORT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; " +
  "connect-src 'none'; form-action 'none'; base-uri 'none';";

const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  RED: "要対応",
  YELLOW: "注意",
  GREEN: "良好",
  INFO: "参考",
};

/** 総合判定の1行。責めない・煽らない。 */
export function overallComment(result: AnalysisResult): string {
  const { red, yellow } = result.summary;
  if (red > 0) {
    // 0 件の側をわざわざ書かない（「注意したい項目が 0 件」は読み手に引っかかる）。
    return yellow > 0
      ? `対応をご検討いただきたい項目が ${red} 件、注意したい項目が ${yellow} 件見つかりました。`
      : `対応をご検討いただきたい項目が ${red} 件見つかりました。`;
  }
  if (yellow > 0) {
    return `すぐに壊れる状態ではありませんが、注意したい項目が ${yellow} 件見つかりました。`;
  }
  return "問題は検出されませんでした。";
}

/**
 * 「確認した項目」。画面側（view.ts の checkedItemsSection）と同じ内容を、
 * 保存用HTMLとして組み立てる。
 *
 * ★ ここは文字列連結なので、**ファイル由来でない固定文言であってもエスケープを通す**。
 * 「今は固定だから安全」は、後で可変にしたときに壊れる（CLAUDE.md ★節）。
 */
function checkedItemsHtml(result: AnalysisResult): string {
  const groups = buildCheckGroups()
    .map((group) => {
      const items = group.items
        .map((item) => {
          const partial = result.limitations.some((note) => note.ruleIds.includes(item.ruleId))
            ? '<span class="partial">（一部のみ）</span>'
            : "";
          return `<li>${escapeHtml(item.label)}${partial}</li>`;
        })
        .join("");
      return `<h3>${escapeHtml(group.label)}</h3><ul class="checked-list">${items}</ul>`;
    })
    .join("");

  const limitations =
    result.limitations.length === 0
      ? ""
      : "<h3>確認しきれなかった範囲</h3><ul class=\"limitations\">" +
        result.limitations.map((note) => `<li>${escapeHtml(note.reason)}</li>`).join("") +
        "</ul>";

  return (
    '<section class="checked"><h2>確認した項目</h2>' +
    `<p class="lead">${escapeHtml(
      `次の ${countCheckItems()} 項目を確認しました。` +
        "検出されなかった項目は、この診断の範囲では問題が見つからなかったことを示します。",
    )}</p>` +
    groups +
    limitations +
    "</section>"
  );
}

function findingHtml(finding: Finding): string {
  const locations =
    finding.locations.length === 0
      ? ""
      : `<p class="loc">該当箇所: ${finding.locations.map(escapeHtml).join(" / ")}` +
        (finding.occurrences > finding.locations.length
          ? `　ほか（全 ${finding.occurrences} 件）`
          : "") +
        "</p>";

  return [
    `<section class="finding ${finding.severity.toLowerCase()}">`,
    `<h3><span class="badge">${escapeHtml(SEVERITY_LABEL[finding.severity])}</span>${escapeHtml(finding.title)}</h3>`,
    `<p>${escapeHtml(finding.detail)}</p>`,
    `<p class="impact">放置した場合: ${escapeHtml(finding.impact)}</p>`,
    locations,
    "</section>",
  ].join("");
}

const REPORT_STYLE = `
.checked-list{padding-left:1.2rem;color:#555}
.checked-list li{margin:.2rem 0}
.partial{margin-left:.4rem;font-size:.85em;color:#a35a09}
.limitations{padding-left:1.2rem}

:root { color-scheme: light; }
body { font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
       line-height: 1.8; color: #1a1a1a; background: #fff; margin: 0; padding: 2rem 1.5rem; }
main { max-width: 46rem; margin: 0 auto; }
h1 { font-size: 1.5rem; border-bottom: 2px solid #1a1a1a; padding-bottom: .5rem; }
h2 { font-size: 1.15rem; margin-top: 2.5rem; }
h3 { font-size: 1rem; margin: 0 0 .5rem; }
.meta { color: #555; font-size: .9rem; }
.summary { display: flex; gap: 1.5rem; flex-wrap: wrap; padding: 1rem; background: #f5f5f5; border-radius: .4rem; }
.summary div { font-size: 1rem; }
.summary strong { font-size: 1.6rem; display: block; }
.finding { border-left: 4px solid #ccc; padding: .75rem 1rem; margin: 1rem 0; background: #fafafa; }
.finding.red { border-left-color: #c0392b; }
.finding.yellow { border-left-color: #d68910; }
.finding.info { border-left-color: #7f8c8d; }
.badge { display: inline-block; font-size: .75rem; padding: .1rem .5rem; margin-right: .5rem;
         border-radius: .2rem; background: #ddd; vertical-align: .1rem; }
.finding.red .badge { background: #c0392b; color: #fff; }
.finding.yellow .badge { background: #d68910; color: #fff; }
.impact { color: #444; }
.loc { font-size: .9rem; color: #555; word-break: break-all; }
.digest { font-size: .85rem; color: #555; word-break: break-all; }
.digest code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
footer ul { padding-left: 1.2rem; margin: .25rem 0 .75rem; }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #ddd; font-size: .85rem; color: #555; }
`.trim();

/** 自己完結HTMLレポートを組み立てる。元データは含めない。 */
export function buildReportHtml(result: AnalysisResult): string {
  const problems = result.findings.filter((finding) => finding.severity !== "INFO");
  const metrics = result.findings.filter((finding) => finding.severity === "INFO");

  const licenses = DEPENDENCY_LICENSES.map(
    (dependency) => `${escapeHtml(dependency.name)} ${escapeHtml(dependency.version)}（${escapeHtml(dependency.license)}）`,
  ).join(" / ");

  return [
    "<!doctype html>",
    '<html lang="ja"><head><meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`,
    `<title>${escapeHtml(TOOL_NAME)} レポート</title>`,
    `<style>${REPORT_STYLE}</style>`,
    "</head><body><main>",
    `<h1>${escapeHtml(TOOL_NAME)} レポート</h1>`,
    `<p class="meta">対象ファイル: ${escapeHtml(result.file.name)}（${result.file.sizeBytes.toLocaleString("ja-JP")} バイト）<br>`,
    `作成日時: ${escapeHtml(result.scannedAt)}／ツール ${escapeHtml(result.toolVersion)}／配布識別子 ${escapeHtml(BUILD_ID)}</p>`,
    // 指紋。診断対象の取り違えが無いことの確認に使う（docs/operations.md）。
    result.file.sha256 === undefined
      ? ""
      : `<p class="digest">ファイルの指紋（SHA-256）: <code>${escapeHtml(result.file.sha256)}</code><br>` +
        "同じ内容のファイルであれば同じ値になります。診断したファイルの取り違えが無いことの確認にお使いいただけます。</p>",
    `<p>${escapeHtml(overallComment(result))}</p>`,
    '<div class="summary">',
    `<div>要対応<strong>${result.summary.red}</strong></div>`,
    `<div>注意<strong>${result.summary.yellow}</strong></div>`,
    "</div>",
    problems.length > 0 ? "<h2>検出された項目</h2>" + problems.map(findingHtml).join("") : "",
    checkedItemsHtml(result),
    metrics.length > 0
      ? "<h2>基礎指標</h2><ul>" +
        metrics
          .map((finding) => `<li>${escapeHtml(finding.title)}: ${escapeHtml(finding.detail)}</li>`)
          .join("") +
        "</ul>"
      : "",
    "<footer>",
    `<p>${escapeHtml(NETWORK_STATEMENT)}</p>`,
    `<p>このレポートには、元のファイルのセル値・数式・保存場所は含まれていません。</p>`,
    contactHtml("詳しい診断のご相談"),
    `<p>本レポートの取り扱い:</p><ul>${REPORT_TERMS.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
    `<p>使用ライブラリ: ${licenses}</p>`,
    `<p>${escapeHtml(COPYRIGHT)}　配布識別子 ${escapeHtml(BUILD_ID)}</p>`,
    "</footer></main></body></html>",
  ].join("\n");
}

/** 後段の有償診断へ引き渡すための構造化データ（引き継ぎ書 §6.4）。 */
export function buildReportJson(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}

/** YYYYMMDD 形式。保存ファイル名に使う。 */
function dateStamp(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

export function reportFileName(result: AnalysisResult, extension: "html" | "json"): string {
  return `業務ファイル健診_診断レポート-${dateStamp(result.scannedAt)}.${extension}`;
}

/**
 * ローカルへ書き出す。
 * ネットワークは介さず、メモリ上の Blob をそのままダウンロードさせる。
 */
export function downloadFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // 即座に revoke するとダウンロードが始まらないブラウザがあるため、少し置いてから解放する。
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --- 一括スキャンの書き出し -------------------------------------------------
// 引き継ぎ書 §6.4 は単一ファイル用のスキーマ。一括用は、各ファイルの結果を
// そのまま `files[]` に収める形で包む（単一ファイルのスキーマは変えない）。

/** 一括スキャンの自己完結HTMLレポート。 */
export function buildBatchReportHtml(result: BatchResult): string {
  const rows = sortBySeverity(result.files)
    .map((entry) => {
      if (entry.status !== "done") {
        const label =
          entry.reason === "access" ? "Accessファイル" : entry.status === "unsupported" ? "対象外" : "読み取れず";
        return (
          `<tr><td>${escapeHtml(entry.fileName)}</td>` +
          `<td colspan="2" class="note">${escapeHtml(label)}</td></tr>`
        );
      }
      const red = entry.result?.summary.red ?? 0;
      const yellow = entry.result?.summary.yellow ?? 0;
      return (
        `<tr><td>${escapeHtml(entry.fileName)}</td>` +
        `<td class="${red > 0 ? "red" : ""}">${red}</td>` +
        `<td class="${yellow > 0 ? "yellow" : ""}">${yellow}</td></tr>`
      );
    })
    .join("");

  const details = sortBySeverity(result.files)
    .filter((entry) => entry.status === "done" && (entry.result?.findings.length ?? 0) > 0)
    .map((entry) => {
      const findings = (entry.result?.findings ?? []).filter((finding) => finding.severity !== "INFO");
      if (findings.length === 0) return "";
      const digest = entry.result?.file.sha256;
      return (
        `<h3 class="file">${escapeHtml(entry.fileName)}</h3>` +
        (digest === undefined
          ? ""
          : `<p class="digest">指紋（SHA-256）: <code>${escapeHtml(digest)}</code></p>`) +
        findings.map(findingHtml).join("")
      );
    })
    .join("");

  const licenses = DEPENDENCY_LICENSES.map(
    (dependency) => `${escapeHtml(dependency.name)} ${escapeHtml(dependency.version)}（${escapeHtml(dependency.license)}）`,
  ).join(" / ");

  return [
    "<!doctype html>",
    '<html lang="ja"><head><meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`,
    `<title>${escapeHtml(TOOL_NAME)} 一括レポート</title>`,
    `<style>${REPORT_STYLE}
table.batch { border-collapse: collapse; width: 100%; margin: 1rem 0; }
table.batch th, table.batch td { border-bottom: 1px solid #ddd; padding: .4rem .6rem; text-align: left; }
table.batch td:nth-child(2), table.batch td:nth-child(3),
table.batch th:nth-child(2), table.batch th:nth-child(3) { text-align: right; width: 5rem; }
table.batch .red { color: #c0392b; font-weight: bold; }
table.batch .yellow { color: #d68910; font-weight: bold; }
table.batch .note { color: #777; }
h3.file { margin-top: 2rem; border-bottom: 1px solid #eee; padding-bottom: .3rem; }
</style>`,
    "</head><body><main>",
    `<h1>${escapeHtml(TOOL_NAME)} 一括レポート</h1>`,
    `<p class="meta">対象 ${result.summary.files} ファイル（診断 ${result.summary.analyzed} / 対象外 ${result.summary.skipped}）<br>`,
    `作成日時: ${escapeHtml(result.scannedAt)}／ツール ${escapeHtml(result.toolVersion)}／配布識別子 ${escapeHtml(BUILD_ID)}</p>`,
    // 一括では総括に指紋を出さない。ファイル別の見出し直下にそれぞれ出す。
    '<div class="summary">',
    `<div>要対応（合計）<strong>${result.summary.red}</strong></div>`,
    `<div>注意（合計）<strong>${result.summary.yellow}</strong></div>`,
    "</div>",
    `<h2>ファイル別</h2><table class="batch"><thead><tr><th>ファイル</th><th>要対応</th><th>注意</th></tr></thead><tbody>${rows}</tbody></table>`,
    details ? `<h2>検出された項目</h2>${details}` : "",
    // Access は突き放さず相談の導線にする（引き継ぎ書 §8 R-2 の選択肢B）。
    result.files.some((entry) => entry.reason === "access")
      ? `<h2>Accessのファイルについて</h2><p>${escapeHtml(ACCESS_NOTICE)}</p>` +
        contactHtml("ご相談")
      : "",
    "<footer>",
    `<p>${escapeHtml(NETWORK_STATEMENT)}</p>`,
    `<p>このレポートには、元のファイルのセル値・数式・保存場所は含まれていません。</p>`,
    contactHtml("詳しい診断のご相談"),
    `<p>本レポートの取り扱い:</p><ul>${REPORT_TERMS.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
    `<p>使用ライブラリ: ${licenses}</p>`,
    `<p>${escapeHtml(COPYRIGHT)}　配布識別子 ${escapeHtml(BUILD_ID)}</p>`,
    "</footer></main></body></html>",
  ].join("\n");
}

export function buildBatchReportJson(result: BatchResult): string {
  return JSON.stringify(result, null, 2);
}

export function batchReportFileName(result: BatchResult, extension: "html" | "json"): string {
  return `業務ファイル健診_一括診断レポート-${dateStamp(result.scannedAt)}.${extension}`;
}
