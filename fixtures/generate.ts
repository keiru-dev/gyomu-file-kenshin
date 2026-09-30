// 架空フィクスチャを fixtures/out/ に書き出す CLI。
//
//   npx vite-node fixtures/generate.ts
//
// テストはこのスクリプトを介さず cases から直接バイト列を生成するため、出力は
// 「実際に Excel で開いて目視確認したいとき」のためのもの。出力先は .gitignore 済み。
//
// C-4: 生成物はすべて架空データ。実在の事業体に由来する情報は一切含まない。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allCases } from "./cases";

const OUT_DIR = join(import.meta.dirname, "out");

mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const testCase of allCases) {
  const bytes = testCase.build();
  const path = join(OUT_DIR, `${testCase.id}.xlsx`);
  writeFileSync(path, bytes);
  const label = testCase.expectation === "detected" ? "検出されるべき" : "検出されてはならない";
  console.log(`  ${testCase.id}.xlsx  [${testCase.ruleId} / ${label}]  ${bytes.length} bytes`);
  console.log(`      ${testCase.description}`);
  written += 1;
}

console.log(`\n${written} 件を ${OUT_DIR} に書き出しました。`);
