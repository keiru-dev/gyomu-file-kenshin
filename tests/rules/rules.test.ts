// 検出ルールの横断テスト。
//
// 引き継ぎ書 §10 が求める「各ルールについて、架空フィクスチャで検出・非検出の両方を検証」を
// レジストリ駆動で行う。ルールを登録すれば自動でこの網に掛かる。

import { describe, expect, it } from "vitest";
import { allCases } from "../../fixtures/cases";
import { FIXTURE_SENTINEL } from "../../fixtures/ooxml";
import { RULES, runRules } from "../../src/rules";
import { MAX_LOCATIONS } from "../../src/rules/helpers";
import { contextFor, contextForCase } from "./support";

// INFO 群は検出/非検出という性質を持たないため、フィクスチャ対応の検証からは外す。
const registeredRuleIds = RULES.filter((rule) => rule.informational !== true).map((rule) => rule.id);

describe.each(registeredRuleIds)("%s", (ruleId) => {
  const cases = allCases.filter((testCase) => testCase.ruleId === ruleId);

  it("対応するフィクスチャが検出用・非検出用ともに存在する", () => {
    expect(cases.some((testCase) => testCase.expectation === "detected")).toBe(true);
    expect(cases.some((testCase) => testCase.expectation === "clean")).toBe(true);
  });

  describe.each(cases.map((testCase) => [testCase.id, testCase] as const))("%s", (_id, testCase) => {
    it(testCase.expectation === "detected" ? "検出される" : "検出されない", () => {
      const findings = runRules(contextForCase(testCase));
      const matched = findings.filter((finding) => finding.ruleId === ruleId);
      if (testCase.expectation === "detected") {
        expect(matched).toHaveLength(1);
        expect(matched[0]!.occurrences).toBeGreaterThan(0);
      } else {
        expect(matched).toHaveLength(0);
      }
    });
  });
});

describe("Phase 1 の網羅", () => {
  /** 引き継ぎ書 §5.3 の RED / YELLOW 全17ルール。 */
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

  /** Phase 2 で追加した VBA ソースの静的解析（引き継ぎ書 §3 Phase 2）。 */
  const PHASE2_RULES = [
    "VBA_NETWORK_ACCESS",
    "VBA_SHELL_EXEC",
    "VBA_HARDCODED_CREDENTIAL",
    "VBA_FILE_ACCESS",
    "VBA_EXTERNAL_DB",
    "VBA_AUTO_RUN",
  ].sort();

  it("Phase 1 の全17ルールが登録されている", () => {
    for (const ruleId of PHASE1_RULES) expect(registeredRuleIds).toContain(ruleId);
  });

  it("登録されているのは Phase 1 と Phase 2 のルールだけ", () => {
    expect([...registeredRuleIds].sort()).toEqual([...PHASE1_RULES, ...PHASE2_RULES].sort());
  });

  it("INFO の基礎指標が常に出力される", () => {
    const findings = runRules(contextFor("hidden-sheet--clean"));
    const info = findings.filter((finding) => finding.severity === "INFO");
    expect(info.length).toBeGreaterThanOrEqual(6);
    expect(info.map((finding) => finding.ruleId)).toContain("INFO_SHEET_COUNT");
  });
});

describe("★ Finding に元データが漏れていないこと（引き継ぎ書 §7-2）", () => {
  it("セル値（番兵）が Finding に現れない", () => {
    for (const testCase of allCases) {
      const serialized = JSON.stringify(runRules(contextForCase(testCase)));
      expect(serialized, testCase.id).not.toContain(FIXTURE_SENTINEL);
    }
  });

  it("数式文字列が Finding に現れない", () => {
    // 数式には顧客由来の文字列リテラルが埋まっていることがあるため、判定にのみ使う。
    for (const testCase of allCases) {
      const context = contextForCase(testCase);
      const serialized = JSON.stringify(runRules(context));
      for (const sheet of context.cells.sheets) {
        for (const entry of sheet.formulas) {
          expect(serialized, `${testCase.id} / ${entry.ref}`).not.toContain(entry.formula);
        }
      }
    }
  });

  it("外部参照のパスが Finding に現れない", () => {
    for (const testCase of allCases) {
      const context = contextForCase(testCase);
      const serialized = JSON.stringify(runRules(context));
      for (const link of context.container.externalLinks) {
        expect(serialized, `${testCase.id}`).not.toContain(link.target);
      }
    }
  });

  it("接続文字列・接続名が Finding に現れない", () => {
    for (const testCase of allCases) {
      const context = contextForCase(testCase);
      const serialized = JSON.stringify(runRules(context));
      for (const connection of context.container.connections) {
        expect(serialized, `${testCase.id}`).not.toContain(connection.connectionString);
        expect(serialized, `${testCase.id}`).not.toContain(connection.name);
      }
    }
  });

  it("作成者名が Finding に現れない", () => {
    const context = contextFor("author-single-legacy--detected");
    const serialized = JSON.stringify(runRules(context));
    expect(context.container.docProps?.creator).toBe("担当者A");
    expect(serialized).not.toContain("担当者A");
  });

  it("パスワードらしき値が Finding に現れない", () => {
    const serialized = JSON.stringify(runRules(contextFor("hardcoded-credential--detected")));
    expect(serialized).not.toContain("DummyPass123");
    expect(serialized).not.toContain("dbsrv01");
  });
});

describe("Finding の形", () => {
  const findingsByCase = allCases.map(
    (testCase) => [testCase.id, runRules(contextForCase(testCase))] as const,
  );

  it("locations は上限を超えない", () => {
    for (const [caseId, findings] of findingsByCase) {
      for (const finding of findings) {
        expect(finding.locations.length, `${caseId} / ${finding.ruleId}`).toBeLessThanOrEqual(MAX_LOCATIONS);
      }
    }
  });

  it("occurrences は locations の件数以上（打ち切っても総数は正確）", () => {
    for (const [caseId, findings] of findingsByCase) {
      for (const finding of findings) {
        expect(finding.occurrences, `${caseId} / ${finding.ruleId}`).toBeGreaterThanOrEqual(
          finding.locations.length,
        );
      }
    }
  });

  it("title / detail / impact が空でない", () => {
    for (const [caseId, findings] of findingsByCase) {
      for (const finding of findings) {
        expect(finding.title.length, `${caseId} / ${finding.ruleId}`).toBeGreaterThan(0);
        expect(finding.detail.length, `${caseId} / ${finding.ruleId}`).toBeGreaterThan(0);
        expect(finding.impact.length, `${caseId} / ${finding.ruleId}`).toBeGreaterThan(0);
      }
    }
  });

  it("英語の重大度ラベルを文言に含めない（信号機のみ）", () => {
    const forbidden = /\b(CRITICAL|HIGH|MEDIUM|LOW|SEVERE|WARNING|ERROR)\b/;
    for (const [caseId, findings] of findingsByCase) {
      for (const finding of findings) {
        const text = `${finding.title} ${finding.detail} ${finding.impact}`;
        expect(forbidden.test(text), `${caseId} / ${finding.ruleId}`).toBe(false);
      }
    }
  });

  it("煽り文言を含めない", () => {
    // 引き継ぎ書 §7-5。検出事実と想定される影響のみを書く。
    const forbidden = ["今すぐ", "重大な損失", "危険です", "手遅れ", "必ず失敗"];
    for (const [caseId, findings] of findingsByCase) {
      for (const finding of findings) {
        const text = `${finding.title} ${finding.detail} ${finding.impact}`;
        for (const word of forbidden) {
          expect(text.includes(word), `${caseId} / ${finding.ruleId} に「${word}」`).toBe(false);
        }
      }
    }
  });
});
