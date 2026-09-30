#!/usr/bin/env node
// Firefox で file:// の成果物を開き、解析が通るかを確かめる。
//
//   npm run firefox-check
//
// Chromium 系（Chrome / Edge）は scripts/browser-check.mjs が CDP で扱う。Firefox は CDP を
// 持たず WebDriver BiDi なので別実装にしてある。
//
// ここで確かめたい核心は **Blob URL 製 Worker が Firefox でも起動するか**。
// C-2 に追加した worker-src blob: が Chromium 系以外で通らなければ、その環境では解析が動かない。
//
// Safari は同等の自動化手段が無いため、目視確認に頼るしかない。

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox";
const ROOT = process.cwd();
const PORT = 9444;

const workDir = mkdtempSync(join(tmpdir(), "las-ff-"));
const target = join(workDir, "index.html");
writeFileSync(target, readFileSync(join(ROOT, "dist/index.html"), "utf8"));

const firefox = spawn(FIREFOX, [
  "--headless",
  "--no-remote",
  `--profile`,
  join(workDir, "profile"),
  `--remote-debugging-port=${PORT}`,
]);
firefox.stderr.on("data", () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      if (message.type === "error") reject(new Error(`${method}: ${message.error} ${message.message}`));
      else resolve(message.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function openSession() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return await connect(`ws://127.0.0.1:${PORT}/session`);
    } catch {
      await sleep(500);
    }
  }
  throw new Error("Firefox の BiDi エンドポイントに接続できませんでした");
}

const socket = await openSession();
await send(socket, "session.new", { capabilities: {} });

const tree = await send(socket, "browsingContext.getTree", {});
const context = tree.contexts[0].context;

await send(socket, "browsingContext.navigate", { context, url: `file://${target}`, wait: "complete" });

const evaluate = async (expression) => {
  const result = await send(socket, "script.evaluate", {
    expression,
    target: { context },
    awaitPromise: true,
  });
  if (result.type === "exception") {
    throw new Error(`ページ内で例外: ${JSON.stringify(result.exceptionDetails?.text ?? result)}`);
  }
  return result.result?.value;
};

const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

console.log("ブラウザ: firefox");
console.log("\n=========== 1. ランディング ===========");
const landing = await evaluate("document.body.innerText");
check("通信しない旨が表示される", /このファイルは通信を一切行いません/.test(landing));
check("CSP の実物が画面に出ている", /connect-src 'none'/.test(landing));
check("著作権表記がある", /©\s*\d{4}\s*keiru/.test(landing));

console.log("\n=========== 2. 解析（Blob URL 製 Worker） ===========");
const fixture = join(ROOT, "fixtures/out/pii-column-unprotected--detected.xlsx");
const base64 = readFileSync(fixture).toString("base64");

await evaluate(`(() => {
  const binary = atob(${JSON.stringify(base64)});
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const file = new File([bytes], 'sample.xlsx');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.querySelector('input[type=file]');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change'));
  return true;
})()`);

let text = "";
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(500);
  text = await evaluate("document.body.innerText");
  if (/診断結果|エラー|非対応の形式/.test(text)) break;
}

check("Worker が起動し診断結果に到達する", /診断結果/.test(text));
check("検出項目が表示される", /個人情報にあたる可能性のある列があります/.test(text));
check("該当箇所が列名と列位置で示される", /名簿!A列（氏名）/.test(text));

if (!/診断結果/.test(text)) {
  console.log("\n--- 画面 ---");
  console.log(text.split("\n").slice(0, 30).map((l) => "  " + l).join("\n"));
}

socket.close();
firefox.kill("SIGKILL");

console.log(failures.length ? `\n[firefox-check] FAIL — ${failures.join(" / ")}` : "\n[firefox-check] PASS");
process.exit(failures.length ? 1 : 0);
