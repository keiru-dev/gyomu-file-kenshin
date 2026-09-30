// VBA プロジェクトの構成読み取り（Phase 2-B）。
//
// 検証には **Excel が実際に書き出した .xlsm** を使う。自作したデータを自作の解析器で読んでも、
// 自分の思い違いは見つけられない（引き継ぎ書 §8 R-1 の「動くまで対応済みと書かない」）。
// ファイルが無い環境ではその検証だけを飛ばし、飛ばしたことが分かるようにしてある。

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeWorkbook } from "../../src/analysis";
import { readContainer } from "../../src/worker/container";
import { readVbaProject } from "../../src/worker/vba";
import { allCases } from "../../fixtures/cases";

const SAMPLE = "fixtures/vba/sample-macro.xlsm";
const hasSample = existsSync(SAMPLE);
const NOW = new Date("2026-08-16T00:00:00Z");

describe("VBA として読めない入力", () => {
  it("CFB でないバイト列では undefined を返す（例外を投げない）", () => {
    expect(readVbaProject(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x01]))).toBeUndefined();
    expect(readVbaProject(new Uint8Array())).toBeUndefined();
  });

  it("ダミーの vbaProject.bin を持つフィクスチャでも解析全体は止まらない", () => {
    const testCase = allCases.find((entry) => entry.id === "vba-present--detected")!;
    const info = readContainer(testCase.build());
    expect(info.hasVba).toBe(true);
    expect(info.vba).toBeUndefined(); // 中身は VBA ではないので構成は取れない
  });

  it("構成が取れなくても「マクロあり」は伝える", () => {
    const testCase = allCases.find((entry) => entry.id === "vba-present--detected")!;
    const result = analyzeWorkbook(testCase.build(), { fileName: "dummy.xlsm", now: NOW });
    const finding = result.findings.find((entry) => entry.ruleId === "VBA_PRESENT");
    expect(finding?.detail).toContain("マクロ");
    expect(finding?.detail).not.toContain("内訳は");
  });
});

describe.skipIf(!hasSample)("Excel が書き出した実ファイル", () => {
  const bytes = hasSample ? new Uint8Array(readFileSync(SAMPLE)) : new Uint8Array();

  it("モジュールの種別ごとの件数を取り出せる", () => {
    const info = readContainer(bytes);
    expect(info.hasVba).toBe(true);
    expect(info.vba).toBeDefined();
    expect(info.vba!.counts.module).toBeGreaterThanOrEqual(1);
    // ThisWorkbook と各シートは Document 扱い。
    expect(info.vba!.counts.document).toBeGreaterThanOrEqual(1);
  });

  it("おおよその規模を取り出せる", () => {
    const info = readContainer(bytes);
    expect(info.vba!.totalStreamBytes).toBeGreaterThan(0);
    expect(info.vba!.streamCount).toBe(
      info.vba!.counts.module + info.vba!.counts.document + info.vba!.counts.class + info.vba!.counts.form,
    );
  });

  it("画面の文言に内訳と規模が入る", () => {
    const result = analyzeWorkbook(bytes, { fileName: "sample-macro.xlsm", now: NOW });
    const finding = result.findings.find((entry) => entry.ruleId === "VBA_PRESENT");
    expect(finding?.detail).toContain("内訳は");
    expect(finding?.detail).toContain("標準モジュール");
    expect(finding?.detail).toMatch(/およそ \d+(\.\d+)? (KB|MB)/);
  });

  it("できていないこと（中身の解析）を「できる」と書かない", () => {
    const result = analyzeWorkbook(bytes, { fileName: "sample-macro.xlsm", now: NOW });
    const finding = result.findings.find((entry) => entry.ruleId === "VBA_PRESENT");
    expect(finding?.detail).toContain("プログラムの中身は解析していません");
  });

  it("★ モジュール名が Finding に現れない", () => {
    // 顧客が付けた名前であり、業務内容を推測させうる（§7-2 / C-4 の考え方）。
    // 解析層がそもそも名前を返さない設計になっていることを、出力側からも固定する。
    const result = analyzeWorkbook(bytes, { fileName: "sample-macro.xlsm", now: NOW });
    const serialized = JSON.stringify(result);
    for (const name of ["Module1", "ThisWorkbook", "Sheet1", "VBAProject"]) {
      expect(serialized, `Finding に「${name}」`).not.toContain(name);
    }
  });

  it("★ VBA のソース断片が Finding に現れない", () => {
    // 中身は圧縮されているのでそのままでは読めないが、将来 P2-C で伸長したときに
    // うっかり載せないよう、ここで網を張っておく。
    const result = analyzeWorkbook(bytes, { fileName: "sample-macro.xlsm", now: NOW });
    const serialized = JSON.stringify(result);
    for (const token of ["Sub ", "End Sub", "MsgBox", "Dim "]) {
      expect(serialized, `Finding に「${token}」`).not.toContain(token);
    }
  });

  it("拡張子から .xlsm と判別する", () => {
    expect(analyzeWorkbook(bytes, { fileName: "sample-macro.xlsm", now: NOW }).file.format).toBe("xlsm");
  });
});

describe("★ VBA ソースが Finding に漏れないこと（引き継ぎ書 §7-2）", () => {
  // マクロは顧客の業務ロジックそのもの。件数と類型だけを出し、コードは一切出さない。
  const leakSamples: Record<string, string[]> = {
    "vba-network--detected": ["MSXML2", "XMLHTTP", "example.invalid", "通信サンプル"],
    "vba-shell--detected": ["Shell", "notepad.exe", "外部起動サンプル"],
    "vba-file--detected": ["Open", "output.txt", "出力サンプル"],
    "vba-database--detected": ["ADODB", "SQLOLEDB", "dbsrv01", "取込サンプル"],
    "vba-credential--detected": ["DummyPass123", "Unprotect", "保護解除サンプル"],
    "vba-autorun--detected": ["Auto_Open", "開きました"],
  };

  it.each(Object.entries(leakSamples))("%s のソースが出力に現れない", (caseId, samples) => {
    const testCase = allCases.find((entry) => entry.id === caseId);
    expect(testCase, `ケースが無い: ${caseId}`).toBeDefined();

    const result = analyzeWorkbook(testCase!.build(), { fileName: `${caseId}.xlsm`, now: NOW });
    const serialized = JSON.stringify(result);

    // 検出自体はされていること（空振りで通ってしまわないように）。
    expect(serialized).toContain("VBA_");

    for (const sample of samples) {
      expect(serialized, `Finding に「${sample}」`).not.toContain(sample);
    }
  });

  it("モジュール名も出さない", () => {
    const testCase = allCases.find((entry) => entry.id === "vba-network--detected")!;
    const result = analyzeWorkbook(testCase.build(), { fileName: "x.xlsm", now: NOW });
    expect(JSON.stringify(result)).not.toContain("Module1");
  });
});

describe("検証用ファイルの有無", () => {
  it("実ファイルによる検証が行われたかを明示する", () => {
    if (!hasSample) {
      console.warn(
        `[vba] ${SAMPLE} が無いため、Excel の実ファイルによる検証を飛ばしました。` +
          "MS-OVBA まわりは実物でしか確かめられないので、公開前に必ず通すこと。",
      );
    }
    expect(true).toBe(true);
  });
});
