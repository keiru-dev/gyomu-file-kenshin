// VBA ソースの静的解析にかかるルール（Phase 2-C）。
//
// C-4 厳守: マクロはすべて架空。実在の事業体・業務知見・命名規則を一切含まない。
// 「一般的な設計欠陥の類型」を再現するのに必要な最小限のコードだけを書く。
//
// 検出側と非検出側の差が「危ない書き方をしているかどうか」だけになるよう、
// どちらのマクロも同じくらいの分量にしてある。
//
// ★ 手続き名は、レポートの文言に出てくる普通の日本語と衝突しない語にすること。
// 「起動する」「取り込む」のような名前にすると、漏洩テストが自分の文言に反応して
// 誤検知する（実際に踏んだ）。テストが意味を持たなくなるので避ける。

import { buildXlsx, FIXTURE_SENTINEL } from "../ooxml";
import type { FixtureCase } from "./types";

/** どのケースでも共通で置く、当たり障りのないシート。 */
const sheet = {
  name: "集計表",
  cells: [
    { ref: "A1", value: "項目" },
    { ref: "A2", value: `品目1 ${FIXTURE_SENTINEL}` },
  ],
};

/** マクロ入りブックを1つ作る。 */
function withMacro(source: string): Uint8Array {
  return buildXlsx({
    sheets: [sheet],
    vbaModules: [{ name: "Module1", kind: "module", source }],
  });
}

/** 問題のある書き方を含まない、素直なマクロ。非検出側で共通に使う。 */
const HARMLESS_MACRO = [
  "Sub 集計する()",
  "    Dim 合計 As Double",
  "    Dim 行 As Long",
  "    For 行 = 2 To 10",
  "        合計 = 合計 + Cells(行, 2).Value",
  "    Next 行",
  "    Cells(1, 4).Value = 合計",
  "End Sub",
].join("\r\n");

function pair(
  id: string,
  ruleId: string,
  description: string,
  detectedSource: string,
  cleanSource = HARMLESS_MACRO,
): FixtureCase[] {
  return [
    {
      id: `${id}--detected`,
      ruleId,
      expectation: "detected",
      description,
      build: () => withMacro(detectedSource),
    },
    {
      id: `${id}--clean`,
      ruleId,
      expectation: "clean",
      description: "同種の記述を含まないマクロ。検出されないこと。",
      build: () => withMacro(cleanSource),
    },
  ];
}

export const vbaCodeCases: FixtureCase[] = [
  ...pair(
    "vba-network",
    "VBA_NETWORK_ACCESS",
    "マクロが外部へ通信している。検出されること。",
    [
      "Sub 通信サンプル()",
      '    Dim 通信 As Object',
      '    Set 通信 = CreateObject("MSXML2.XMLHTTP")',
      '    通信.Open "GET", "http://example.invalid/data", False',
      "    通信.Send",
      "End Sub",
    ].join("\r\n"),
  ),

  ...pair(
    "vba-shell",
    "VBA_SHELL_EXEC",
    "マクロが外部プログラムを起動している。検出されること。",
    [
      "Sub 外部起動サンプル()",
      '    Shell "notepad.exe", vbNormalFocus',
      "End Sub",
    ].join("\r\n"),
  ),

  ...pair(
    "vba-file",
    "VBA_FILE_ACCESS",
    "マクロがファイルを書き出している。検出されること。",
    [
      "Sub 出力サンプル()",
      '    Open "output.txt" For Output As #1',
      '    Print #1, "内容"',
      "    Close #1",
      "End Sub",
    ].join("\r\n"),
  ),

  ...pair(
    "vba-database",
    "VBA_EXTERNAL_DB",
    "マクロが外部データベースに接続している。検出されること。",
    [
      "Sub 取込サンプル()",
      "    Dim 接続 As Object",
      '    Set 接続 = CreateObject("ADODB.Connection")',
      '    接続.Open "Provider=SQLOLEDB;Data Source=dbsrv01;"',
      "End Sub",
    ].join("\r\n"),
  ),

  ...pair(
    "vba-credential",
    "VBA_HARDCODED_CREDENTIAL",
    "マクロにパスワードらしき記述がある。検出されること。",
    [
      "Sub 保護解除サンプル()",
      // 架空の値。実在のアカウントを模していない。
      '    ActiveSheet.Unprotect Password:="DummyPass123"',
      "End Sub",
    ].join("\r\n"),
  ),

  ...pair(
    "vba-autorun",
    "VBA_AUTO_RUN",
    "ブックを開いたときに自動で動くマクロがある。検出されること。",
    [
      "Sub Auto_Open()",
      '    MsgBox "開きました"',
      "End Sub",
    ].join("\r\n"),
  ),
];
