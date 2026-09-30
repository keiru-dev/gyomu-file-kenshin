// 性能検証用の大きなブックを生成し、解析にかかる時間を測る。
//
//   npm run perf -- <シート数> <行数> <列数>
//   例: npm run perf -- 30 20000 10
//
// 引き継ぎ書 §4.3 の目標は「50MB / 30シート程度のブックを 30秒以内」。
// C-4: 生成する内容はすべて架空。意味のない連番と記号のみ。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { analyzeWorkbook } from "../src/analysis";

const OUT_DIR = join(import.meta.dirname, "out");

const sheetCount = Number(process.argv[2] ?? 30);
const rowCount = Number(process.argv[3] ?? 5_000);
const columnCount = Number(process.argv[4] ?? 10);

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";

const COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

/** 圧縮で潰れすぎないよう、セルごとに違う文字列を入れる（実ファイルの大きさに近づけるため）。 */
function buildSheetXml(sheetIndex: number): string {
  const rows: string[] = [];

  const header = COLUMNS.slice(0, columnCount)
    .map((column, index) => `<c r="${column}1" t="inlineStr"><is><t>項目${index + 1}</t></is></c>`)
    .join("");
  rows.push(`<row r="1">${header}</row>`);

  for (let row = 2; row <= rowCount; row += 1) {
    const cells: string[] = [];
    for (let column = 0; column < columnCount; column += 1) {
      const ref = `${COLUMNS[column]}${row}`;
      // 3列に1つは数式にして、L2 の数式走査にも負荷をかける。
      if (column % 3 === 2) {
        cells.push(`<c r="${ref}"><f>A${row}*${column + 1}</f><v>${row * (column + 1)}</v></c>`);
      } else {
        cells.push(
          `<c r="${ref}" t="inlineStr"><is><t>S${sheetIndex}-R${row}-C${column}-${(row * 7919 + column) % 100_000}</t></is></c>`,
        );
      }
    }
    rows.push(`<row r="${row}">${cells.join("")}</row>`);
  }

  return `${XML_DECL}<worksheet xmlns="${NS_MAIN}"><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

function buildLargeWorkbook(): Uint8Array {
  const parts: Record<string, Uint8Array> = {};

  const overrides = Array.from(
    { length: sheetCount },
    (_unused, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");

  parts["[Content_Types].xml"] = strToU8(
    `${XML_DECL}<Types xmlns="${NS_CT}">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      overrides +
      `</Types>`,
  );

  parts["_rels/.rels"] = strToU8(
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${NS_DOC_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );

  const sheetTags = Array.from(
    { length: sheetCount },
    (_unused, index) => `<sheet name="シート${index + 1}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
  ).join("");

  parts["xl/workbook.xml"] = strToU8(
    `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_DOC_REL}"><sheets>${sheetTags}</sheets></workbook>`,
  );

  parts["xl/_rels/workbook.xml.rels"] = strToU8(
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
      Array.from(
        { length: sheetCount },
        (_unused, index) =>
          `<Relationship Id="rId${index + 1}" Type="${NS_DOC_REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      ).join("") +
      `</Relationships>`,
  );

  for (let index = 0; index < sheetCount; index += 1) {
    parts[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(buildSheetXml(index + 1));
  }

  return zipSync(parts, { mtime: new Date("2020-01-01T00:00:00Z"), level: 6 });
}

const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

console.log(`生成: ${sheetCount} シート × ${rowCount} 行 × ${columnCount} 列 = ${(sheetCount * rowCount * columnCount).toLocaleString("en-US")} セル`);

const generateStart = performance.now();
const bytes = buildLargeWorkbook();
console.log(`  生成時間 ${Math.round(performance.now() - generateStart)} ms / ファイルサイズ ${megabytes(bytes.length)}`);

mkdirSync(OUT_DIR, { recursive: true });
const path = join(OUT_DIR, `perf-${sheetCount}x${rowCount}x${columnCount}.xlsx`);
writeFileSync(path, bytes);
console.log(`  ${path}`);

console.log("\n解析:");
const stageStart = new Map<string, number>();
const stageEnd = new Map<string, number>();

const analyzeStart = performance.now();
const result = analyzeWorkbook(bytes, {
  fileName: "perf.xlsx",
  now: new Date("2026-08-16T00:00:00Z"),
  onProgress: (stage) => {
    if (!stageStart.has(stage)) stageStart.set(stage, performance.now());
    stageEnd.set(stage, performance.now());
  },
});
const elapsed = performance.now() - analyzeStart;

for (const [stage, start] of stageStart) {
  console.log(`  ${stage}: ${Math.round((stageEnd.get(stage) ?? start) - start)} ms`);
}
console.log(`  合計 ${(elapsed / 1000).toFixed(1)} 秒`);
console.log(
  `\n結果: 要対応 ${result.summary.red} 件 / 注意 ${result.summary.yellow} 件 / ` +
    `セル ${result.findings.find((f) => f.ruleId === "INFO_CELL_COUNT")?.occurrences.toLocaleString("en-US")} 個`,
);
console.log(`目標（30秒以内）: ${elapsed <= 30_000 ? "達成" : "未達"}`);
