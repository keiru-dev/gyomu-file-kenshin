// レポート書き出しの検証。
//
// ここは文字列連結で HTML を組み立てる唯一の場所なので、**未信頼データのエスケープ**を重点的に見る。
// 顧客のExcelは未信頼入力であり、細工されたシート名がそのまま埋まると、保存したレポートを
// 開いた人の環境でスクリプトが動く（CLAUDE.md ★節）。

import { describe, expect, it } from "vitest";
import { analyzeWorkbook } from "../../src/analysis";
import { buildReportHtml, buildReportJson, escapeHtml, overallComment, reportFileName } from "../../src/report/export";
import { BUILD_ID, CONTACT_URL, COPYRIGHT, REPORT_TERMS, TERMS } from "../../src/report/branding";
import { allCases } from "../../fixtures/cases";
import { buildXlsx, FIXTURE_SENTINEL } from "../../fixtures/ooxml";

const NOW = new Date("2026-08-09T00:00:00Z");

function analyze(caseId: string) {
  const testCase = allCases.find((entry) => entry.id === caseId);
  if (!testCase) throw new Error(`ケースが見つかりません: ${caseId}`);
  return analyzeWorkbook(testCase.build(), { fileName: `${caseId}.xlsx`, now: NOW });
}

describe("escapeHtml", () => {
  it("HTML の特殊文字をすべて実体参照にする", () => {
    expect(escapeHtml(`<img src="x" onerror='alert(1)'>&`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;",
    );
  });

  it("& を二重エスケープしない順序で処理する", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("★ 未信頼データのエスケープ", () => {
  /** 細工されたシート名を持つブック。シートを隠すことで HIDDEN_SHEET の locations に載る。 */
  function hostileWorkbook() {
    return buildXlsx({
      sheets: [
        { name: "集計表", cells: [{ ref: "A1", value: "項目" }] },
        {
          name: `<img src=x onerror="alert(1)">`,
          state: "hidden",
          cells: [{ ref: "A1", value: "見出し" }],
        },
      ],
    });
  }

  it("シート名の細工がレポートHTMLで実行可能な形にならない", () => {
    const result = analyzeWorkbook(hostileWorkbook(), { fileName: "hostile.xlsx", now: NOW });
    const html = buildReportHtml(result);

    // 生のタグとして出ていないこと。
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onerror="alert(1)"');
    // エスケープされた形で含まれていること（＝情報自体は落とさない）。
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("ファイル名の細工もエスケープされる", () => {
    const result = analyzeWorkbook(hostileWorkbook(), {
      fileName: `<script>alert(1)</script>.xlsx`,
      now: NOW,
    });
    const html = buildReportHtml(result);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("レポートHTMLに script タグが1つも無い（保存物は静的HTML）", () => {
    const result = analyzeWorkbook(hostileWorkbook(), { fileName: "hostile.xlsx", now: NOW });
    expect(buildReportHtml(result)).not.toMatch(/<script/i);
  });
});

describe("レポートHTMLの中身", () => {
  const result = analyze("pii-column-unprotected--detected");
  const html = buildReportHtml(result);

  it("保存物にも CSP を入れている", () => {
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("connect-src 'none'");
  });

  it("著作権表記とライセンス表記がある（C-5 / ブランド規約）", () => {
    expect(html).toContain(COPYRIGHT);
    expect(COPYRIGHT).toMatch(/^© \d{4} keiru$/);
    expect(html).toContain("Apache-2.0");
    expect(html).toContain("MIT");
  });

  it("問い合わせ導線が固定の識別子つきで入っている", () => {
    // CONTACT_URL=none でビルドした版では URL を持たない（docs/distribution.md）。
    // 既定のビルドでは URL がある前提でここを固定しておく。
    expect(CONTACT_URL).not.toBeNull();
    expect(html).toContain(CONTACT_URL!);
    expect(CONTACT_URL!).toContain("?from=scanner");
    // 流入元は追いたいので noreferrer は付けない。
    expect(html).toContain('rel="noopener"');
    expect(html).not.toContain("noreferrer");
  });

  it("検出項目と該当箇所が載る", () => {
    expect(html).toContain("個人情報にあたる可能性のある列があります");
    expect(html).toContain("名簿!A列（氏名）");
  });
});

describe("★ 利用条件（MIT 公開 / 2026-09-30 判断）", () => {
  const result = analyze("pii-column-unprotected--detected");
  const html = buildReportHtml(result);

  it("内容の確認・検証を明示的に許可している", () => {
    // このツールの営業上の武器は「ソースをご確認ください」と言えること（引き継ぎ書 §1.3）。
    expect(TERMS[0]).toContain("確認・検証は自由");
    expect(TERMS.join("")).toContain("解析を歓迎");
  });

  it("解析やリバースエンジニアリングを制限する文言を含まない", () => {
    // ここに一般的な「リバースエンジニアリング禁止」条項を入れると、情シスが検証できなくなり、
    // 「審査対象にならない」という設計の核心を自分で無効化してしまう。
    const forbidden = ["リバースエンジニア", "逆コンパイル", "解析を禁止", "解析してはならない", "難読化"];
    for (const word of forbidden) {
      expect(TERMS.join(""), `利用条件に「${word}」`).not.toContain(word);
    }
  });

  it("MIT ライセンスで改変・再配布できることを示し、改変版には非通信の保証が及ばないと断っている", () => {
    // 2026-09-30 に MIT 公開へ転換。改変版の配布禁止・文言転用禁止は MIT と矛盾するため置かない。
    const joined = TERMS.join("");
    expect(joined).toContain("MIT ライセンス");
    expect(joined).toContain("改変・再配布ができます");
    expect(joined).toContain("改変した版には");
    expect(joined).not.toContain("配布は禁止");
    expect(joined).not.toContain("転用は禁止");
  });

  it("レポートにはレポート用の取り扱いが入る（読み手が顧客なので別文面）", () => {
    for (const line of REPORT_TERMS) expect(html).toContain(line);
    // 顧客がまず知りたいのは「社内で回して大丈夫か」なので、そこに先に答える。
    expect(REPORT_TERMS[0]).toContain("含まれていません");
    expect(REPORT_TERMS.join("")).toContain("複製・共有は自由");
  });

  it("配布識別子が埋め込まれている", () => {
    // 流出経路を追う手がかり。DIST_TAG を付けると "note/abc1234-20260816" の形になる。
    expect(BUILD_ID).toMatch(/^(?:[^/]+\/)?[0-9a-f]{7,}-\d{8}$|^(?:[^/]+\/)?nogit-\d{8}$/);
    expect(html).toContain(BUILD_ID);
  });
});

describe("総合判定の文言", () => {
  it("RED があれば件数を伝える", () => {
    const result = analyze("pii-column-unprotected--detected");
    expect(overallComment(result)).toContain("対応をご検討いただきたい項目");
  });

  it("0 件の側は文章に出さない（「注意したい項目が 0 件」と書かない）", () => {
    const result = analyze("pii-column-unprotected--detected");
    expect(result.summary.yellow).toBe(0);
    expect(overallComment(result)).not.toContain("0 件");
  });

  it("RED が無く YELLOW だけなら、壊れていないことを先に伝える", () => {
    const result = analyze("hidden-sheet--detected");
    expect(overallComment(result)).toContain("すぐに壊れる状態ではありませんが");
  });

  it("何も無ければ素直にそう出す（煽らない）", () => {
    const clean = analyzeWorkbook(
      buildXlsx({ sheets: [{ name: "集計表", cells: [{ ref: "A1", value: "項目" }] }] }),
      { fileName: "clean.xlsx", now: NOW },
    );
    expect(overallComment(clean)).toBe("問題は検出されませんでした。");
  });
});

describe("★ 保存物に元データが含まれないこと（引き継ぎ書 §10）", () => {
  it("全フィクスチャで、HTML と JSON のどちらにも番兵が現れない", () => {
    for (const testCase of allCases) {
      const result = analyzeWorkbook(testCase.build(), { fileName: `${testCase.id}.xlsx`, now: NOW });
      expect(buildReportHtml(result), `${testCase.id} / HTML`).not.toContain(FIXTURE_SENTINEL);
      expect(buildReportJson(result), `${testCase.id} / JSON`).not.toContain(FIXTURE_SENTINEL);
    }
  });

  it("HTML に数式・外部参照パス・接続文字列・作成者名が現れない", () => {
    const leakSamples = ["VLOOKUP(", "SUM(B2:B3)", "filesrv01", "dbsrv01", "DummyPass123", "担当者A"];
    for (const testCase of allCases) {
      const html = buildReportHtml(
        analyzeWorkbook(testCase.build(), { fileName: `${testCase.id}.xlsx`, now: NOW }),
      );
      for (const sample of leakSamples) {
        expect(html, `${testCase.id} に「${sample}」`).not.toContain(sample);
      }
    }
  });
});

describe("保存ファイル名", () => {
  it("走査日から YYYYMMDD を作る", () => {
    const result = analyze("hidden-sheet--detected");
    expect(reportFileName(result, "html")).toMatch(/^業務ファイル健診_診断レポート-\d{8}\.html$/);
    expect(reportFileName(result, "json")).toMatch(/^業務ファイル健診_診断レポート-\d{8}\.json$/);
  });

  it("元のファイル名を保存名に含めない（第三者に渡る名前に情報を載せない）", () => {
    const result = analyzeWorkbook(allCases[0]!.build(), { fileName: "顧客一覧.xlsx", now: NOW });
    expect(reportFileName(result, "html")).not.toContain("顧客一覧");
  });
});

describe("確認した項目（検出0件のときに効く節）", () => {
  /** 問題を仕込んでいない、素直なブック。 */
  function cleanWorkbook() {
    return buildXlsx({
      sheets: [{ name: "集計表", cells: [{ ref: "A1", value: "項目" }] }],
    });
  }

  it("★ 検出が0件でも「確認した項目」が出る（何を見たうえでの0件かを示す）", () => {
    const result = analyzeWorkbook(cleanWorkbook(), { fileName: "clean.xlsx", now: NOW });
    expect(result.summary.red).toBe(0);

    const html = buildReportHtml(result);
    expect(html).toContain("確認した項目");
    // LP と同じ6区分のうち、少なくとも代表的なものが出ていること。
    expect(html).toContain("壊れている計算");
    expect(html).toContain("個人情報らしき列");
    // 個々の確認内容も出ていること。
    expect(html).toContain("参照先を失った数式");
  });

  it("すべて確認できたときは「確認しきれなかった範囲」を出さない", () => {
    const result = analyzeWorkbook(cleanWorkbook(), { fileName: "clean.xlsx", now: NOW });
    expect(result.limitations).toEqual([]);
    expect(buildReportHtml(result)).not.toContain("確認しきれなかった範囲");
    expect(buildReportHtml(result)).not.toContain("（一部のみ）");
  });

  it("限定があるときは、その範囲と印の両方が出る", () => {
    const base = analyzeWorkbook(cleanWorkbook(), { fileName: "clean.xlsx", now: NOW });
    const result = {
      ...base,
      limitations: [{ ruleIds: ["REF_ERROR"], reason: "テスト用の限定理由です。" }],
    };

    const html = buildReportHtml(result);
    expect(html).toContain("確認しきれなかった範囲");
    expect(html).toContain("テスト用の限定理由です。");
    expect(html).toContain("（一部のみ）");
  });

  it("この節にも元データ（番兵）が現れない", () => {
    for (const testCase of allCases) {
      const result = analyzeWorkbook(testCase.build(), {
        fileName: `${testCase.id}.xlsx`,
        now: NOW,
      });
      expect(buildReportHtml(result), testCase.id).not.toContain(FIXTURE_SENTINEL);
    }
  });
});
