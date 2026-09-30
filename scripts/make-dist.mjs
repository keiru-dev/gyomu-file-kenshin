#!/usr/bin/env node
// 配布用のファイルを作る。
//
//   npm run dist                    … 通常版
//   DIST_TAG=note npm run dist      … 配布経路のタグ付き
//
// ビルド成果物（dist/index.html）を、版が分かる名前で複製するだけ。
// **顧客が受け取るのはこのファイル1つ**なので、名前に版を含めておかないと、
// 古い版を使い続けている状況に気づけない。
//
// 配布形態はダウンロードのみ（2026-08-16 決定）。Web 上でホストすると、情シスから見て
// 「Webサービス」になり、引き継ぎ書 §1.3 の「審査対象にならない」という利点を失うため。

import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ARTIFACT = "dist/index.html";

if (!existsSync(ARTIFACT)) {
  console.error(`[dist] ${ARTIFACT} がありません。先に npm run build を実行してください。`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const fileName = `業務ファイル健診_${version}.html`;
const target = join("dist", fileName);

copyFileSync(ARTIFACT, target);

const source = readFileSync(ARTIFACT, "utf8");
const buildId = source.match(/"((?:[^"/]+\/)?(?:[0-9a-f]{7,}|nogit)-\d{8})"/)?.[1] ?? "(不明)";
const sizeKb = Math.round(statSync(target).size / 1024);

console.log(`[dist] ${target}`);
console.log(`  版        : ${version}`);
console.log(`  配布識別子: ${buildId}`);
console.log(`  サイズ    : ${sizeKb} KB`);
console.log("");
console.log("配布時の案内文（LP・メールに使う想定）:");
console.log("  ダウンロード後、ネットワークを切ってからお試しください。それでも完全に動作します。");
