// 画面の進行（引き継ぎ書 §6.1 の [1]〜[5]）。
//
// ランディング → 解析中 → 結果 → 出力。
// ★ DOM 挿入は textContent / createElement のみ。innerHTML 系は使わない（CLAUDE.md ★節）。

import "./styles/app.css";

import type { AnalysisResult } from "./analysis";
import {
  ACCESS_NOTICE,
  BUILD_ID,
  CONTACT_NOTE,
  CONTACT_URL,
  COPYRIGHT,
  DEPENDENCY_LICENSES,
  NETWORK_STATEMENT,
  TERMS,
  TOOL_NAME,
} from "./report/branding";
import {
  batchReportFileName,
  buildBatchReportHtml,
  buildBatchReportJson,
  buildReportHtml,
  buildReportJson,
  downloadFile,
  reportFileName,
} from "./report/export";
import { element, noticeWithContact, renderResult } from "./report/view";
import { renderBatchResult } from "./report/batch-view";
import { runBatch, type BatchEntry, type BatchResult, type RunningBatch } from "./batch";
import { analyzeInWorker, type RunningAnalysis } from "./worker/client";

const app = document.getElementById("app");
if (!app) throw new Error("#app が見つかりません");

let running: RunningAnalysis | undefined;
let batch: RunningBatch | undefined;

function show(...nodes: Node[]): void {
  app!.replaceChildren(...nodes);
}

// --- [1] ランディング ------------------------------------------------------

/** ランディングに出す案内。Access は突き放さず相談の導線にする（§8 R-2 の選択肢B）。 */
type LandingNotice = { kind: "error"; message: string } | { kind: "access" };

function renderLanding(notice?: LandingNotice): void {
  const container = element("div");

  container.append(element("h1", undefined, TOOL_NAME));
  container.append(
    element(
      "p",
      "lead",
      "Excelファイルを読み込むと、見えなくなっている問題を数分で洗い出します。診断のみを行い、ファイルの修正はしません。",
    ),
  );

  // 通信しないことを最も目立つ位置に置く。
  const assurance = element("div", "assurance");
  assurance.append(element("strong", undefined, "このファイルは通信を一切行いません"));
  assurance.append(element("p", undefined, NETWORK_STATEMENT));

  const cspContent =
    document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content") ?? "";
  assurance.append(element("p", undefined, "実際に適用されている設定:"));
  // 画面に出しているのは meta タグから読み取った実物。書き写しではない。
  assurance.append(element("pre", "csp", cspContent.replace(/\s+/g, " ").replace(/; /g, ";\n")));
  container.append(assurance);

  const dropzone = element("div", "dropzone");
  dropzone.append(
    element("p", undefined, "ここに .xlsx / .xlsm ファイルをドラッグするか、下のボタンで選んでください。複数まとめて選べます。"),
  );

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".xlsx,.xlsm";
  fileInput.multiple = true;
  fileInput.addEventListener("change", () => {
    const files = [...(fileInput.files ?? [])];
    if (files.length > 0) void start(files);
  });
  dropzone.append(fileInput);

  // フォルダ選択。webkitdirectory は標準化されていないが主要ブラウザで動く。
  // 型定義に無いため属性で指定する。
  const folderInput = document.createElement("input");
  folderInput.type = "file";
  folderInput.setAttribute("webkitdirectory", "");
  folderInput.setAttribute("directory", "");
  folderInput.addEventListener("change", () => {
    const files = [...(folderInput.files ?? [])];
    if (files.length > 0) void start(files);
  });

  const folderLine = element("p");
  folderLine.append(document.createTextNode("フォルダごと診断する場合: "));
  folderLine.append(folderInput);
  dropzone.append(folderLine);

  container.append(dropzone);

  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("over");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("over");
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length > 0) void start(files);
  });

  if (notice?.kind === "error") {
    container.append(element("div", "error", notice.message));
  } else if (notice?.kind === "access") {
    container.append(noticeWithContact(ACCESS_NOTICE));
  }

  show(container);
}

// --- [2] 解析中 ------------------------------------------------------------

function renderAnalyzing(label: string): {
  update: (stage: string, done: number, total: number) => void;
  setFile: (index: number, total: number, fileName: string) => void;
} {
  const container = element("div");
  container.append(element("h1", undefined, TOOL_NAME));
  const headline = element("p", "lead", `${label} を確認しています。`);
  container.append(headline);

  const progress = element("div", "progress");
  const stageLine = element("p", undefined, "準備しています…");
  const bar = element("div", "progress-bar");
  const fill = element("span");
  fill.style.width = "0%";
  bar.append(fill);
  progress.append(stageLine, bar);

  const abort = element("button", undefined, "中断") as HTMLButtonElement;
  abort.type = "button";
  abort.addEventListener("click", () => {
    running?.abort();
    batch?.abort();
    running = undefined;
    batch = undefined;
    renderLanding({ kind: "error", message: "解析を中断しました。" });
  });

  const actions = element("div", "actions");
  actions.append(abort);
  container.append(progress, actions);
  show(container);

  return {
    update: (stage, done, total) => {
      stageLine.textContent = total > 1 ? `${stage}（${done} / ${total}）` : `${stage}…`;
      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
      fill.style.width = `${percent}%`;
    },
    setFile: (index, total, fileName) => {
      headline.textContent = `${index + 1} / ${total} ファイル目: ${fileName}`;
    },
  };
}

// --- [3][4][5] 結果 --------------------------------------------------------

function renderResultScreen(result: AnalysisResult): void {
  const container = element("div");
  container.append(element("h1", undefined, TOOL_NAME));
  container.append(
    renderResult(result, {
      onSaveHtml: () =>
        downloadFile(reportFileName(result, "html"), buildReportHtml(result), "text/html;charset=utf-8"),
      onSaveJson: () =>
        downloadFile(reportFileName(result, "json"), buildReportJson(result), "application/json;charset=utf-8"),
      onReset: () => renderLanding(),
    }),
  );
  show(container);
}

/** 一括スキャンの結果。ファイル名を選ぶとそのファイルの単票へ切り替える。 */
function renderBatchScreen(result: BatchResult): void {
  const container = element("div");
  container.append(element("h1", undefined, TOOL_NAME));
  container.append(
    renderBatchResult(result, {
      onSelect: (entry: BatchEntry) => {
        if (entry.result) renderResultScreenFromBatch(entry.result, result);
      },
      onSaveHtml: () =>
        downloadFile(
          batchReportFileName(result, "html"),
          buildBatchReportHtml(result),
          "text/html;charset=utf-8",
        ),
      onSaveJson: () =>
        downloadFile(
          batchReportFileName(result, "json"),
          buildBatchReportJson(result),
          "application/json;charset=utf-8",
        ),
      onReset: () => renderLanding(),
    }),
  );
  show(container);
}

/** 一括結果から1ファイルの詳細へ。戻れるようにしておく。 */
function renderResultScreenFromBatch(result: AnalysisResult, batchResult: BatchResult): void {
  const container = element("div");
  container.append(element("h1", undefined, TOOL_NAME));

  const back = element("button", undefined, "一括結果に戻る") as HTMLButtonElement;
  back.type = "button";
  back.addEventListener("click", () => renderBatchScreen(batchResult));
  const backRow = element("div", "actions");
  backRow.append(back);
  container.append(backRow);

  container.append(
    renderResult(result, {
      onSaveHtml: () =>
        downloadFile(reportFileName(result, "html"), buildReportHtml(result), "text/html;charset=utf-8"),
      onSaveJson: () =>
        downloadFile(reportFileName(result, "json"), buildReportJson(result), "application/json;charset=utf-8"),
      onReset: () => renderLanding(),
    }),
  );
  show(container);
}

// --- 進行 ------------------------------------------------------------------

async function startAnalysis(file: File): Promise<void> {
  const view = renderAnalyzing(file.name);
  const bytes = await file.arrayBuffer();

  running = analyzeInWorker(bytes, file.name, new Date(), {
    onProgress: view.update,
    onDone: (result) => {
      running = undefined;
      renderResultScreen(result);
    },
    onError: (kind, message) => {
      running = undefined;
      renderLanding({
        kind: "error",
        message:
          kind === "unsupported" ? `${message} 対応しているのは .xlsx と .xlsm です。` : message,
      });
    },
  });
}

/** 一括スキャン。フォルダ選択や複数選択で入ってくる。 */
function startBatch(files: File[]): void {
  const view = renderAnalyzing(`${files.length} ファイル`);
  batch = runBatch(files, new Date(), {
    onFileStart: (index, total, fileName) => view.setFile(index, total, fileName),
    onProgress: view.update,
    onFileDone: () => undefined,
    onAllDone: (result) => {
      batch = undefined;
      renderBatchScreen(result);
    },
  });
}

/**
 * 入口。1ファイルなら従来どおりの単票、複数なら一括。
 * フォルダ選択では対象外のファイルも混ざるので、その判定は runBatch 側に任せる。
 */
/** Access のファイルか。中身は読まず、拡張子だけで判断する。 */
const ACCESS_EXTENSION = /\.(accdb|mdb)$/i;

async function start(files: File[]): Promise<void> {
  if (files.length === 1 && files[0]) {
    // Access は「読めません」で終わらせず、相談の導線に載せる（§8 R-2 の選択肢B）。
    if (ACCESS_EXTENSION.test(files[0].name)) {
      renderLanding({ kind: "access" });
      return;
    }
    await startAnalysis(files[0]);
    return;
  }
  startBatch(files);
}

// --- フッター（このツールについて） ----------------------------------------

function renderFooter(): void {
  const footer = document.createElement("footer");

  footer.append(
    element(
      "p",
      undefined,
      `${TOOL_NAME}は、Excelブックの状態を診断するツールです。診断のみを行い、修正はしません。`,
    ),
  );

  if (CONTACT_URL === null) {
    // URL を持たない版。外部リンクを一切埋め込まない（docs/distribution.md）。
    footer.append(element("p", undefined, CONTACT_NOTE));
  } else {
    const contactLine = element("p");
    contactLine.append(document.createTextNode("詳しい診断のご相談: "));
    const link = document.createElement("a");
    link.href = CONTACT_URL;
    link.target = "_blank";
    // noopener は必須。noreferrer は付けない（流入元が追えなくなるため）。
    link.rel = "noopener";
    link.textContent = "お問い合わせフォーム";
    contactLine.append(link);
    contactLine.append(document.createTextNode("（このリンクを押したときだけ外部サイトへ移動します）"));
    footer.append(contactLine);
  }

  const terms = element("ul", "terms");
  for (const line of TERMS) terms.append(element("li", undefined, line));
  footer.append(element("p", undefined, "利用条件:"), terms);

  footer.append(
    element(
      "p",
      undefined,
      `使用ライブラリ: ${DEPENDENCY_LICENSES.map((dependency) => `${dependency.name} ${dependency.version}（${dependency.license}）`).join(" / ")}`,
    ),
  );
  footer.append(element("p", undefined, `${COPYRIGHT}　配布識別子 ${BUILD_ID}`));

  document.body.append(footer);
}

renderLanding();
renderFooter();
