// L2 セル層の検証。
//
// 「ルールが必要とする情報が取れること」と同じ重みで、
// 「顧客データにあたるセル値を保持していないこと」を確かめる（引き継ぎ書 §7-2）。

import { describe, expect, it } from "vitest";
import { allCases } from "../../fixtures/cases";
import { buildXlsx, FIXTURE_SENTINEL } from "../../fixtures/ooxml";
import { encodeColumn, readCells } from "../../src/worker/cells";

function readCase(caseId: string) {
  const testCase = allCases.find((entry) => entry.id === caseId);
  if (!testCase) throw new Error(`ケースが見つかりません: ${caseId}`);
  return readCells(testCase.build());
}

function sheetOf(caseId: string, sheetName: string) {
  const sheet = readCase(caseId).sheets.find((entry) => entry.name === sheetName);
  if (!sheet) throw new Error(`シートが見つかりません: ${sheetName}`);
  return sheet;
}

describe("encodeColumn", () => {
  it("列番号を列記号に変換する", () => {
    expect(encodeColumn(0)).toBe("A");
    expect(encodeColumn(25)).toBe("Z");
    expect(encodeColumn(26)).toBe("AA");
    expect(encodeColumn(27)).toBe("AB");
    expect(encodeColumn(51)).toBe("AZ");
    expect(encodeColumn(52)).toBe("BA");
  });
});

describe("全フィクスチャを読み通せる", () => {
  it.each(allCases.map((testCase) => [testCase.id, testCase] as const))("%s", (_id, testCase) => {
    const cells = readCells(testCase.build());
    expect(cells.sheets.length).toBeGreaterThan(0);
    expect(cells.totalCellCount).toBeGreaterThan(0);
  });
});

describe("REF_ERROR に必要な情報", () => {
  it("エラーセルの位置と種別を取り出せる", () => {
    const sheet = sheetOf("ref-error--detected", "集計表");
    expect(sheet.errors.length).toBeGreaterThanOrEqual(1);
    expect(sheet.errors.some((entry) => entry.error === "#REF!")).toBe(true);
    expect(sheet.errors.every((entry) => /^[A-Z]+\d+$/.test(entry.ref))).toBe(true);
  });

  it("非検出用にはエラーセルが無い", () => {
    expect(sheetOf("ref-error--clean", "集計表").errors).toEqual([]);
  });
});

describe("FORMULA_DEEP_NEST / VLOOKUP_HARDCODED_INDEX に必要な情報", () => {
  it("数式文字列を位置つきで取り出せる", () => {
    const sheet = sheetOf("formula-deep-nest--detected", "集計表");
    const entry = sheet.formulas.find((formula) => formula.ref === "C1");
    expect(entry).toBeDefined();
    expect(entry!.formula).toContain("IF(");
  });

  it("VLOOKUP の数式をそのまま取り出せる", () => {
    const sheet = sheetOf("vlookup-hardcoded-index--detected", "集計表");
    expect(sheet.formulas.some((formula) => /VLOOKUP\(/i.test(formula.formula))).toBe(true);
  });
});

describe("VOLATILE_FUNCTION に必要な情報", () => {
  it("数式セル数を正確に数える", () => {
    const sheet = sheetOf("volatile-function--detected", "集計表");
    expect(sheet.formulaCount).toBe(120);
    expect(sheet.formulas).toHaveLength(120);
  });

  it("非検出用は数式102件のうち揮発性が2件", () => {
    const sheet = sheetOf("volatile-function--clean", "集計表");
    expect(sheet.formulaCount).toBe(102);
    const volatileCount = sheet.formulas.filter((formula) =>
      /\b(INDIRECT|OFFSET|TODAY|NOW|RAND)\s*\(/i.test(formula.formula),
    ).length;
    expect(volatileCount).toBe(2);
  });
});

describe("PII_COLUMN_UNPROTECTED に必要な情報", () => {
  it("1行目の列名を列位置つきで取り出せる", () => {
    const sheet = sheetOf("pii-column-unprotected--detected", "名簿");
    expect(sheet.headers.map((header) => header.text)).toEqual([
      "氏名",
      "住所",
      "電話番号",
      "メールアドレス",
      "生年月日",
    ]);
    expect(sheet.headers.map((header) => header.column)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("個人情報らしさが無い列名も同じ形で取れる", () => {
    const sheet = sheetOf("pii-column-unprotected--clean-no-pii", "集計表");
    expect(sheet.headers.map((header) => header.text)).toEqual(["区分", "数量", "単価", "金額", "備考"]);
  });
});

describe("INFO 指標に必要な情報", () => {
  it("使用範囲・セル数・数式数を取り出せる", () => {
    const cells = readCase("hidden-sheet--detected");
    expect(cells.totalCellCount).toBeGreaterThan(0);
    expect(cells.totalFormulaCount).toBeGreaterThan(0);
    expect(cells.sheets[0]!.dimension).toMatch(/^[A-Z]+\d+(:[A-Z]+\d+)?$/);
  });
});

describe("★ 元データを保持していないこと（引き継ぎ書 §7-2）", () => {
  // フィクスチャの取り決め: 1行目は列名、番兵は必ず2行目以降に置く。
  // したがって「番兵が L2 の出力に現れない」ことが、値を保持していないことの証拠になる。

  it("全フィクスチャで、セル値（番兵）が一切保持されていない", () => {
    for (const testCase of allCases) {
      const serialized = JSON.stringify(readCells(testCase.build()));
      expect(serialized, `${testCase.id} でセル値が保持されている`).not.toContain(FIXTURE_SENTINEL);
    }
  });

  it("1行目だけは列名として意図的に保持する（設計どおりの唯一の経路）", () => {
    // 引き継ぎ書 §5.4 が「列名と列位置のみ」を許可しているため、1行目は保持する。
    // 経路が1つしかないことを固定しておき、将来ここが増えたらテストで気づけるようにする。
    const bytes = buildXlsx({
      sheets: [
        {
          name: "検証",
          cells: [
            { ref: "A1", value: `列名 ${FIXTURE_SENTINEL}` },
            { ref: "A2", value: `値 ${FIXTURE_SENTINEL}` },
            { ref: "A3", value: `値 ${FIXTURE_SENTINEL}` },
          ],
        },
      ],
    });
    const cells = readCells(bytes);

    expect(cells.sheets[0]!.headers).toHaveLength(1);
    expect(cells.sheets[0]!.headers[0]!.text).toContain(FIXTURE_SENTINEL);
    // 3セルに置いたが、保持されるのは1行目の1件だけ。
    const occurrences = JSON.stringify(cells).split(FIXTURE_SENTINEL).length - 1;
    expect(occurrences).toBe(1);
  });

  it("エラーセルは種別のみを保持し、値そのものは持たない", () => {
    const sheet = sheetOf("ref-error--detected", "集計表");
    expect(sheet.errors.every((entry) => entry.error.startsWith("#"))).toBe(true);
  });
});

describe("進捗レポート", () => {
  it("シート単位で進捗を通知する", () => {
    const calls: { done: number; total: number }[] = [];
    readCells(allCases.find((c) => c.id === "hidden-sheet--detected")!.build(), (_stage, done, total) =>
      calls.push({ done, total }),
    );
    expect(calls.at(-1)).toEqual({ done: 3, total: 3 });
  });
});
