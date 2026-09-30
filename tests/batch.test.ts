// 一括スキャンの検証。
//
// Worker を起こす部分は Node では動かないため、集計・並べ替え・書き出しという
// 純粋な部分を対象にする。端から端までの確認は npm run browser-check が行う。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeWorkbook } from "../src/analysis";
import { sortBySeverity, summarizeBatch, type BatchEntry } from "../src/batch";
import { ACCESS_NOTICE, CONTACT_URL, REPORT_TERMS } from "../src/report/branding";
import { buildBatchReportHtml, buildBatchReportJson, batchReportFileName } from "../src/report/export";
import { allCases } from "../fixtures/cases";
import { buildXlsx, FIXTURE_SENTINEL } from "../fixtures/ooxml";

const NOW = new Date("2026-08-16T00:00:00Z");

function entryFor(caseId: string, fileName = `${caseId}.xlsx`): BatchEntry {
  const testCase = allCases.find((entry) => entry.id === caseId);
  if (!testCase) throw new Error(`ケースが見つかりません: ${caseId}`);
  const bytes = testCase.build();
  return {
    fileName,
    sizeBytes: bytes.length,
    status: "done",
    result: analyzeWorkbook(bytes, { fileName, now: NOW }),
  };
}

const unsupported: BatchEntry = {
  fileName: "説明資料.pdf",
  sizeBytes: 1234,
  status: "unsupported",
  message: "このツールが対応しているのは .xlsx と .xlsm です。",
};

const broken: BatchEntry = {
  fileName: "壊れた台帳.xlsx",
  sizeBytes: 10,
  status: "error",
  message: "ファイルの解析中に問題が発生しました。",
};

describe("集計", () => {
  it("解析できたファイルの件数を合算する", () => {
    const entries = [entryFor("pii-column-unprotected--detected"), entryFor("hidden-sheet--detected"), unsupported];
    const result = summarizeBatch(entries, NOW);

    expect(result.summary.files).toBe(3);
    expect(result.summary.analyzed).toBe(2);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.red).toBe(1); // PII の1件
    expect(result.summary.yellow).toBe(1); // 非表示シートの1件
  });

  it("対象外・失敗があっても全体は成立する", () => {
    const result = summarizeBatch([unsupported, broken], NOW);
    expect(result.summary.analyzed).toBe(0);
    expect(result.summary.skipped).toBe(2);
    expect(result.summary.red).toBe(0);
  });

  it("スキーマの体裁が単一ファイル版と揃っている", () => {
    const result = summarizeBatch([entryFor("hidden-sheet--detected")], NOW);
    expect(result.schemaVersion).toBe("1.0");
    expect(result.scannedAt).toBe("2026-08-16T00:00:00.000Z");
    expect(result.toolVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("並べ替え", () => {
  it("要対応の多い順、次に注意の多い順に並ぶ", () => {
    const entries = [
      entryFor("hidden-sheet--detected", "b.xlsx"), // RED 0 / YELLOW 1
      entryFor("pii-column-unprotected--detected", "a.xlsx"), // RED 1
      entryFor("hidden-sheet--clean", "c.xlsx"), // 0 / 0
    ];
    expect(sortBySeverity(entries).map((entry) => entry.fileName)).toEqual(["a.xlsx", "b.xlsx", "c.xlsx"]);
  });

  it("対象外は最後に回る", () => {
    const entries = [unsupported, entryFor("hidden-sheet--clean", "a.xlsx")];
    expect(sortBySeverity(entries).map((entry) => entry.fileName)).toEqual(["a.xlsx", "説明資料.pdf"]);
  });
});

describe("一括レポートの書き出し", () => {
  const result = summarizeBatch(
    [entryFor("pii-column-unprotected--detected"), entryFor("hidden-sheet--detected"), unsupported, broken],
    NOW,
  );
  const html = buildBatchReportHtml(result);

  it("ファイル別の一覧と検出項目が載る", () => {
    expect(html).toContain("pii-column-unprotected--detected.xlsx");
    expect(html).toContain("個人情報にあたる可能性のある列があります");
    expect(html).toContain("対象外");
  });

  it("保存物にも CSP・利用条件・著作権表記が入る", () => {
    expect(html).toContain("connect-src 'none'");
    for (const line of REPORT_TERMS) expect(html).toContain(line);
    expect(html).toMatch(/©\s*\d{4}\s*keiru/);
  });

  it("script タグを含まない", () => {
    expect(html).not.toMatch(/<script/i);
  });

  it("JSON は各ファイルの結果をそのまま収める", () => {
    const parsed = JSON.parse(buildBatchReportJson(result));
    expect(parsed.files).toHaveLength(4);
    expect(parsed.files[0].result.schemaVersion).toBe("1.0");
  });

  it("保存ファイル名に元のファイル名を含めない", () => {
    expect(batchReportFileName(result, "html")).toMatch(/^業務ファイル健診_一括診断レポート-\d{8}\.html$/);
  });
});

describe("★ 未信頼データの扱い", () => {
  it("細工されたファイル名がレポートで実行可能な形にならない", () => {
    const bytes = buildXlsx({ sheets: [{ name: "集計", cells: [{ ref: "A1", value: "項目" }] }] });
    const entry: BatchEntry = {
      fileName: `<img src=x onerror="alert(1)">.xlsx`,
      sizeBytes: bytes.length,
      status: "done",
      result: analyzeWorkbook(bytes, { fileName: "safe.xlsx", now: NOW }),
    };
    const html = buildBatchReportHtml(summarizeBatch([entry], NOW));

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("一括レポートにもセル値が現れない", () => {
    const entries = allCases.slice(0, 8).map((testCase) => entryFor(testCase.id));
    const result = summarizeBatch(entries, NOW);
    expect(buildBatchReportHtml(result)).not.toContain(FIXTURE_SENTINEL);
    expect(buildBatchReportJson(result)).not.toContain(FIXTURE_SENTINEL);
  });

  it("フォルダ内のパスを持ち込まない設計であること（ファイル名のみ）", () => {
    // runBatch は file.name しか使わない。フォルダ内の相対パスを使うと §7-2 違反になる。
    // 注意の記述自体はコメントに残しているので、コメントを除いたコードだけを見る。
    const code = readFileSync("src/batch.ts", "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(code).not.toContain("webkitRelativePath");
  });
});


describe("Access ファイルの扱い（引き継ぎ書 §8 R-2 の選択肢B）", () => {
  const accessEntry: BatchEntry = {
    fileName: "在庫管理.accdb",
    sizeBytes: 4096,
    status: "unsupported",
    reason: "access",
    message: ACCESS_NOTICE,
  };

  it("他の対象外と区別して記録される", () => {
    expect(accessEntry.reason).toBe("access");
    expect(unsupported.reason ?? "unsupported-extension").not.toBe("access");
  });

  it("案内文が「診断できません」で終わらず、相談につながる", () => {
    // 突き放すと、最も診断の必要度が高い相手を取りこぼす（§1.1 のファネル）。
    expect(ACCESS_NOTICE).toContain("診断できません");
    expect(ACCESS_NOTICE).toContain("ご相談");
  });

  it("一括レポートにも案内と問い合わせ先が載る", () => {
    const result = summarizeBatch([entryFor("hidden-sheet--detected"), accessEntry], NOW);
    const html = buildBatchReportHtml(result);
    expect(html).toContain("在庫管理.accdb");
    expect(html).toContain("Accessファイル");
    expect(html).toContain(CONTACT_URL!);
  });

  it("集計上は対象外として数える", () => {
    const result = summarizeBatch([entryFor("hidden-sheet--detected"), accessEntry], NOW);
    expect(result.summary.analyzed).toBe(1);
    expect(result.summary.skipped).toBe(1);
  });
});
