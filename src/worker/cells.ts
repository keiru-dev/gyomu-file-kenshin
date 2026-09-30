// L2: セル層。SheetJS でセル値・数式・使用範囲を読む（引き継ぎ書 §4.1）。
//
// ★ 何を保持し、何を捨てるか（引き継ぎ書 §7-2「元データの内容を出力に含めない」）
//
// この層は元データに最も近く、扱いを誤ると顧客のセル値がレポートに漏れる。そのため
// **保持するものを最小限に絞る**。
//
//   保持する:
//     - セル参照（"C15" 等）… 場所を示すのに必要。値ではない
//     - エラー種別（"#REF!" 等）… Excel の固定語彙であり、顧客のデータではない
//     - 数式文字列 … ネスト深度・揮発性関数・列番号リテラルの判定に必要
//     - 1行目のテキスト（列名）… PII 判定に必要。引き継ぎ書 §5.4 が「列名と列位置のみ」を許可
//
//   保持しない:
//     - 2行目以降のセル値。ここが顧客データの本体であり、統計以外の用途が無い
//
// **数式文字列は保持するが、レポートや JSON に出してはならない。** 数式には
// `IF(A1="○○",...)` のように顧客由来の文字列リテラルが埋まっていることがある。
// この層の利用者（src/rules/）は、数式を判定にのみ使い、Finding には ruleId と
// セル参照だけを載せること。

import { read as xlsxRead, type CellObject, type WorkSheet } from "xlsx";
import type { ProgressReporter } from "./container";

/** 保持する数式の上限。超えた分は捨てるが、件数の集計は続ける。 */
const FORMULA_RETENTION_LIMIT = 200_000;
/** 保持するエラーセルの上限。 */
const ERROR_RETENTION_LIMIT = 50_000;

export interface FormulaEntry {
  /** セル参照。例: "C15" */
  ref: string;
  /** 数式（先頭の "=" は含まない）。**レポートに出さないこと。** */
  formula: string;
}

export interface ErrorEntry {
  ref: string;
  /** Excel のエラー語彙。例: "#REF!" / "#DIV/0!" */
  error: string;
}

export interface HeaderEntry {
  /** 列記号。例: "C" */
  column: string;
  ref: string;
  /** 列名。引き継ぎ書 §5.4 により、これはレポートに出してよい。 */
  text: string;
}

export interface SheetCells {
  name: string;
  /** 使用範囲。例: "A1:D120"。取得できなければ undefined。 */
  dimension: string | undefined;
  /** 値または数式を持つセルの総数。 */
  cellCount: number;
  /** 数式セルの総数（保持上限に関係なく正確）。 */
  formulaCount: number;
  headers: HeaderEntry[];
  errors: ErrorEntry[];
  formulas: FormulaEntry[];
  /** 保持上限に達し、formulas が全数ではないことを示す。 */
  formulasTruncated: boolean;
  errorsTruncated: boolean;
}

export interface WorkbookCells {
  sheets: SheetCells[];
  totalCellCount: number;
  totalFormulaCount: number;
}

/** SheetJS がエラーセルの値として返す数値コード（BIFF のエラーコード）。 */
const ERROR_CODES: ReadonlyMap<number, string> = new Map([
  [0x00, "#NULL!"],
  [0x07, "#DIV/0!"],
  [0x0f, "#VALUE!"],
  [0x17, "#REF!"],
  [0x1d, "#NAME?"],
  [0x24, "#NUM!"],
  [0x2a, "#N/A"],
  [0x2b, "#GETTING_DATA"],
]);

/** 0 → "A"、25 → "Z"、26 → "AA" */
export function encodeColumn(index: number): string {
  let remaining = index;
  let result = "";
  while (remaining >= 0) {
    result = String.fromCharCode((remaining % 26) + 65) + result;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return result;
}

function errorTextOf(cell: CellObject): string {
  // 表示文字列があればそれを使う。無ければ数値コードから引く。
  if (typeof cell.w === "string" && cell.w.startsWith("#")) return cell.w;
  if (typeof cell.v === "number") return ERROR_CODES.get(cell.v) ?? `#ERR(${cell.v})`;
  if (typeof cell.v === "string" && cell.v.startsWith("#")) return cell.v;
  return "#ERR";
}

/** セルのテキスト表現。ヘッダ行（1行目）にのみ使う。 */
function textOf(cell: CellObject): string {
  if (typeof cell.v === "string") return cell.v;
  if (typeof cell.w === "string") return cell.w;
  if (cell.v === undefined || cell.v === null) return "";
  return String(cell.v);
}

/** dense モードのセル配列。SheetJS の型に "!data" が無い版があるため自前で取り出す。 */
function denseRowsOf(sheet: WorkSheet): (CellObject | undefined)[][] | undefined {
  const data = (sheet as unknown as { "!data"?: (CellObject | undefined)[][] })["!data"];
  return Array.isArray(data) ? data : undefined;
}

function readSheet(name: string, sheet: WorkSheet): SheetCells {
  const result: SheetCells = {
    name,
    dimension: typeof sheet["!ref"] === "string" ? sheet["!ref"] : undefined,
    cellCount: 0,
    formulaCount: 0,
    headers: [],
    errors: [],
    formulas: [],
    formulasTruncated: false,
    errorsTruncated: false,
  };

  const rows = denseRowsOf(sheet);
  if (rows === undefined) return result;

  rows.forEach((row, rowIndex) => {
    if (!row) return;
    row.forEach((cell, columnIndex) => {
      if (!cell) return;
      // 空セル（t === "z"）は数に入れない。
      if (cell.t === "z" && cell.f === undefined) return;

      result.cellCount += 1;
      const column = encodeColumn(columnIndex);
      const ref = `${column}${rowIndex + 1}`;

      if (typeof cell.f === "string" && cell.f !== "") {
        result.formulaCount += 1;
        if (result.formulas.length < FORMULA_RETENTION_LIMIT) {
          result.formulas.push({ ref, formula: cell.f });
        } else {
          result.formulasTruncated = true;
        }
      }

      if (cell.t === "e") {
        if (result.errors.length < ERROR_RETENTION_LIMIT) {
          result.errors.push({ ref, error: errorTextOf(cell) });
        } else {
          result.errorsTruncated = true;
        }
      }

      // ヘッダ行（1行目）のテキストだけを保持する。2行目以降の値は一切保持しない。
      if (rowIndex === 0 && cell.t !== "e") {
        const text = textOf(cell);
        if (text !== "") result.headers.push({ column, ref, text });
      }
    });
  });

  return result;
}

/**
 * ブック全体のセル情報を読む。
 *
 * 引き継ぎ書 §4.2 の指定どおり dense: true / bookVBA: true で読む。
 * dense はメモリ効率のため、bookVBA は VBA を落とさずに保持するため。
 */
export function readCells(bytes: Uint8Array, onProgress?: ProgressReporter): WorkbookCells {
  // SheetJS の読み込みは、大きなブックでは解析全体の半分近くを占める（50MB で約9秒）。
  // ここで進捗を出しておかないと、画面上は止まって見える。
  onProgress?.("ブックを展開中", 0, 1);
  const book = xlsxRead(bytes, { type: "array", dense: true, bookVBA: true, cellFormula: true });
  onProgress?.("ブックを展開中", 1, 1);

  const sheets: SheetCells[] = [];
  let totalCellCount = 0;
  let totalFormulaCount = 0;

  book.SheetNames.forEach((name, index) => {
    onProgress?.("セルを読み取り中", index, book.SheetNames.length);
    const sheet = book.Sheets[name];
    if (!sheet) return;
    const cells = readSheet(name, sheet);
    sheets.push(cells);
    totalCellCount += cells.cellCount;
    totalFormulaCount += cells.formulaCount;
  });
  onProgress?.("セルを読み取り中", book.SheetNames.length, book.SheetNames.length);

  return { sheets, totalCellCount, totalFormulaCount };
}
