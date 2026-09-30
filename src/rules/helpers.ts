// ルール実装で共有する小道具。
//
// 判定に数式文字列を使う関数がいくつかあるが、**結果として返すのは真偽値や件数だけ**で、
// 数式そのものを外に出さないこと（引き継ぎ書 §7-2）。

/** locations の上限（引き継ぎ書 §5.2）。 */
export const MAX_LOCATIONS = 20;

/** locations を上限で打ち切る。件数は occurrences 側で正確に持つこと。 */
export function limitLocations(locations: string[]): string[] {
  return locations.slice(0, MAX_LOCATIONS);
}

/** "集計表" と "C15" → "集計表!C15" */
export function cellLocation(sheetName: string, ref: string): string {
  return `${sheetName}!${ref}`;
}

/**
 * 数式の括弧の最大ネスト深度。
 * 文字列リテラル内の括弧は数えない（`IF(A1="(注)",...)` のような数式があるため）。
 */
export function maxParenDepth(formula: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;

  for (let index = 0; index < formula.length; index += 1) {
    const char = formula[index];

    if (inString) {
      if (char === '"') {
        // "" は文字列内のエスケープされた引用符。
        if (formula[index + 1] === '"') index += 1;
        else inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "(") {
      depth += 1;
      if (depth > max) max = depth;
      continue;
    }
    if (char === ")") {
      depth -= 1;
    }
  }

  return max;
}

/** 再計算のたびに値が変わりうる関数（揮発性関数）。 */
const VOLATILE_FUNCTIONS = new Set([
  "INDIRECT",
  "OFFSET",
  "TODAY",
  "NOW",
  "RAND",
  "RANDBETWEEN",
  "RANDARRAY",
  "CELL",
  "INFO",
]);

/** 数式に含まれる関数名を大文字で列挙する（重複あり）。 */
export function functionNamesOf(formula: string): string[] {
  const names: string[] = [];
  // 関数名として妥当な文字だけを拾う。シート名参照（マスタ!$A$1）は括弧を伴わないため掛からない。
  const pattern = /([A-Za-z][A-Za-z0-9._]*)\s*\(/g;
  let match = pattern.exec(formula);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined) names.push(name.toUpperCase());
    match = pattern.exec(formula);
  }
  return names;
}

/** 数式が揮発性関数を含むか。 */
export function usesVolatileFunction(formula: string): boolean {
  return functionNamesOf(formula).some((name) => VOLATILE_FUNCTIONS.has(name));
}

/**
 * 列番号をリテラルで指定した参照関数か。
 * VLOOKUP / HLOOKUP の第3引数が数値リテラルのものを拾う。
 * MATCH などで解決している場合は掛からない。
 */
export function usesHardcodedLookupIndex(formula: string): boolean {
  // 引数はカンマ区切りだが、範囲指定にもカンマが入りうるため、括弧の深さを見て
  // トップレベルのカンマだけを区切りとして扱う。
  const pattern = /\b(VLOOKUP|HLOOKUP)\s*\(/gi;
  let match = pattern.exec(formula);

  while (match !== null) {
    const argsStart = match.index + match[0].length;
    const args = splitTopLevelArguments(formula, argsStart);
    const indexArgument = args[2];
    if (indexArgument !== undefined && /^\s*\d+\s*$/.test(indexArgument)) return true;
    match = pattern.exec(formula);
  }

  return false;
}

/** 開き括弧の直後から、対応する閉じ括弧までの引数をトップレベルのカンマで分割する。 */
function splitTopLevelArguments(formula: string, start: number): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let index = start; index < formula.length; index += 1) {
    const char = formula[index];

    if (inString) {
      current += char;
      if (char === '"') {
        if (formula[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      current += char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      if (depth === 0) break; // この関数呼び出しの終わり
      depth -= 1;
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      args.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  args.push(current);
  return args;
}

/**
 * 個人情報らしき列名の語彙（引き継ぎ書 §5.4）。
 * **誤検知は許容する。断定しないこと。**
 * C-4: いずれも一般的な語で、特定の企業・業種に由来しない。
 */
const PII_KEYWORDS = [
  "氏名",
  "名前",
  "姓名",
  "フリガナ",
  "ふりがな",
  "住所",
  "所在地",
  "電話",
  "TEL",
  "携帯",
  "メール",
  "MAIL",
  "生年月日",
  "誕生日",
  "年齢",
  "性別",
  "社員番号",
  "従業員番号",
  "社員コード",
  "口座",
  "銀行",
  "マイナンバー",
  "個人番号",
];

/** 列名が個人情報らしき語を含むか。大文字小文字は区別しない。 */
export function looksLikePiiHeader(header: string): boolean {
  const normalized = header.toUpperCase();
  return PII_KEYWORDS.some((keyword) => normalized.includes(keyword.toUpperCase()));
}

/** 外部参照のパスの種別。パスそのものは出力しないため、種別だけを返す。 */
export type ExternalPathKind = "unc" | "absolute" | "relative";

export function classifyExternalPath(target: string): ExternalPathKind {
  if (target.startsWith("\\\\") || target.startsWith("//")) return "unc";
  if (/^file:\/\/\//i.test(target)) return "absolute";
  if (/^[A-Za-z]:[\\/]/.test(target)) return "absolute";
  if (target.startsWith("/")) return "absolute";
  return "relative";
}

/** 2つの日時の差を日数で返す。解釈できない場合は undefined。 */
export function daysBetween(from: string | undefined, to: Date): number | undefined {
  if (from === undefined) return undefined;
  const parsed = Date.parse(from);
  if (!Number.isFinite(parsed)) return undefined;
  return (to.getTime() - parsed) / 86_400_000;
}
