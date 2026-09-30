#!/usr/bin/env node
// ビルド成果物を機械的に検査し、絶対制約 C-1 / C-2 / C-3 と ★DOM挿入対策を保証する。
//
// keiru-devkit docs/security-checklist.md §1 の「ビルド出力を grep してシークレット混入を検出する」
// 手法を、本プロジェクト向けに「通信・永続化・未信頼DOM挿入の混入検出」へ読み替えたもの。
// npm run build の一部として実行し、1件でも違反があれば非ゼロ終了してビルドを落とす。
//
// 実行時依存の追加や UI 実装で、意図せず通信・永続化コードが混ざるのを防ぐ最後の砦。
// 検査を緩めるときは、必ず理由を ALLOWLIST にコメント付きで書くこと。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = "dist";

// C-2 が要求する CSP。引き継ぎ書 §2 C-2 の原文 + worker-src blob:（2026-08-09 開発者承認）。
// worker-src を足した理由は index.html のコメントと docs/plan-phase1.md の R-B を参照。
// connect-src 'none' は営業上の価値そのものなので、ここから外すことは決してない。
const REQUIRED_CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "worker-src blob:",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
];

// 例外的に許可する外部URL。問い合わせ導線（keiru ポートフォリオ）だけがここに載りうる。
// 追加するときは必ず理由を書く。データ送信を伴うURLは決して載せない。
// 問い合わせ導線（引き継ぎ書 §9 / devkit のブランド規約で決定）。
// これは <a href> のリンクであり、リソース取得ではない。CSP はリンク遷移を止めないため
// C-2 とも衝突しない。外部へ出るのは利用者がこのリンクを押したときだけ。
// ?from=scanner は流入元の識別用の固定値。顧客データやファイル情報を載せてはならない。
//
// ★ ビルド時の CONTACT_URL に追随させる。`CONTACT_URL=none` でビルドした版では
// 許可リストを空にし、**外部URLが1つも無いこと**を確かめる方向で使う。
// ココナラのようにURL記載を禁じるプラットフォーム向けの版で、検査を緩めないための仕組み。
const CONTACT_URL = process.env.CONTACT_URL ?? "https://www.keiru-ai.com/contact?from=scanner";
const ALLOWLIST = CONTACT_URL === "none" ? [] : [CONTACT_URL.split("?")[0]];

// XML 名前空間の識別子として現れるホスト。
// OOXML は名前空間を URI 形式で表すため、SheetJS のバンドルには http://schemas.openxmlformats.org/... が
// 文字列定数として多数含まれる。これらは「識別子」であって取得先ではなく、CSP の connect-src 'none' 下では
// そもそも取得されない。ホスト単位で許可し、実際に危険な「HTML属性 / CSS url() に現れる外部URL」は
// checkFetchableUrls で別途ゼロ件であることを保証する。
const XML_NAMESPACE_HOSTS = [
  "schemas.openxmlformats.org",
  "sheetjs.openxmlformats.org",
  "schemas.microsoft.com",
  "purl.oclc.org",
  "www.w3.org",
];

/** @type {{ id: string, label: string, pattern: RegExp }[]} */
const FORBIDDEN = [
  // --- C-2: 通信 ---
  { id: "C2-fetch", label: "fetch() 呼び出し", pattern: /\bfetch\s*\(/g },
  { id: "C2-xhr", label: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/g },
  { id: "C2-beacon", label: "navigator.sendBeacon", pattern: /\bsendBeacon\b/g },
  { id: "C2-eventsource", label: "EventSource", pattern: /\bEventSource\b/g },
  { id: "C2-websocket", label: "WebSocket", pattern: /\bWebSocket\b/g },
  { id: "C2-import", label: "動的 import()（外部取得の恐れ）", pattern: /\bimport\s*\(/g },

  // --- C-3: 永続化 ---
  { id: "C3-localstorage", label: "localStorage", pattern: /\blocalStorage\b/g },
  { id: "C3-sessionstorage", label: "sessionStorage", pattern: /\bsessionStorage\b/g },
  { id: "C3-indexeddb", label: "indexedDB", pattern: /\bindexedDB\b/gi },
  { id: "C3-cookie", label: "document.cookie", pattern: /\.cookie\b/g },

  // --- ★ DOM 挿入（未信頼データによる XSS） ---
  { id: "XSS-innerhtml", label: "innerHTML", pattern: /\binnerHTML\b/g },
  { id: "XSS-outerhtml", label: "outerHTML", pattern: /\bouterHTML\b/g },
  { id: "XSS-insertadjacent", label: "insertAdjacentHTML", pattern: /\binsertAdjacentHTML\b/g },
  { id: "XSS-docwrite", label: "document.write", pattern: /document\s*\.\s*write\b/g },

  // --- R-A: file:// で読めない出力形式の混入 ---
  { id: "RA-modulescript", label: '<script type="module">（file:// で CORS により読めない）', pattern: /<script[^>]*type\s*=\s*["']module["']/gi },
  { id: "RA-modulepreload", label: "modulepreload（外部チャンク参照）", pattern: /rel\s*=\s*["']modulepreload["']/gi },

  // --- C-1: 外部参照 ---
  { id: "C1-script-src", label: "<script src=...>（外部ファイル参照）", pattern: /<script[^>]+\ssrc\s*=/gi },
  { id: "C1-link-href", label: "<link href=...>（外部スタイル等の参照）", pattern: /<link[^>]+\shref\s*=/gi },
  { id: "C1-sourcemap", label: "sourceMappingURL（外部 .map 参照）", pattern: /sourceMappingURL/g },
];

/**
 * 外部URL参照。data: と blob: は許可（C-2 の img-src/font-src data: と Worker 起動に必要）。
 *
 * スキームを必須にしている理由: `(?:https?:)?//` のようにスキームを任意にすると、
 * 正規表現リテラルの終端（`/^file:\/\/\//i.test(...)` の `//i.test(` 部分）や
 * 行コメントを URL と誤認する。実測で誤検知が出たため絞り込んだ。
 * スキーム無しのプロトコル相対URLは PROTOCOL_RELATIVE_PATTERN で別に見る。
 */
const URL_PATTERN = /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)>]*/gi;

/**
 * プロトコル相対URL（`//cdn.example.com/...`）。
 * 引用符の直後に限定することで、コードの一部を誤って拾わないようにしている。
 */
const PROTOCOL_RELATIVE_PATTERN = /["']\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\//gi;

const problems = [];

function fail(file, id, label, samples) {
  problems.push({ file, id, label, samples });
}

/** 単一HTML以外の成果物が残っていないか（C-1）。 */
function checkDistShape() {
  let entries;
  try {
    entries = readdirSync(DIST);
  } catch {
    console.error(`[verify-artifact] ${DIST}/ がありません。先に vite build を実行してください。`);
    process.exit(1);
  }
  const files = entries.filter((name) => statSync(join(DIST, name)).isFile());
  const html = files.filter((name) => extname(name) === ".html");
  const others = files.filter((name) => extname(name) !== ".html");
  const dirs = entries.filter((name) => statSync(join(DIST, name)).isDirectory());

  if (html.length !== 1) {
    fail(DIST, "C1-single", `成果物の .html が ${html.length} 件（1件でなければならない）`, html);
  }
  if (others.length > 0 || dirs.length > 0) {
    fail(DIST, "C1-extra", "単一HTML以外の成果物が残っている", [...others, ...dirs]);
  }
  return html[0];
}

/** CSP が C-2 と一致するか。 */
function checkCsp(file, source) {
  const match = source.match(/<meta[^>]+http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/i);
  if (!match) {
    fail(file, "C2-csp-missing", "CSP の meta タグが見つからない", []);
    return;
  }
  // CSP の値は 'none' のように単引用符を含むため、引用符の種類ごとに厳密に取る。
  // ここを [^"']+ で書くと最初の ' で切れて、常に不一致になる。
  const contentMatch = match[0].match(/content\s*=\s*"([^"]*)"/i) ?? match[0].match(/content\s*=\s*'([^']*)'/i);
  if (!contentMatch) {
    fail(file, "C2-csp-malformed", "CSP の content 属性が読めない", [match[0]]);
    return;
  }
  const actual = contentMatch[1].replace(/\s+/g, " ").trim();
  const missing = REQUIRED_CSP_DIRECTIVES.filter((directive) => !actual.includes(directive));
  if (missing.length > 0) {
    fail(file, "C2-csp-mismatch", "CSP が C-2 の指定と一致しない（不足ディレクティブ）", missing);
  }
}

/** 禁止パターンの混入。 */
function checkForbidden(file, source) {
  for (const rule of FORBIDDEN) {
    const hits = source.match(rule.pattern);
    if (hits && hits.length > 0) {
      fail(file, rule.id, rule.label, [...new Set(hits)].slice(0, 5));
    }
  }
}

/** 外部URL文字列。ALLOWLIST と XML 名前空間ホストのみ許可。 */
function checkUrls(file, source) {
  const hits = source.match(URL_PATTERN) ?? [];
  const violations = [...new Set(hits)].filter((url) => {
    if (ALLOWLIST.some((allowed) => url.startsWith(allowed))) return false;
    const host = url.replace(/^https?:/, "").replace(/^\/\//, "").split("/")[0];
    return !XML_NAMESPACE_HOSTS.includes(host);
  });
  if (violations.length > 0) {
    fail(file, "C1-external-url", "外部URL参照（ALLOWLIST / 名前空間ホスト外）", violations.slice(0, 10));
  }

  const protocolRelative = [...new Set(source.match(PROTOCOL_RELATIVE_PATTERN) ?? [])].filter(
    (hit) => !ALLOWLIST.some((allowed) => hit.includes(allowed)),
  );
  if (protocolRelative.length > 0) {
    fail(file, "C1-protocol-relative-url", "プロトコル相対URLの参照", protocolRelative.slice(0, 10));
  }
}

/**
 * 実際に取得・送信が起きうる形の外部URL。
 * 文字列としての URL より厳しく見る必要がある箇所で、ここは ALLOWLIST 以外ゼロ件でなければならない。
 * 名前空間ホストであっても、属性値や url() に現れたら違反として扱う。
 */
function checkFetchableUrls(file, source) {
  const attrHits =
    source.match(/(?:src|href|action|formaction|poster|codebase|data)\s*=\s*["'](?:https?:)?\/\/[^"']*/gi) ?? [];
  const cssHits = source.match(/url\(\s*["']?(?:https?:)?\/\/[^)]*/gi) ?? [];
  const violations = [...new Set([...attrHits, ...cssHits])].filter(
    (hit) => !ALLOWLIST.some((allowed) => hit.includes(allowed)),
  );
  if (violations.length > 0) {
    fail(file, "C1-fetchable-url", "HTML属性 / CSS url() に外部URLがある（取得・送信が起きうる）", violations.slice(0, 10));
  }
}

const htmlFile = checkDistShape();
if (htmlFile) {
  const path = join(DIST, htmlFile);
  const source = readFileSync(path, "utf8");
  checkCsp(path, source);
  checkForbidden(path, source);
  checkUrls(path, source);
  checkFetchableUrls(path, source);
  console.log(`[verify-artifact] 検査対象: ${path}（${source.length.toLocaleString("en-US")} bytes）`);
}

if (problems.length > 0) {
  console.error(`\n[verify-artifact] FAIL — ${problems.length} 件の違反\n`);
  for (const problem of problems) {
    console.error(`  ✗ [${problem.id}] ${problem.label}`);
    console.error(`      ファイル: ${problem.file}`);
    if (problem.samples.length > 0) {
      for (const sample of problem.samples) console.error(`      検出: ${sample}`);
    }
  }
  console.error("\n絶対制約（CLAUDE.md）に違反しています。緩めるのではなく実装を直すこと。\n");
  process.exit(1);
}

console.log("[verify-artifact] PASS — C-1 / C-2 / C-3 / DOM挿入対策 いずれも違反なし");
