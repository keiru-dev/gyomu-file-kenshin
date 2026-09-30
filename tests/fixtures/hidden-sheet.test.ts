// M1: フィクスチャそのものの健全性を検証する。
//
// 検出ルールはまだ無い。ここで保証したいのは「意図した欠陥が実際にファイルに入っていること」と
// 「SheetJS が読めるまっとうな .xlsx になっていること」の2点。
// これが崩れていると、後段のルール実装のテストが無意味になる。

import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { read as xlsxRead } from "xlsx";
import { casesForRule } from "../../fixtures/cases";
import { FIXTURE_SENTINEL } from "../../fixtures/ooxml";

function partOf(bytes: Uint8Array, path: string): string {
  const entry = unzipSync(bytes)[path];
  if (!entry) throw new Error(`パートが見つかりません: ${path}`);
  return strFromU8(entry);
}

const cases = casesForRule("HIDDEN_SHEET");
const detected = cases.find((c) => c.expectation === "detected");
const clean = cases.find((c) => c.expectation === "clean");

describe("HIDDEN_SHEET のフィクスチャ", () => {
  it("検出用・非検出用が対で存在する", () => {
    expect(detected).toBeDefined();
    expect(clean).toBeDefined();
  });

  it("同じケースからは常に同じバイト列が出る（再現性）", () => {
    expect(detected!.build()).toEqual(detected!.build());
  });

  describe("検出用フィクスチャ", () => {
    it("workbook.xml に hidden と veryHidden の両方が含まれる（L1）", () => {
      const workbookXml = partOf(detected!.build(), "xl/workbook.xml");
      expect(workbookXml).toContain('state="hidden"');
      expect(workbookXml).toContain('state="veryHidden"');
    });

    it("SheetJS が読めて、非表示状態を取得できる（L2）", () => {
      const book = xlsxRead(detected!.build(), { type: "array", dense: true });
      expect(book.SheetNames).toEqual(["集計表", "作業用", "旧様式"]);

      // SheetJS は Hidden を 0=可視 / 1=hidden / 2=veryHidden で返す。
      const states = book.Workbook?.Sheets?.map((sheet) => sheet.Hidden);
      expect(states).toEqual([0, 1, 2]);
    });
  });

  describe("非検出用フィクスチャ", () => {
    it("workbook.xml に state 属性が一切無い（L1）", () => {
      const workbookXml = partOf(clean!.build(), "xl/workbook.xml");
      expect(workbookXml).not.toContain("state=");
    });

    it("SheetJS から見てすべて可視（L2）", () => {
      const book = xlsxRead(clean!.build(), { type: "array", dense: true });
      const states = book.Workbook?.Sheets?.map((sheet) => sheet.Hidden ?? 0);
      expect(states).toEqual([0, 0]);
    });
  });

  it("両フィクスチャに番兵文字列が入っている（M7 の漏洩テスト用）", () => {
    for (const testCase of cases) {
      const bytes = testCase.build();
      const anySheetXml = partOf(bytes, "xl/worksheets/sheet1.xml");
      expect(anySheetXml).toContain(FIXTURE_SENTINEL);
    }
  });
});
