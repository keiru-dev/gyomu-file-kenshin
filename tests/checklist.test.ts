// 「確認した項目」の一覧。
//
// ★ この一覧は顧客に「これを確認しました」と示すもの。実態とずれた瞬間に、
// やっていないことをやったと書くことになる（CLAUDE.md §7-7）。
// そのため、一覧の中身そのものより **ルールとの対応が崩れないこと** を検査する。

import { describe, expect, it } from "vitest";
import { RULES } from "../src/rules";
import { buildCheckGroups, buildCoverageNotes, countCheckItems } from "../src/rules/checklist";
import { CHECK_CATEGORY_LABEL, CHECK_CATEGORY_ORDER } from "../src/rules/types";

const detectionRules = RULES.filter((rule) => rule.informational !== true);

describe("確認した項目の定義", () => {
  it("検出ルールはすべて check を持つ（書き忘れたルールは一覧から消える）", () => {
    const missing = detectionRules.filter((rule) => rule.check === undefined).map((rule) => rule.id);
    expect(missing).toEqual([]);
  });

  it("check.label は「〜か」で終わる（検出しなかったときにも成り立つ書き方）", () => {
    const bad = detectionRules
      .filter((rule) => rule.check !== undefined && !rule.check.label.endsWith("か"))
      .map((rule) => `${rule.id}: ${rule.check?.label ?? ""}`);
    expect(bad).toEqual([]);
  });

  it("check.category は定義済みの区分だけを使う", () => {
    const bad = detectionRules
      .filter((rule) => rule.check !== undefined && !CHECK_CATEGORY_ORDER.includes(rule.check.category))
      .map((rule) => rule.id);
    expect(bad).toEqual([]);
  });

  it("informational なルール（基礎指標）は一覧に含めない", () => {
    const ids = buildCheckGroups().flatMap((group) => group.items.map((item) => item.ruleId));
    expect(ids).not.toContain("INFO_METRICS");
  });

  it("一覧の項目数が検出ルールの数と一致する（取りこぼしが無い）", () => {
    expect(countCheckItems()).toBe(detectionRules.length);
  });

  it("見出しに英語のキーを出さない（信号機と同じ方針）", () => {
    for (const group of buildCheckGroups()) {
      expect(group.label).toBe(CHECK_CATEGORY_LABEL[group.category]);
      expect(group.label).not.toMatch(/[A-Z_]{4,}/);
    }
  });

  it("区分は LP と同じ並び順で出る", () => {
    const order = buildCheckGroups().map((group) => group.category);
    expect(order).toEqual(CHECK_CATEGORY_ORDER.filter((category) => order.includes(category)));
  });
});

describe("確認しきれなかった範囲", () => {
  const none = {
    formulasTruncated: false,
    errorsTruncated: false,
    vbaStreamCount: 0,
    vbaAnalyzedModules: 0,
  };

  it("すべて確認できたときは空", () => {
    expect(buildCoverageNotes(none)).toEqual([]);
  });

  it("★ マクロが無いだけでは限定にしない（確認した結果として無かっただけ）", () => {
    expect(buildCoverageNotes({ ...none, vbaStreamCount: 0, vbaAnalyzedModules: 0 })).toEqual([]);
  });

  it("マクロを全部読めていれば限定にしない", () => {
    expect(buildCoverageNotes({ ...none, vbaStreamCount: 3, vbaAnalyzedModules: 3 })).toEqual([]);
  });

  it("読めなかったマクロがあれば、VBA の確認項目を限定として挙げる", () => {
    const notes = buildCoverageNotes({ ...none, vbaStreamCount: 3, vbaAnalyzedModules: 1 });
    expect(notes).toHaveLength(1);
    expect(notes[0].ruleIds).toContain("VBA_NETWORK_ACCESS");
    expect(notes[0].reason).toContain("2 件");
  });

  it("数式が打ち切られたら、数式に関する確認項目を限定として挙げる", () => {
    const notes = buildCoverageNotes({ ...none, formulasTruncated: true });
    expect(notes).toHaveLength(1);
    expect(notes[0].ruleIds).toEqual([
      "FORMULA_DEEP_NEST",
      "VLOOKUP_HARDCODED_INDEX",
      "VOLATILE_FUNCTION",
    ]);
  });

  it("限定の理由が、実在する ruleId だけを指している", () => {
    const known = new Set(RULES.map((rule) => rule.id));
    const inputs = [
      { ...none, formulasTruncated: true },
      { ...none, errorsTruncated: true },
      { ...none, vbaStreamCount: 2, vbaAnalyzedModules: 0 },
    ];
    for (const input of inputs) {
      for (const note of buildCoverageNotes(input)) {
        for (const ruleId of note.ruleIds) expect(known).toContain(ruleId);
      }
    }
  });
});
