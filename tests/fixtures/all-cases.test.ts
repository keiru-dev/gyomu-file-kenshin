// 全フィクスチャに共通して満たすべき性質を横断的に検証する。
//
// ここが崩れていると後段のルール実装のテストが無意味になるので、ルールを増やすたびに自動で
// この網に掛かるようにしてある（allCases を回すだけで新しいケースも対象になる）。

import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { read as xlsxRead } from "xlsx";
import { allCases, coveredRuleIds } from "../../fixtures/cases";
import { FIXTURE_SENTINEL } from "../../fixtures/ooxml";
import { findElements } from "../../src/worker/xml";

/** 引き継ぎ書 §5.3 の Phase 1 ルール（INFO を除く RED / YELLOW）。 */
const PHASE1_RULES = [
  "REF_ERROR",
  "EXT_LINK_PRESENT",
  "EXT_LINK_BROKEN",
  "CIRCULAR_REF",
  "EXTERNAL_CONNECTION",
  "PII_COLUMN_UNPROTECTED",
  "HARDCODED_CREDENTIAL",
  "HIDDEN_SHEET",
  "MERGED_CELL_HEAVY",
  "FORMULA_DEEP_NEST",
  "VLOOKUP_HARDCODED_INDEX",
  "VOLATILE_FUNCTION",
  "PIVOT_CACHE_STALE",
  "VBA_PRESENT",
  "AUTHOR_SINGLE_LEGACY",
  "PROTECTED_WITH_PASSWORD",
  "MANUAL_CALC_MODE",
].sort();

describe("フィクスチャ全体", () => {
  /** Phase 2 で追加した VBA ソースの静的解析。 */
  const PHASE2_RULES = [
    "VBA_NETWORK_ACCESS",
    "VBA_SHELL_EXEC",
    "VBA_HARDCODED_CREDENTIAL",
    "VBA_FILE_ACCESS",
    "VBA_EXTERNAL_DB",
    "VBA_AUTO_RUN",
  ].sort();

  const ALL_RULES = [...PHASE1_RULES, ...PHASE2_RULES].sort();

  it("Phase 1 / Phase 2 の RED / YELLOW ルールをすべて網羅している", () => {
    expect(coveredRuleIds()).toEqual(ALL_RULES);
  });

  it("各ルールに検出用と非検出用が最低1件ずつある", () => {
    for (const ruleId of ALL_RULES) {
      const cases = allCases.filter((testCase) => testCase.ruleId === ruleId);
      const detected = cases.filter((testCase) => testCase.expectation === "detected");
      const clean = cases.filter((testCase) => testCase.expectation === "clean");
      expect(detected.length, `${ruleId} の検出用`).toBeGreaterThanOrEqual(1);
      expect(clean.length, `${ruleId} の非検出用`).toBeGreaterThanOrEqual(1);
    }
  });

  it("ケースIDが重複していない", () => {
    const ids = allCases.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(allCases.map((testCase) => [testCase.id, testCase] as const))("%s", (_id, testCase) => {
    it("SheetJS が読める妥当な .xlsx である", () => {
      const book = xlsxRead(testCase.build(), { type: "array", dense: true });
      expect(book.SheetNames.length).toBeGreaterThan(0);
    });

    it("同じケースから常に同じバイト列が出る（再現性）", () => {
      expect(testCase.build()).toEqual(testCase.build());
    });

    it("必須パーツが揃っている", () => {
      const files = Object.keys(unzipSync(testCase.build()));
      expect(files).toContain("[Content_Types].xml");
      expect(files).toContain("_rels/.rels");
      expect(files).toContain("xl/workbook.xml");
      expect(files).toContain("xl/_rels/workbook.xml.rels");
    });

    it("workbook.xml が参照する r:id がすべて rels に存在する", () => {
      const parts = unzipSync(testCase.build());
      const workbookXml = strFromU8(parts["xl/workbook.xml"]!);
      const relsXml = strFromU8(parts["xl/_rels/workbook.xml.rels"]!);

      const declaredIds = new Set(
        findElements(relsXml, "Relationship").map((element) => element.attrs["Id"]),
      );
      const referencedIds = [...workbookXml.matchAll(/r:id="([^"]+)"/g)].map((match) => match[1]);

      expect(referencedIds.length).toBeGreaterThan(0);
      for (const id of referencedIds) {
        expect(declaredIds, `${id} が rels に無い`).toContain(id);
      }
    });

    it("番兵文字列がどこかのセルに入っている（M7 の漏洩テスト用）", () => {
      const parts = unzipSync(testCase.build());
      const sheetXml = Object.entries(parts)
        .filter(([path]) => path.startsWith("xl/worksheets/sheet"))
        .map(([, bytes]) => strFromU8(bytes))
        .join("");
      expect(sheetXml).toContain(FIXTURE_SENTINEL);
    });
  });
});
