// MS-OVBA 伸長の検証（Phase 2-C）。
//
// ★ 検証は **Excel が実際に書き出したファイル**に対してのみ意味がある。
// 自作の圧縮器で作ったデータを自作の伸長器で読んでも、自分の思い違いは見つけられない
// （引き継ぎ書 §8 R-1）。ここでは Microsoft の出力を唯一の正解として突き合わせる。

import { existsSync, readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { CFB } from "xlsx";
import { describe, expect, it } from "vitest";
import { decodeVbaText, decompressOvba, extractModuleSource, looksLikeContainer, OvbaError } from "../../src/worker/ovba";

const SAMPLE = "fixtures/vba/sample-macro.xlsm";
const hasSample = existsSync(SAMPLE);

function vbaContainer(): ReturnType<typeof CFB.read> {
  const bytes = new Uint8Array(readFileSync(SAMPLE));
  const vba = unzipSync(bytes, { filter: (file) => file.name === "xl/vbaProject.bin" })["xl/vbaProject.bin"];
  if (!vba) throw new Error("vbaProject.bin がありません");
  return CFB.read(vba, { type: "array" });
}

function streamOf(path: string): Uint8Array {
  const entry = CFB.find(vbaContainer(), path);
  if (!entry) throw new Error(`ストリームがありません: ${path}`);
  return entry.content as Uint8Array;
}

describe("コンテナの判定", () => {
  it("署名バイトとチャンク署名の両方を見る", () => {
    // 0x01 の直後の2バイトの bit12-14 が 0b011 であること。
    expect(looksLikeContainer(new Uint8Array([0x01, 0x00, 0x30]), 0)).toBe(true);
    expect(looksLikeContainer(new Uint8Array([0x01, 0x00, 0x10]), 0)).toBe(false); // 署名が違う
    expect(looksLikeContainer(new Uint8Array([0x02, 0x00, 0x30]), 0)).toBe(false); // 先頭が 0x01 でない
    expect(looksLikeContainer(new Uint8Array([0x01]), 0)).toBe(false); // 短すぎる
  });

  it("コンテナでないものを伸長しようとすると明示的に失敗する", () => {
    expect(() => decompressOvba(new Uint8Array([0x00, 0x00, 0x00]))).toThrow(OvbaError);
  });
});

describe.skipIf(!hasSample)("Excel が書き出した実ファイル", () => {
  it("dir ストリームを伸長できる", () => {
    // 注: dir は端末固有のパスを伏せるため非圧縮チャンクで書き直してある
    // （scripts/redact-vba-fixture.ts）。圧縮チャンクの検証はモジュール本体側が担う。
    const dir = streamOf("/VBA/dir");
    expect(looksLikeContainer(dir, 0)).toBe(true);
    expect(decodeVbaText(decompressOvba(dir, 0))).toContain("VBAProject");
  });

  it("端末固有のパスが伏せられている", () => {
    const dirText = decodeVbaText(decompressOvba(streamOf("/VBA/dir"), 0));
    // 利用者名が残っていないこと。リポジトリに置く以上、ここは固定しておく。
    expect(dirText).not.toMatch(/\/Users\/(?!user\b)[^/\s"#]+/);
  });

  it("モジュールのソースを取り出せる", () => {
    const source = extractModuleSource(streamOf("/VBA/Module1"));
    expect(source).toBeDefined();
    expect(source).toContain('Attribute VB_Name = "Module1"');
    expect(source).toContain("Sub SampleMacro()");
    expect(source).toContain("End Sub");
  });

  it("★ バイト単位で正確に復元できている", () => {
    // 文字列リテラルは cp932 の「確認用」。伸長に1バイトでもずれがあれば一致しない。
    // ここが合うことが、実装がおおむね正しいことの最も強い裏づけになる。
    const source = extractModuleSource(streamOf("/VBA/Module1"))!;
    const bytes = [...source].map((character) => character.charCodeAt(0));
    const expected = [0x8a, 0x6d, 0x94, 0x46, 0x97, 0x70]; // 確認用（cp932）
    const index = bytes.findIndex((_value, position) =>
      expected.every((byte, offset) => bytes[position + offset] === byte),
    );
    expect(index, "cp932 の「確認用」が見つからない").toBeGreaterThan(0);
  });

  it("ソース位置の探索は、誤った候補を検証ではじく", () => {
    // モジュールストリームの前半（パフォーマンスキャッシュ）にも、コンテナに見える並びがある。
    // 伸長できても VBA ソースにならないものは採用しない、という検証が効いていること。
    const stream = streamOf("/VBA/Module1");
    const candidates: number[] = [];
    for (let index = 0; index + 2 < stream.length; index += 1) {
      if (looksLikeContainer(stream, index)) candidates.push(index);
    }
    expect(candidates.length).toBeGreaterThan(1); // 偽の候補が実際に存在する
    expect(extractModuleSource(stream)).toContain("Attribute VB_Name");
  });

  it("ソースを持たないモジュールでも属性行は取り出せる", () => {
    const source = extractModuleSource(streamOf("/VBA/ThisWorkbook"));
    expect(source).toContain('Attribute VB_Name = "ThisWorkbook"');
  });
});

describe("検証用ファイルの有無", () => {
  it("実ファイルによる検証が行われたかを明示する", () => {
    if (!hasSample) {
      console.warn(
        `[ovba] ${SAMPLE} が無いため、MS-OVBA 伸長の検証を飛ばしました。` +
          "自作データでの検証は意味を持たないので、公開前に必ず実ファイルで通すこと。",
      );
    }
    expect(true).toBe(true);
  });
});
