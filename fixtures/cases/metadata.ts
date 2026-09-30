// ブックのメタデータ・付随パーツに関するルール。
//
// VBA_PRESENT           : VBAマクロを含む（Phase 1 は有無のみ）
// AUTHOR_SINGLE_LEGACY  : 作成者と最終更新者が同一かつ更新が長期間ない（属人化の兆候）
// PIVOT_CACHE_STALE     : ピボットキャッシュが肥大 / 更新日が古い
//
// C-4: 作成者名は架空の記号的な名前のみ。実在の人物・組織を想起させる語を使わない。

import { buildXlsx } from "../ooxml";
import { baseSheet } from "./common";
import type { FixtureCase } from "./types";

// --- VBA_PRESENT -----------------------------------------------------------

const vbaPresent: FixtureCase = {
  id: "vba-present--detected",
  ruleId: "VBA_PRESENT",
  expectation: "detected",
  description: "xl/vbaProject.bin を含む（.xlsm 相当）。VBAの存在として検出されること。",
  build: () => buildXlsx({ sheets: [baseSheet()], vba: true }),
};

const vbaAbsent: FixtureCase = {
  id: "vba-present--clean",
  ruleId: "VBA_PRESENT",
  expectation: "clean",
  description: "VBAを含まない通常の .xlsx。検出されないこと。",
  build: () => buildXlsx({ sheets: [baseSheet()] }),
};

// --- AUTHOR_SINGLE_LEGACY --------------------------------------------------
// 閾値: 作成者 == 最終更新者 かつ 最終更新から 730 日以上

const authorLegacy: FixtureCase = {
  id: "author-single-legacy--detected",
  ruleId: "AUTHOR_SINGLE_LEGACY",
  expectation: "detected",
  description: "作成者と最終更新者が同一で、最終更新が10年以上前。属人化の兆候として検出されること。",
  build: () =>
    buildXlsx({
      sheets: [baseSheet()],
      docProps: {
        creator: "担当者A",
        lastModifiedBy: "担当者A",
        created: "2014-04-01T09:00:00Z",
        modified: "2015-06-30T17:30:00Z",
      },
    }),
};

const authorLegacyClean: FixtureCase = {
  id: "author-single-legacy--clean",
  ruleId: "AUTHOR_SINGLE_LEGACY",
  expectation: "clean",
  description: "作成者と最終更新者が異なり、更新も新しい。検出されないこと。",
  build: () =>
    buildXlsx({
      sheets: [baseSheet()],
      docProps: {
        creator: "担当者A",
        lastModifiedBy: "担当者B",
        created: "2024-04-01T09:00:00Z",
        modified: "2026-07-01T10:00:00Z",
      },
    }),
};

// --- PIVOT_CACHE_STALE -----------------------------------------------------
// 閾値は暫定。承認済みの4件には含まれていないため、実データ調整時に開発者確認が必要。
// 暫定: 最終更新から 730 日以上、または レコード数 100,000 以上。

const pivotStale: FixtureCase = {
  id: "pivot-cache-stale--detected",
  ruleId: "PIVOT_CACHE_STALE",
  expectation: "detected",
  description: "ピボットキャッシュの更新日が古く、レコード数も多い。検出されること。",
  build: () =>
    buildXlsx({
      sheets: [baseSheet()],
      pivotCaches: [{ refreshedDate: "2016-03-15T10:00:00Z", recordCount: 250_000 }],
    }),
};

const pivotFresh: FixtureCase = {
  id: "pivot-cache-stale--clean",
  ruleId: "PIVOT_CACHE_STALE",
  expectation: "clean",
  description: "ピボットキャッシュは新しくレコード数も小さい。検出されないこと。",
  build: () =>
    buildXlsx({
      sheets: [baseSheet()],
      pivotCaches: [{ refreshedDate: "2026-07-20T09:00:00Z", recordCount: 1_200 }],
    }),
};

export const metadataCases: FixtureCase[] = [
  vbaPresent,
  vbaAbsent,
  authorLegacy,
  authorLegacyClean,
  pivotStale,
  pivotFresh,
];
