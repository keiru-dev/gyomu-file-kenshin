// L1 コンテナ層の検証。
//
// M1 で用意した架空フィクスチャを実際に読ませ、ルールが必要とする情報が取り出せることを確かめる。
// ルールはまだ実装しないが、ここで「取れる情報」が確定していれば M4 は素直に書ける。

import { describe, expect, it } from "vitest";
import { allCases } from "../../fixtures/cases";
import { buildXlsx } from "../../fixtures/ooxml";
import { hasZipSignature, readContainer, UnsupportedFormatError } from "../../src/worker/container";

function readCase(caseId: string) {
  const testCase = allCases.find((entry) => entry.id === caseId);
  if (!testCase) throw new Error(`ケースが見つかりません: ${caseId}`);
  return readContainer(testCase.build());
}

describe("形式の判定", () => {
  it("ZIP シグネチャを判定できる", () => {
    expect(hasZipSignature(buildXlsx({ sheets: [{ name: "S" }] }))).toBe(true);
    expect(hasZipSignature(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe(false);
    expect(hasZipSignature(new Uint8Array([0x50]))).toBe(false);
  });

  it("ZIP でないファイルは UnsupportedFormatError になる", () => {
    // 旧 .xls（BIFF）の先頭バイト列。Phase 1 の対象外。
    const biff = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => readContainer(biff)).toThrow(UnsupportedFormatError);
  });

  it("ZIP だが workbook が無い場合も UnsupportedFormatError になる", () => {
    // ZIP ではあるが Excel ではないもの。
    const notExcel = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    expect(() => readContainer(notExcel)).toThrow(UnsupportedFormatError);
  });
});

describe("全フィクスチャを読み通せる", () => {
  it.each(allCases.map((testCase) => [testCase.id, testCase] as const))("%s", (_id, testCase) => {
    const info = readContainer(testCase.build());
    expect(info.sheets.length).toBeGreaterThan(0);
    expect(info.partNames).toContain("xl/workbook.xml");
    expect(info.uncompressedBytes).toBeGreaterThan(0);
    // シートのパートは必ず解決できていること（r:id の解決に失敗すると空文字になる）。
    expect(info.sheets.every((sheet) => sheet.partPath !== "")).toBe(true);
  });
});

describe("HIDDEN_SHEET に必要な情報", () => {
  it("シート名と表示状態を取り出せる", () => {
    const info = readCase("hidden-sheet--detected");
    expect(info.sheets.map((sheet) => [sheet.name, sheet.state])).toEqual([
      ["集計表", "visible"],
      ["作業用", "hidden"],
      ["旧様式", "veryHidden"],
    ]);
  });

  it("非検出用はすべて visible", () => {
    expect(readCase("hidden-sheet--clean").sheets.every((sheet) => sheet.state === "visible")).toBe(true);
  });
});

describe("EXT_LINK_PRESENT / EXT_LINK_BROKEN に必要な情報", () => {
  it("外部リンクの参照先を取り出せる", () => {
    const info = readCase("external-link-broken--detected");
    expect(info.externalLinks).toHaveLength(2);
    expect(info.externalLinks.every((link) => link.isExternalMode)).toBe(true);
    expect(info.externalLinks.some((link) => link.target.startsWith("\\\\"))).toBe(true);
    expect(info.externalLinks.some((link) => link.target.startsWith("file:///"))).toBe(true);
  });

  it("外部リンクが無いファイルでは空になる", () => {
    expect(readCase("external-link--clean").externalLinks).toEqual([]);
  });
});

describe("EXTERNAL_CONNECTION / HARDCODED_CREDENTIAL に必要な情報", () => {
  it("接続名と接続文字列を取り出せる", () => {
    const info = readCase("external-connection--detected");
    expect(info.connections).toHaveLength(1);
    expect(info.connections[0]!.name).toBe("サンプル接続");
    expect(info.connections[0]!.connectionString).toContain("Data Source=dbsrv01");
    expect(info.connections[0]!.command).toBe("SELECT * FROM sample_table");
  });

  it("パスワード直書きの有無を接続文字列から判定できる", () => {
    expect(readCase("hardcoded-credential--detected").connections[0]!.connectionString).toMatch(/Password=/i);
    expect(readCase("hardcoded-credential--clean").connections[0]!.connectionString).not.toMatch(/Password=/i);
  });

  it("接続が無いファイルでは空になる", () => {
    expect(readCase("external-connection--clean").connections).toEqual([]);
  });
});

describe("REF_ERROR に必要な情報（名前定義側）", () => {
  it("壊れた名前定義を取り出せる", () => {
    const info = readCase("ref-error--detected");
    expect(info.definedNames).toHaveLength(1);
    expect(info.definedNames[0]!.name).toBe("旧集計範囲");
    expect(info.definedNames[0]!.formula).toContain("#REF!");
  });

  it("正常な名前定義は #REF! を含まない", () => {
    const info = readCase("ref-error--clean");
    expect(info.definedNames[0]!.formula).not.toContain("#REF!");
  });
});

describe("CIRCULAR_REF / MANUAL_CALC_MODE に必要な情報", () => {
  it("反復計算の有無を取り出せる", () => {
    expect(readCase("circular-ref--detected").calc.iterate).toBe(true);
    expect(readCase("circular-ref--clean").calc.iterate).toBe(false);
  });

  it("計算モードを取り出せる", () => {
    expect(readCase("manual-calc-mode--detected").calc.calcMode).toBe("manual");
    expect(readCase("manual-calc-mode--clean").calc.calcMode).toBe("auto");
  });
});

describe("MERGED_CELL_HEAVY に必要な情報", () => {
  it("シートごとの結合セル数を数えられる", () => {
    expect(readCase("merged-cell-heavy--detected").sheets[0]!.mergedCellCount).toBe(60);
    expect(readCase("merged-cell-heavy--clean").sheets[0]!.mergedCellCount).toBe(5);
  });
});

describe("PROTECTED_WITH_PASSWORD / PII_COLUMN_UNPROTECTED に必要な情報", () => {
  it("シート保護とパスワードの有無を区別できる", () => {
    const withPassword = readCase("protected-with-password--detected").sheets[0]!;
    expect(withPassword.isProtected).toBe(true);
    expect(withPassword.hasPasswordProtection).toBe(true);

    const withoutPassword = readCase("protected-with-password--clean").sheets[0]!;
    expect(withoutPassword.isProtected).toBe(true);
    expect(withoutPassword.hasPasswordProtection).toBe(false);
  });

  it("保護が無いシートを判定できる", () => {
    expect(readCase("pii-column-unprotected--detected").sheets[0]!.isProtected).toBe(false);
    expect(readCase("pii-column-unprotected--clean-protected").sheets[0]!.isProtected).toBe(true);
  });
});

describe("VBA_PRESENT に必要な情報", () => {
  it("VBA の有無を判定できる", () => {
    expect(readCase("vba-present--detected").hasVba).toBe(true);
    expect(readCase("vba-present--clean").hasVba).toBe(false);
  });
});

describe("AUTHOR_SINGLE_LEGACY に必要な情報", () => {
  it("作成者・最終更新者・更新日時を取り出せる", () => {
    const props = readCase("author-single-legacy--detected").docProps;
    expect(props?.creator).toBe("担当者A");
    expect(props?.lastModifiedBy).toBe("担当者A");
    expect(props?.modified).toBe("2015-06-30T17:30:00Z");
  });

  it("docProps が無いファイルでは undefined になる", () => {
    expect(readCase("hidden-sheet--detected").docProps).toBeUndefined();
  });
});

describe("PIVOT_CACHE_STALE に必要な情報", () => {
  it("キャッシュの更新日とレコード数を取り出せる", () => {
    const stale = readCase("pivot-cache-stale--detected").pivotCaches;
    expect(stale).toHaveLength(1);
    expect(stale[0]!.refreshedDate).toBe("2016-03-15T10:00:00Z");
    expect(stale[0]!.recordCount).toBe(250_000);
  });

  it("ピボットが無いファイルでは空になる", () => {
    expect(readCase("hidden-sheet--clean").pivotCaches).toEqual([]);
  });
});

describe("進捗レポート", () => {
  it("シート読み取りの進捗を通知する", () => {
    const calls: { stage: string; done: number; total: number }[] = [];
    readContainer(allCases.find((c) => c.id === "hidden-sheet--detected")!.build(), (stage, done, total) =>
      calls.push({ stage, done, total }),
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)).toEqual({ stage: "シートを読み取り中", done: 3, total: 3 });
  });
});
