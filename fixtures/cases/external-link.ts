// EXT_LINK_PRESENT / EXT_LINK_BROKEN: 他ブックへの外部参照。
//
// 類型としての問題: 参照先のブックが移動・改名・削除されると計算が壊れる。
// UNC やローカル絶対パスの参照は、作成者のPC環境に依存しているため特に壊れやすい。
//
// C-4: 参照先パスはすべて架空のサーバ名・ドライブ構成。

import { buildXlsx } from "../ooxml";
import { baseSheet } from "./common";
import type { FixtureCase } from "./types";

const present: FixtureCase = {
  id: "external-link--detected",
  ruleId: "EXT_LINK_PRESENT",
  expectation: "detected",
  description: "他ブックへの外部参照を1件含む。xl/externalLinks/ が存在すること。",
  build: () =>
    buildXlsx({
      sheets: [
        {
          ...baseSheet(),
          cells: [
            ...(baseSheet().cells ?? []),
            { ref: "C2", formula: "[1]Sheet1!$A$1" },
          ],
        },
      ],
      externalLinks: [{ target: "../共有/参照元ブック.xlsx", sheetNames: ["データ"] }],
    }),
};

const presentClean: FixtureCase = {
  id: "external-link--clean",
  ruleId: "EXT_LINK_PRESENT",
  expectation: "clean",
  description: "外部参照を一切含まない。xl/externalLinks/ が存在しないこと。",
  build: () => buildXlsx({ sheets: [baseSheet()] }),
};

const broken: FixtureCase = {
  id: "external-link-broken--detected",
  ruleId: "EXT_LINK_BROKEN",
  expectation: "detected",
  description: "参照先が UNC パスとローカル絶対パス。環境依存で壊れやすいものとして検出されること。",
  build: () =>
    buildXlsx({
      sheets: [baseSheet()],
      externalLinks: [
        { target: "\\\\filesrv01\\共有フォルダ\\集計\\参照元ブック.xlsx", sheetNames: ["データ"] },
        { target: "file:///C:/Users/sample-user/Desktop/旧台帳.xlsx", sheetNames: ["Sheet1"] },
      ],
    }),
};

const brokenClean: FixtureCase = {
  id: "external-link-broken--clean",
  ruleId: "EXT_LINK_BROKEN",
  expectation: "clean",
  description: "外部参照はあるが相対パス。UNC / 絶対パスとしては検出されないこと。",
  build: () =>
    buildXlsx({
      sheets: [baseSheet()],
      externalLinks: [{ target: "../共有/参照元ブック.xlsx", sheetNames: ["データ"] }],
    }),
};

export const externalLinkCases: FixtureCase[] = [present, presentClean, broken, brokenClean];
