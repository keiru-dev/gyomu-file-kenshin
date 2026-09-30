#!/usr/bin/env node
// ビルド成果物を実ブラウザの file:// で開き、実際に操作して端から端まで通ることを確かめる。
//
//   npm run browser-check
//
// 確認する範囲:
//   1. ランディングが描画され、CSP の実物が画面に出ている
//   2. フィクスチャを読み込ませると Worker で解析が走り、診断結果に到達する
//   3. 「レポートを保存」「JSONで保存」が file:// + CSP 下で実際にファイルを書き出す
//
// なぜ CDP なのか（重要・再発防止）:
// headless Chrome の `--virtual-time-budget` + `--dump-dom` では **Worker の実作業を待てない**。
// 仮想時間はタイマーを早送りするだけで別スレッドの完了を待たないため、解析の途中でダンプが走る。
// これを「Worker が動いていない」と誤読しかけた（2026-08-09 実測）。実時間でポーリングすること。
//
// Node 20 では WebSocket がフラグ付きのため、npm script 側で --experimental-websocket を付けている。

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// 検証するブラウザ。BROWSER 環境変数で切り替える（既定は Chrome）。
// Edge は Chromium 系なので同じ CDP がそのまま使える。
// Firefox は CDP ではなく WebDriver BiDi のため、このスクリプトでは扱えない（手動確認が必要）。
const BROWSERS = {
  chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  edge: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
};
const BROWSER_NAME = process.env.BROWSER ?? "chrome";
const CHROME = BROWSERS[BROWSER_NAME];
if (!CHROME) {
  console.error(`[browser-check] 未対応のブラウザです: ${BROWSER_NAME}（chrome / edge）`);
  process.exit(1);
}
const ARTIFACT = "dist/index.html";

// 問い合わせ導線の有無は配布経路で変わる（docs/distribution.md）。
// ★ verify-artifact.mjs と同じ考え方で、**緩めるのではなく逆側を検査する**。
// ここを「none のときは飛ばす」にすると、ココナラ版だけ検査されない状態になり、
// 外部URLが混入しても気づけなくなる。
const CONTACT_DISABLED = process.env.CONTACT_URL === "none";
const DEFAULT_FIXTURE = "fixtures/out/pii-column-unprotected--detected.xlsx";
const PORT = 9333;

const fixturePath = process.argv[2] ?? DEFAULT_FIXTURE;

for (const [label, path] of [
  [ARTIFACT, ARTIFACT],
  ["Chrome", CHROME],
  [fixturePath, fixturePath],
]) {
  if (!existsSync(path)) {
    console.error(`[browser-check] 見つかりません: ${label}`);
    if (path === ARTIFACT) console.error("  先に npm run build を実行してください。");
    if (path === fixturePath) console.error("  先に npm run fixtures を実行してください。");
    process.exit(1);
  }
}
if (typeof WebSocket === "undefined") {
  console.error("[browser-check] WebSocket が使えません。node --experimental-websocket で実行してください。");
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "las-browser-check-"));
const downloadDir = join(workDir, "downloads");
const target = join(workDir, "index.html");
writeFileSync(target, readFileSync(ARTIFACT, "utf8"));

const chrome = spawn(CHROME, [
  "--headless",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  // 引き継ぎ書 §10「ネットワーク未接続のPCで完全動作する」の実証。
  // 存在しないプロキシへ全通信を向け、DNS も解決できなくする。この状態で端から端まで
  // 通れば、外部に依存していないことの実測になる（CDP は localhost なのでプロキシを迂回する）。
  "--proxy-server=127.0.0.1:1",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(workDir, "profile")}`,
  `file://${target}`,
]);
chrome.stderr.on("data", () => {});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPageTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // まだ起動していない
    }
    await sleep(250);
  }
  throw new Error("デバッグ対象のページが見つかりませんでした");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket));
    socket.addEventListener("error", reject);
  });
}

let messageId = 0;
function send(socket, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(socket, expression) {
  const result = await send(socket, "Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(`ページ内で例外: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ""}`);
  }
  return result.result?.value;
}

async function waitFor(socket, pattern, seconds = 30, observe) {
  let text = "";
  for (let attempt = 0; attempt < seconds * 2; attempt += 1) {
    text = (await evaluate(socket, "document.body.innerText")) ?? "";
    observe?.(text);
    if (pattern.test(text)) return text;
    await sleep(250);
  }
  throw new Error(`画面が期待した状態になりませんでした（期待: ${pattern}）\n--- 画面 ---\n${text}`);
}

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

try {
  const page = await findPageTarget();
  const socket = await connect(page.webSocketDebuggerUrl);
  await send(socket, "Page.enable");
  await send(socket, "Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });

  console.log(`ブラウザ: ${BROWSER_NAME}`);
  console.log("\n=========== 1. ランディング ===========");
  const landing = await waitFor(socket, /このファイルは通信を一切行いません/);
  check("通信しない旨が表示される", /このファイルは通信を一切行いません/.test(landing));
  check("CSP の実物が画面に出ている", /connect-src 'none'/.test(landing));
  if (CONTACT_DISABLED) {
    check("問い合わせURLを出さず、案内文に切り替わっている", /プラットフォーム上のメッセージ/.test(landing));
    check("画面に外部URLが出ていない", !/keiru-ai\.com/.test(landing));
  } else {
    check("お問い合わせ導線がある", /お問い合わせフォーム/.test(landing));
  }
  check("著作権表記がある", /©\s*\d{4}\s*keiru/.test(landing));
  check("ライセンス表記がある", /xlsx .*Apache-2\.0/.test(landing) && /fflate .*MIT/.test(landing));

  console.log("\n=========== 2. 解析（Worker） ===========");
  // 実ファイルをそのまま渡す。base64 を評価式に埋めると 50MB 級で破綻するため、
  // CDP の DOM.setFileInputFiles を使う（change イベントも発火する）。
  await send(socket, "DOM.enable");
  const { root } = await send(socket, "DOM.getDocument", { depth: -1 });
  const { nodeId } = await send(socket, "DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[type=file]',
  });
  // 一括スキャンの確認: BATCH=1 のときは複数ファイルをまとめて渡す。
  const batchMode = process.env.BATCH === "1";
  const batchFixtures = [
    "fixtures/out/pii-column-unprotected--detected.xlsx",
    "fixtures/out/hidden-sheet--detected.xlsx",
    "fixtures/out/ref-error--detected.xlsx",
    "fixtures/out/hidden-sheet--clean.xlsx",
  ].map((p) => resolve(p));
  const absoluteFixture = resolve(fixturePath);
  const analysisStart = Date.now();
  await send(socket, "DOM.setFileInputFiles", {
    files: batchMode ? batchFixtures : [absoluteFixture],
    nodeId,
  });

  // 解析中もメインスレッドが応答することを確かめる。
  // 応答が無ければ Runtime.evaluate 自体が返らないので、進捗が拾えること自体が証拠になる。
  const seenStages = new Set();
  const result = await waitFor(socket, batchMode ? /一括診断の結果/ : /診断結果/, 120, (text) => {
    for (const line of text.split("\n")) {
      if (/(?:読み取り中|展開中|照合中|確認中)/.test(line)) {
        seenStages.add(line.replace(/（\d+ \/ \d+）/, "").trim());
      }
    }
  });
  const analysisMs = Date.now() - analysisStart;
  // 小さなファイルは 1 回目のポーリング前に終わるため、進捗を観測できなくても異常ではない。
  // 応答性を見るのは、解析に一定時間かかったときだけにする。
  if (analysisMs >= 3_000) {
    check(
      "解析中も画面が応答する（メインスレッドが固まらない）",
      seenStages.size > 0,
      `観測した段階: ${[...seenStages].join(" → ") || "なし"}`,
    );
  } else {
    console.log(`  --   応答性の確認は解析に 3 秒以上かかるファイルでのみ行います（今回 ${(analysisMs / 1000).toFixed(1)} 秒）`);
  }
  console.log(`  解析時間: ${(analysisMs / 1000).toFixed(1)} 秒（対象 ${(statSync(absoluteFixture).size / (1024 * 1024)).toFixed(1)} MB）`);
  check("診断結果に到達する", (batchMode ? /一括診断の結果/ : /診断結果/).test(result));
  check("信号機の集計が出る", /要対応/.test(result) && /注意/.test(result));
  if (batchMode) {
    check("ファイル数の総括が出る", /4 ファイルを確認し、4 ファイルを診断しました/.test(result));
    check("ファイル別の一覧が出る", /pii-column-unprotected--detected\.xlsx/.test(result));
    check("要対応の多い順に並ぶ", result.indexOf("pii-column-unprotected--detected.xlsx") < result.indexOf("hidden-sheet--clean.xlsx"));
  }
  // 検出内容の確認は、個人情報の列を含むフィクスチャを渡したときだけ行う。
  // 性能検証用の大きなブックには欠陥を入れていないため。
  if (!batchMode && absoluteFixture.includes("pii-column-unprotected--detected")) {
    check("検出項目が表示される", /個人情報にあたる可能性のある列があります/.test(result));
    check("該当箇所が列名と列位置で示される", /名簿!A列（氏名）/.test(result));
    check("ファイルの指紋が表示される", /ファイルの指紋（SHA-256）: [0-9a-f ]{60,}/.test(result));
  } else if (!batchMode) {
    console.log("  --   検出内容の確認は pii-column-unprotected--detected.xlsx を渡したときのみ行います");
  }

  // 引き継ぎ書 §4.3 の目標。
  check("50MB級でも 30 秒以内", analysisMs <= 30_000, `${(analysisMs / 1000).toFixed(1)} 秒`);

  console.log("\n=========== 3. 保存（file:// + CSP 下） ===========");
  const clickButton = async (label) =>
    evaluate(
      socket,
      `(() => {
        const button = [...document.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(label)});
        if (!button) return false;
        button.click();
        return true;
      })()`,
    );

  check("「レポートを保存」ボタンがある", await clickButton("レポートを保存"));
  check("「JSONで保存」ボタンがある", await clickButton("JSONで保存"));

  let downloaded = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(500);
    downloaded = existsSync(downloadDir)
      ? readdirSync(downloadDir).filter((name) => !name.endsWith(".crdownload"))
      : [];
    if (downloaded.length >= 2) break;
  }
  check("HTMLレポートが書き出される", downloaded.some((name) => name.endsWith(".html")), downloaded.join(", "));
  check("JSONが書き出される", downloaded.some((name) => name.endsWith(".json")), downloaded.join(", "));

  const htmlName = downloaded.find((name) => name.endsWith(".html"));
  const jsonName = downloaded.find((name) => name.endsWith(".json"));
  if (htmlName) {
    const html = readFileSync(join(downloadDir, htmlName), "utf8");
    check("保存したレポートにも CSP が入っている", /Content-Security-Policy/.test(html));
    if (CONTACT_DISABLED) {
      // ココナラ経由で納品するレポートに外部URLがあると規約違反になりうる。
      // ここが最後の砦なので、**1件も無いこと**を確かめる。
      const externalUrls = [...html.matchAll(/https?:\/\/[A-Za-z0-9.-]+/g)]
        .map((match) => match[0])
        .filter((url) => !/schemas\.(openxmlformats|microsoft)\.org|purl\.oclc\.org/.test(url));
      check(
        "保存したレポートに外部URLが1件も無い",
        externalUrls.length === 0,
        externalUrls.length > 0 ? `検出: ${[...new Set(externalUrls)].join(", ")}` : "",
      );
      check("代わりの案内文が入っている", /プラットフォーム上のメッセージ/.test(html));
    } else {
      check("保存したレポートに問い合わせ導線がある", /keiru-ai\.com\/contact/.test(html));
    }
    check("保存したレポートに著作権表記がある", /©\s*\d{4}\s*keiru/.test(html));
  }
  if (jsonName) {
    const json = JSON.parse(readFileSync(join(downloadDir, jsonName), "utf8"));
    check(
      "JSON がスキーマどおり",
      json.schemaVersion === "1.0" && Array.isArray(batchMode ? json.files : json.findings),
    );
    if (batchMode) {
      check("一括JSONに各ファイルの結果が入る", json.files.length === 4 && json.files[0].result?.schemaVersion === "1.0");
    }
  }

  const elapsed = await evaluate(socket, "Math.round(performance.now())");
  console.log(`\n経過: ${elapsed} ms`);

  socket.close();
  chrome.kill("SIGKILL");

  if (failures.length > 0) {
    console.error(`\n[browser-check] FAIL — ${failures.length} 件: ${failures.join(" / ")}`);
    process.exit(1);
  }
  console.log("\n[browser-check] PASS — file:// で端から端まで動作しました");
} catch (error) {
  chrome.kill("SIGKILL");
  console.error(`[browser-check] FAIL — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
