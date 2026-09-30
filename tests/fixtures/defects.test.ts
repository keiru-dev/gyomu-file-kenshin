// 「検出用フィクスチャに、意図した欠陥が実際に入っているか」を1ルールずつ確かめる。
//
// これを省くと、ルール実装のテストが空振り（欠陥が無いので検出されないだけ）でも緑になってしまう。
// 併せて、L1（自前 XML リーダー）で必要な情報を取り出せることの下見にもなっている。

import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { allCases } from "../../fixtures/cases";
import { findElements, firstElement } from "../../src/worker/xml";

function partsOf(caseId: string): Record<string, string> {
  const testCase = allCases.find((entry) => entry.id === caseId);
  if (!testCase) throw new Error(`ケースが見つかりません: ${caseId}`);
  const raw = unzipSync(testCase.build());
  const decoded: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(raw)) {
    // vbaProject.bin はバイナリなので文字列化しない。
    if (path.endsWith(".bin")) continue;
    decoded[path] = strFromU8(bytes);
  }
  return decoded;
}

function pathsOf(caseId: string): string[] {
  const testCase = allCases.find((entry) => entry.id === caseId);
  if (!testCase) throw new Error(`ケースが見つかりません: ${caseId}`);
  return Object.keys(unzipSync(testCase.build()));
}

function sheetXmlOf(caseId: string, index = 1): string {
  const xml = partsOf(caseId)[`xl/worksheets/sheet${index}.xml`];
  if (xml === undefined) throw new Error(`sheet${index}.xml がありません: ${caseId}`);
  return xml;
}

function workbookXmlOf(caseId: string): string {
  const xml = partsOf(caseId)["xl/workbook.xml"];
  if (xml === undefined) throw new Error(`workbook.xml がありません: ${caseId}`);
  return xml;
}

describe("EXT_LINK_PRESENT / EXT_LINK_BROKEN", () => {
  it("検出用は xl/externalLinks/ を持つ", () => {
    expect(pathsOf("external-link--detected").some((p) => p.startsWith("xl/externalLinks/"))).toBe(true);
  });

  it("非検出用は xl/externalLinks/ を持たない", () => {
    expect(pathsOf("external-link--clean").some((p) => p.startsWith("xl/externalLinks/"))).toBe(false);
  });

  it("検出用の参照先が UNC / ローカル絶対パスである", () => {
    const parts = partsOf("external-link-broken--detected");
    const targets = Object.entries(parts)
      .filter(([path]) => path.startsWith("xl/externalLinks/_rels/"))
      .flatMap(([, xml]) => findElements(xml, "Relationship").map((el) => el.attrs["Target"] ?? ""));

    expect(targets).toHaveLength(2);
    expect(targets.some((target) => target.startsWith("\\\\"))).toBe(true);
    expect(targets.some((target) => target.startsWith("file:///"))).toBe(true);
  });

  it("非検出用の参照先は相対パスである", () => {
    const parts = partsOf("external-link-broken--clean");
    const targets = Object.entries(parts)
      .filter(([path]) => path.startsWith("xl/externalLinks/_rels/"))
      .flatMap(([, xml]) => findElements(xml, "Relationship").map((el) => el.attrs["Target"] ?? ""));

    expect(targets).toHaveLength(1);
    expect(targets[0]!.startsWith("\\\\")).toBe(false);
    expect(targets[0]!.startsWith("file:///")).toBe(false);
  });
});

describe("EXTERNAL_CONNECTION / HARDCODED_CREDENTIAL", () => {
  it("検出用は xl/connections.xml を持つ", () => {
    expect(pathsOf("external-connection--detected")).toContain("xl/connections.xml");
  });

  it("非検出用は xl/connections.xml を持たない", () => {
    expect(pathsOf("external-connection--clean")).not.toContain("xl/connections.xml");
  });

  it("資格情報の検出用は接続文字列に Password= を含む", () => {
    const xml = partsOf("hardcoded-credential--detected")["xl/connections.xml"]!;
    const connection = firstElement(xml, "dbPr");
    expect(connection?.attrs["connection"]).toMatch(/Password=/i);
  });

  it("資格情報の非検出用は Password= を含まない", () => {
    const xml = partsOf("hardcoded-credential--clean")["xl/connections.xml"]!;
    const connection = firstElement(xml, "dbPr");
    expect(connection?.attrs["connection"]).not.toMatch(/Password=/i);
  });
});

describe("REF_ERROR", () => {
  it("検出用はエラーセルと壊れた名前定義の両方を持つ", () => {
    const sheetXml = sheetXmlOf("ref-error--detected");
    const errorCells = findElements(sheetXml, "c").filter((cell) => cell.attrs["t"] === "e");
    expect(errorCells.length).toBeGreaterThanOrEqual(1);
    expect(sheetXml).toContain("#REF!");

    const definedNames = findElements(workbookXmlOf("ref-error--detected"), "definedName");
    expect(definedNames.some((element) => element.text.includes("#REF!"))).toBe(true);
  });

  it("非検出用はエラーも壊れた名前定義も持たない", () => {
    expect(sheetXmlOf("ref-error--clean")).not.toContain("#REF!");
    const definedNames = findElements(workbookXmlOf("ref-error--clean"), "definedName");
    expect(definedNames.every((element) => !element.text.includes("#REF!"))).toBe(true);
  });
});

describe("FORMULA_DEEP_NEST", () => {
  /** 数式の括弧の最大深度をざっくり数える。 */
  function maxDepth(formula: string): number {
    let depth = 0;
    let max = 0;
    for (const char of formula) {
      if (char === "(") {
        depth += 1;
        max = Math.max(max, depth);
      } else if (char === ")") {
        depth -= 1;
      }
    }
    return max;
  }

  it("検出用の数式は閾値 7 を超える深さを持つ", () => {
    const formula = firstElement(sheetXmlOf("formula-deep-nest--detected"), "f")?.text ?? "";
    expect(maxDepth(formula)).toBeGreaterThan(7);
  });

  it("非検出用の数式は閾値 7 に達しない", () => {
    const formula = firstElement(sheetXmlOf("formula-deep-nest--clean"), "f")?.text ?? "";
    expect(maxDepth(formula)).toBeLessThan(7);
  });
});

describe("VLOOKUP_HARDCODED_INDEX", () => {
  it("検出用は列番号をリテラル指定している", () => {
    const formulas = findElements(sheetXmlOf("vlookup-hardcoded-index--detected"), "f").map((f) => f.text);
    expect(formulas.some((formula) => /VLOOKUP\([^)]*,\s*\d+\s*,/i.test(formula))).toBe(true);
  });

  it("非検出用は MATCH で列位置を解決している", () => {
    const formulas = findElements(sheetXmlOf("vlookup-hardcoded-index--clean"), "f").map((f) => f.text);
    expect(formulas.some((formula) => /MATCH\(/i.test(formula))).toBe(true);
    expect(formulas.some((formula) => /VLOOKUP\([^)]*,\s*\d+\s*,/i.test(formula))).toBe(false);
  });
});

describe("VOLATILE_FUNCTION", () => {
  const VOLATILE = /\b(INDIRECT|OFFSET|TODAY|NOW|RAND)\s*\(/i;

  function counts(caseId: string): { volatile: number; total: number } {
    const formulas = findElements(sheetXmlOf(caseId), "f").map((f) => f.text);
    return {
      volatile: formulas.filter((formula) => VOLATILE.test(formula)).length,
      total: formulas.length,
    };
  }

  it("検出用は揮発性関数が閾値 100 セルを超える", () => {
    expect(counts("volatile-function--detected").volatile).toBeGreaterThanOrEqual(100);
  });

  it("非検出用は件数・割合ともに閾値未満", () => {
    const { volatile, total } = counts("volatile-function--clean");
    expect(volatile).toBeLessThan(100);
    expect(volatile / total).toBeLessThan(0.1);
  });
});

describe("CIRCULAR_REF / MANUAL_CALC_MODE", () => {
  it("検出用は反復計算が有効", () => {
    expect(firstElement(workbookXmlOf("circular-ref--detected"), "calcPr")?.attrs["iterate"]).toBe("1");
  });

  it("非検出用は反復計算の指定が無い", () => {
    expect(firstElement(workbookXmlOf("circular-ref--clean"), "calcPr")?.attrs["iterate"]).toBeUndefined();
  });

  it("検出用は計算モードが手動", () => {
    expect(firstElement(workbookXmlOf("manual-calc-mode--detected"), "calcPr")?.attrs["calcMode"]).toBe("manual");
  });

  it("非検出用は計算モードが自動", () => {
    expect(firstElement(workbookXmlOf("manual-calc-mode--clean"), "calcPr")?.attrs["calcMode"]).toBe("auto");
  });
});

describe("MERGED_CELL_HEAVY", () => {
  it("検出用は結合セルが閾値 50 を超える", () => {
    expect(findElements(sheetXmlOf("merged-cell-heavy--detected"), "mergeCell")).toHaveLength(60);
  });

  it("非検出用は閾値 50 に達しない", () => {
    expect(findElements(sheetXmlOf("merged-cell-heavy--clean"), "mergeCell")).toHaveLength(5);
  });
});

describe("PROTECTED_WITH_PASSWORD", () => {
  it("検出用はパスワード属性付きのシート保護を持つ", () => {
    const protection = firstElement(sheetXmlOf("protected-with-password--detected"), "sheetProtection");
    expect(protection?.attrs["password"]).toBeDefined();
  });

  it("非検出用は保護があってもパスワード属性が無い", () => {
    const protection = firstElement(sheetXmlOf("protected-with-password--clean"), "sheetProtection");
    expect(protection).toBeDefined();
    expect(protection?.attrs["password"]).toBeUndefined();
  });
});

describe("PII_COLUMN_UNPROTECTED", () => {
  function headerTexts(caseId: string): string[] {
    return findElements(sheetXmlOf(caseId), "t").map((element) => element.text);
  }

  it("検出用は個人情報らしき列名があり、シート保護が無い", () => {
    const headers = headerTexts("pii-column-unprotected--detected");
    expect(headers).toContain("氏名");
    expect(headers).toContain("電話番号");
    expect(firstElement(sheetXmlOf("pii-column-unprotected--detected"), "sheetProtection")).toBeUndefined();
  });

  it("非検出用（保護あり）は列名は同じだがシート保護がある", () => {
    const headers = headerTexts("pii-column-unprotected--clean-protected");
    expect(headers).toContain("氏名");
    expect(firstElement(sheetXmlOf("pii-column-unprotected--clean-protected"), "sheetProtection")).toBeDefined();
  });

  it("非検出用（列名なし）は個人情報らしき列名を含まない", () => {
    const headers = headerTexts("pii-column-unprotected--clean-no-pii");
    expect(headers).not.toContain("氏名");
    expect(headers).not.toContain("住所");
  });

  it("個人情報らしき値そのものはフィクスチャに書かれていない（列名のみ）", () => {
    // 引き継ぎ書 §5.4 の方針をフィクスチャ側でも守る。
    const sheetXml = sheetXmlOf("pii-column-unprotected--detected");
    expect(sheetXml).not.toMatch(/\d{2,4}-\d{2,4}-\d{4}/); // 電話番号らしき並び
    expect(sheetXml).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i); // メールアドレスらしき並び
  });
});

describe("VBA_PRESENT", () => {
  it("検出用は xl/vbaProject.bin を持ち、マクロ有効の content type になっている", () => {
    expect(pathsOf("vba-present--detected")).toContain("xl/vbaProject.bin");
    expect(partsOf("vba-present--detected")["[Content_Types].xml"]).toContain("macroEnabled");
  });

  it("非検出用は vbaProject.bin を持たない", () => {
    expect(pathsOf("vba-present--clean")).not.toContain("xl/vbaProject.bin");
  });
});

describe("AUTHOR_SINGLE_LEGACY", () => {
  function corePropsOf(caseId: string): { creator: string; lastModifiedBy: string; modified: string } {
    const xml = partsOf(caseId)["docProps/core.xml"]!;
    return {
      creator: firstElement(xml, "creator")?.text ?? "",
      lastModifiedBy: firstElement(xml, "lastModifiedBy")?.text ?? "",
      modified: firstElement(xml, "modified")?.text ?? "",
    };
  }

  it("検出用は作成者と最終更新者が同一で、更新が 730 日以上前", () => {
    const props = corePropsOf("author-single-legacy--detected");
    expect(props.creator).toBe(props.lastModifiedBy);
    // 基準日は固定値で判定する（テストが実行日に依存しないようにするため）。
    const daysSince = (Date.parse("2026-08-09T00:00:00Z") - Date.parse(props.modified)) / 86_400_000;
    expect(daysSince).toBeGreaterThan(730);
  });

  it("非検出用は作成者と最終更新者が異なる", () => {
    const props = corePropsOf("author-single-legacy--clean");
    expect(props.creator).not.toBe(props.lastModifiedBy);
  });
});

describe("PIVOT_CACHE_STALE", () => {
  function cacheOf(caseId: string): { refreshedDate: string; recordCount: number } {
    const xml = partsOf(caseId)["xl/pivotCache/pivotCacheDefinition1.xml"]!;
    const element = firstElement(xml, "pivotCacheDefinition");
    return {
      refreshedDate: element?.attrs["refreshedDate"] ?? "",
      recordCount: Number(element?.attrs["recordCount"] ?? "0"),
    };
  }

  it("検出用は更新日が古くレコード数も多い", () => {
    const cache = cacheOf("pivot-cache-stale--detected");
    const daysSince = (Date.parse("2026-08-09T00:00:00Z") - Date.parse(cache.refreshedDate)) / 86_400_000;
    expect(daysSince).toBeGreaterThan(730);
    expect(cache.recordCount).toBeGreaterThanOrEqual(100_000);
  });

  it("非検出用は更新日が新しくレコード数も小さい", () => {
    const cache = cacheOf("pivot-cache-stale--clean");
    const daysSince = (Date.parse("2026-08-09T00:00:00Z") - Date.parse(cache.refreshedDate)) / 86_400_000;
    expect(daysSince).toBeLessThan(730);
    expect(cache.recordCount).toBeLessThan(100_000);
  });
});
