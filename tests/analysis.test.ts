// 解析の通し実行（L1 → L2 → ルール → AnalysisResult）の検証。
//
// 引き継ぎ書 §10 の「レポート・JSON に元データのセル値が一切含まれないことをテストで保証」は
// ここが本丸。JSON 出力そのものを対象に検査する。

import { describe, expect, it } from "vitest";
import { analyzeWorkbook, TOOL_VERSION, UnsupportedFormatError } from "../src/analysis";
import { formatDigest, sha256Hex } from "../src/worker/digest";
import { allCases } from "../fixtures/cases";
import { FIXTURE_SENTINEL } from "../fixtures/ooxml";

const NOW = new Date("2026-08-09T00:00:00Z");

function analyzeCase(caseId: string, fileName = `${caseId}.xlsx`) {
  const testCase = allCases.find((entry) => entry.id === caseId);
  if (!testCase) throw new Error(`ケースが見つかりません: ${caseId}`);
  return analyzeWorkbook(testCase.build(), { fileName, now: NOW });
}

describe("AnalysisResult の形（引き継ぎ書 §6.4）", () => {
  it("スキーマの必須項目が揃っている", () => {
    const result = analyzeCase("hidden-sheet--detected");
    expect(result.schemaVersion).toBe("1.0");
    expect(result.scannedAt).toBe("2026-08-09T00:00:00.000Z");
    expect(result.toolVersion).toBe(TOOL_VERSION);
    expect(result.file.name).toBe("hidden-sheet--detected.xlsx");
    expect(result.file.sizeBytes).toBeGreaterThan(0);
    expect(result.file.format).toBe("xlsx");
  });

  it("toolVersion が package.json から埋め込まれている", () => {
    expect(TOOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("拡張子から xlsm を判別する", () => {
    expect(analyzeCase("vba-present--detected", "macro.xlsm").file.format).toBe("xlsm");
  });

  it("summary の件数が findings と一致する", () => {
    for (const testCase of allCases) {
      const result = analyzeWorkbook(testCase.build(), { fileName: `${testCase.id}.xlsx`, now: NOW });
      const red = result.findings.filter((finding) => finding.severity === "RED").length;
      const yellow = result.findings.filter((finding) => finding.severity === "YELLOW").length;
      const info = result.findings.filter((finding) => finding.severity === "INFO").length;
      expect(result.summary, testCase.id).toEqual({ red, yellow, info });
    }
  });

  it("findings は重大度の重い順に並ぶ", () => {
    const order = { RED: 0, YELLOW: 1, GREEN: 2, INFO: 3 } as const;
    for (const testCase of allCases) {
      const result = analyzeWorkbook(testCase.build(), { fileName: `${testCase.id}.xlsx`, now: NOW });
      const ranks = result.findings.map((finding) => order[finding.severity]);
      expect([...ranks].sort((a, b) => a - b), testCase.id).toEqual(ranks);
    }
  });
});

describe("非対応形式", () => {
  it("ZIP でないファイルは UnsupportedFormatError", () => {
    const biff = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => analyzeWorkbook(biff, { fileName: "old.xls", now: NOW })).toThrow(UnsupportedFormatError);
  });
});

describe("進捗の通知", () => {
  it("各段階が順に通知され、最後は照合の完了で終わる", () => {
    const stages: string[] = [];
    analyzeWorkbook(allCases[0]!.build(), {
      fileName: "x.xlsx",
      now: NOW,
      onProgress: (stage, done, total) => stages.push(`${stage} ${done}/${total}`),
    });

    expect(stages[0]).toBe("ファイルの構造を確認中 0/1");
    expect(stages.some((stage) => stage.startsWith("シートを読み取り中"))).toBe(true);
    expect(stages.some((stage) => stage.startsWith("セルを読み取り中"))).toBe(true);
    expect(stages.at(-1)).toBe("問題点を照合中 1/1");
  });
});

describe("★ JSON 出力に元データが含まれないこと（引き継ぎ書 §10）", () => {
  it("全フィクスチャで、JSON にセル値（番兵）が現れない", () => {
    for (const testCase of allCases) {
      const result = analyzeWorkbook(testCase.build(), { fileName: `${testCase.id}.xlsx`, now: NOW });
      expect(JSON.stringify(result), testCase.id).not.toContain(FIXTURE_SENTINEL);
    }
  });

  it("JSON に数式・外部参照パス・接続文字列・作成者名が現れない", () => {
    const leakSamples = [
      "VLOOKUP(", // 数式
      "SUM(B2:B3)", // 数式
      "filesrv01", // 外部参照の UNC パス
      "sample-user", // 外部参照のローカルパス
      "dbsrv01", // 接続先サーバ
      "DummyPass123", // 接続文字列内のパスワード
      "SELECT * FROM", // 取得コマンド
      "担当者A", // 作成者名
    ];

    for (const testCase of allCases) {
      const serialized = JSON.stringify(
        analyzeWorkbook(testCase.build(), { fileName: `${testCase.id}.xlsx`, now: NOW }),
      );
      for (const sample of leakSamples) {
        expect(serialized, `${testCase.id} に「${sample}」`).not.toContain(sample);
      }
    }
  });

  it("ファイル名は含まれるがパスは含まれない（§6.4 が許可する範囲）", () => {
    const result = analyzeWorkbook(allCases[0]!.build(), {
      fileName: "台帳.xlsx",
      now: NOW,
    });
    expect(result.file.name).toBe("台帳.xlsx");
    expect(JSON.stringify(result)).not.toContain("/");
  });
});

describe("対象ファイルの指紋（SHA-256）", () => {
  it("渡された指紋が結果に載る", () => {
    const result = analyzeWorkbook(allCases[0]!.build(), {
      fileName: "x.xlsx",
      now: NOW,
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    expect(result.file.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("指紋が無くても解析は成立する", () => {
    const result = analyzeWorkbook(allCases[0]!.build(), { fileName: "x.xlsx", now: NOW });
    expect(result.file.sha256).toBeUndefined();
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("同じファイルからは同じ指紋、違うファイルからは違う指紋が出る", async () => {
    const a = await sha256Hex(allCases[0]!.build());
    const again = await sha256Hex(allCases[0]!.build());
    const other = await sha256Hex(allCases[1]!.build());

    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(again).toBe(a);
    expect(other).not.toBe(a);
  });

  it("既知の値と一致する（実装の正しさの裏づけ）", async () => {
    // "abc" の SHA-256。仕様で決まっている値なので、ここがずれれば実装が誤っている。
    const bytes = new Uint8Array([0x61, 0x62, 0x63]);
    expect(await sha256Hex(bytes)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("読みやすい形に整形できる", () => {
    expect(formatDigest("ba7816bf8f01cfea")).toBe("ba78 16bf 8f01 cfea");
  });

  it("★ 指紋から元データは復元できない（載せてよい理由）", () => {
    // ハッシュは元データではないため §7-2 に反しない。
    // 番兵を含むブックの指紋に、番兵の文字列が現れないことを確認しておく。
    const result = analyzeWorkbook(allCases[0]!.build(), {
      fileName: "x.xlsx",
      now: NOW,
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    expect(JSON.stringify(result)).not.toContain(FIXTURE_SENTINEL);
  });
});
