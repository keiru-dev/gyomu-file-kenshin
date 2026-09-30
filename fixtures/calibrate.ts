// 閾値を実データから決めるための計測器。
//
//   npm run calibrate -- <フォルダ>
//
// 5つの閾値（src/rules/thresholds.ts）はすべて暫定値で、実データでの調整が前提になっている
// （引き継ぎ書 §9）。ただし**手元に実データが無い状態では調整できない**ので、
// 調整するための道具を用意する。診断の現場で集まったファイルに対して回し、
// 分布を見てから閾値を決める。
//
// ★ セル値・数式・シート名を一切表示しない。
// 顧客のファイルに対して回すことを前提にしているため、出すのは数値と件数だけにする
// （引き継ぎ書 §7-2）。ファイル名は手元の確認用に上位のみ表示する。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { readCells } from "../src/worker/cells";
import { readContainer } from "../src/worker/container";
import { maxParenDepth, usesVolatileFunction } from "../src/rules/helpers";
import { THRESHOLDS } from "../src/rules/thresholds";

const TARGET_EXTENSIONS = new Set([".xlsx", ".xlsm"]);

function collectFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.name.startsWith("~$")) continue; // Excel の一時ファイル
      if (entry.isDirectory()) walk(path);
      else if (TARGET_EXTENSIONS.has(extname(entry.name).toLowerCase())) found.push(path);
    }
  };
  walk(root);
  return found;
}

interface Sample {
  fileName: string;
  maxMergedCells: number;
  maxNestDepth: number;
  volatileCount: number;
  volatileRatio: number;
  daysSinceModified: number | undefined;
  pivotRecordMax: number | undefined;
}

function measure(path: string, now: Date): Sample | undefined {
  const bytes = new Uint8Array(readFileSync(path));
  let container: ReturnType<typeof readContainer>;
  try {
    container = readContainer(bytes);
  } catch {
    return undefined;
  }
  const cells = readCells(bytes);

  let maxNestDepth = 0;
  let volatileCount = 0;
  for (const sheet of cells.sheets) {
    for (const entry of sheet.formulas) {
      const depth = maxParenDepth(entry.formula);
      if (depth > maxNestDepth) maxNestDepth = depth;
      if (usesVolatileFunction(entry.formula)) volatileCount += 1;
    }
  }

  const modified = container.docProps?.modified;
  const parsed = modified === undefined ? Number.NaN : Date.parse(modified);
  const pivotCounts = container.pivotCaches
    .map((cache) => cache.recordCount)
    .filter((count): count is number => count !== undefined);

  return {
    fileName: path.split("/").pop() ?? path,
    maxMergedCells: Math.max(0, ...container.sheets.map((sheet) => sheet.mergedCellCount)),
    maxNestDepth,
    volatileCount,
    volatileRatio: cells.totalFormulaCount === 0 ? 0 : volatileCount / cells.totalFormulaCount,
    daysSinceModified: Number.isFinite(parsed) ? (now.getTime() - parsed) / 86_400_000 : undefined,
    pivotRecordMax: pivotCounts.length === 0 ? undefined : Math.max(...pivotCounts),
  };
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index] ?? 0;
}

function describe(label: string, values: number[], threshold: number, unit = ""): void {
  const hits = values.filter((value) => value >= threshold).length;
  const total = values.length;
  const percent = total === 0 ? 0 : Math.round((hits / total) * 100);

  console.log(`\n${label}`);
  console.log(`  現在の閾値: ${threshold}${unit} → ${hits} / ${total} ファイルが該当（${percent}%）`);
  if (total === 0) return;
  console.log(
    `  分布: 中央値 ${percentile(values, 0.5).toFixed(1)}${unit} / ` +
      `上位25% ${percentile(values, 0.75).toFixed(1)}${unit} / ` +
      `上位10% ${percentile(values, 0.9).toFixed(1)}${unit} / ` +
      `最大 ${Math.max(...values).toFixed(1)}${unit}`,
  );
}

// --- 実行 -------------------------------------------------------------------

const root = process.argv[2];
if (root === undefined) {
  console.error("使い方: npm run calibrate -- <フォルダ>");
  process.exit(1);
}
if (!statSync(root).isDirectory()) {
  console.error(`フォルダを指定してください: ${root}`);
  process.exit(1);
}

const files = collectFiles(root);
console.log(`対象: ${files.length} ファイル（${root}）`);
if (files.length === 0) process.exit(0);

const now = new Date();
const samples: Sample[] = [];
let failed = 0;

for (const path of files) {
  const sample = measure(path, now);
  if (sample === undefined) failed += 1;
  else samples.push(sample);
}

if (failed > 0) console.log(`（うち ${failed} ファイルは読み取れませんでした）`);

console.log("\n=== 閾値の見直しに使う分布 ===");
console.log("※ セル値・数式・シート名は表示しません（引き継ぎ書 §7-2）");

describe(
  "結合セル（1シートあたりの最大）",
  samples.map((sample) => sample.maxMergedCells),
  THRESHOLDS.mergedCellsPerSheet,
  " 件",
);
describe(
  "数式のネスト深度（ファイル内の最大）",
  samples.map((sample) => sample.maxNestDepth),
  THRESHOLDS.formulaNestDepth,
  " 段",
);
describe(
  "揮発性関数を含むセル数",
  samples.map((sample) => sample.volatileCount),
  THRESHOLDS.volatileCellCount,
  " 件",
);
describe(
  "揮発性関数の割合（%）",
  samples.map((sample) => sample.volatileRatio * 100),
  THRESHOLDS.volatileCellRatio * 100,
  "%",
);
describe(
  "最終更新からの経過日数",
  samples.map((sample) => sample.daysSinceModified).filter((value): value is number => value !== undefined),
  THRESHOLDS.staleAuthorDays,
  " 日",
);
describe(
  "ピボットキャッシュのレコード数",
  samples.map((sample) => sample.pivotRecordMax).filter((value): value is number => value !== undefined),
  THRESHOLDS.pivotCacheRecordCount,
  " 件",
);

console.log("\n=== 結合セルが多い順（手元での確認用） ===");
for (const sample of [...samples].sort((a, b) => b.maxMergedCells - a.maxMergedCells).slice(0, 10)) {
  console.log(`  ${String(sample.maxMergedCells).padStart(6)} 件  ${sample.fileName}`);
}

console.log(
  "\n閾値を変えるときは src/rules/thresholds.ts を編集し、" +
    "変更した理由と根拠にした分布を docs/plan-phase1.md に残すこと。",
);
