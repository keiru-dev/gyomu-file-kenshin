// 自前 XML リーダーの検証。
//
// 顧客のExcelは未信頼入力なので、「正しい XML を読めること」と同じ重みで
// 「細工された XML で壊れない・余計なことをしないこと」を確かめる。

import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { decodeXmlText, findElements, firstElement, parseXml } from "../../src/worker/xml";
import { casesForRule } from "../../fixtures/cases";

describe("decodeXmlText", () => {
  it("既定の5実体を復号する", () => {
    expect(decodeXmlText("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;")).toBe(`a & b <c> "d" 'e'`);
  });

  it("数値文字参照を10進・16進の両方で復号する", () => {
    expect(decodeXmlText("&#65;&#x42;&#x3042;")).toBe("ABあ");
  });

  it("未知の実体は展開せずそのまま残す", () => {
    expect(decodeXmlText("&unknownEntity;")).toBe("&unknownEntity;");
  });

  it("実体でない & をそのまま扱う", () => {
    expect(decodeXmlText("A & B")).toBe("A & B");
  });
});

describe("parseXml / findElements", () => {
  it("属性値の中の > でタグ終端を誤認しない", () => {
    const xml = `<root><item label="a > b" other="x"/></root>`;
    const item = firstElement(xml, "item");
    expect(item?.attrs["label"]).toBe("a > b");
    expect(item?.attrs["other"]).toBe("x");
  });

  it("名前空間の接頭辞を無視してローカル名で引ける", () => {
    const xml = `<cp:coreProperties xmlns:cp="urn:x"><dc:creator>作成者A</dc:creator></cp:coreProperties>`;
    const creator = firstElement(xml, "creator");
    expect(creator?.qName).toBe("dc:creator");
    expect(creator?.text).toBe("作成者A");
  });

  it("コメントと処理命令を読み飛ばす", () => {
    const xml = `<?xml version="1.0"?><root><!-- <fake attr="x"/> --><real v="1"/></root>`;
    expect(findElements(xml, "fake")).toHaveLength(0);
    expect(firstElement(xml, "real")?.attrs["v"]).toBe("1");
  });

  it("CDATA の中身をテキストとして取り出す（実体復号はしない）", () => {
    const xml = `<root><note><![CDATA[ <a> & &amp; ]]></note></root>`;
    expect(firstElement(xml, "note")?.text).toBe(" <a> & &amp; ");
  });

  it("自己終了タグを要素として拾う", () => {
    const xml = `<root><a x="1"/><a x="2"/></root>`;
    expect(findElements(xml, "a").map((element) => element.attrs["x"])).toEqual(["1", "2"]);
  });

  it("属性値の実体を復号する", () => {
    const xml = `<root><a name="&#x8CA1;務 &amp; 経理"/></root>`;
    expect(firstElement(xml, "a")?.attrs["name"]).toBe("財務 & 経理");
  });
});

describe("未信頼入力への耐性", () => {
  it("DOCTYPE で宣言された実体を展開しない（XXE / 実体展開爆弾への耐性）", () => {
    const xml =
      `<?xml version="1.0"?>` +
      `<!DOCTYPE root [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> <!ENTITY boom "AAAA"> ]>` +
      `<root><a>&xxe;</a><b>&boom;</b></root>`;

    expect(firstElement(xml, "a")?.text).toBe("&xxe;");
    expect(firstElement(xml, "b")?.text).toBe("&boom;");
  });

  it("DOCTYPE の内部サブセットを要素として拾わない", () => {
    const xml = `<!DOCTYPE root [ <!ELEMENT sneaky ANY> ]><root><ok/></root>`;
    expect(findElements(xml, "sneaky")).toHaveLength(0);
    expect(findElements(xml, "ok")).toHaveLength(1);
  });

  it("閉じられていないタグでも例外を投げず停止する", () => {
    expect(() => findElements(`<root><a attr="unterminated`, "a")).not.toThrow();
    expect(() => findElements(`<root><!-- 未完のコメント`, "a")).not.toThrow();
    expect(() => findElements(`<root><![CDATA[未完`, "a")).not.toThrow();
  });

  it("深い入れ子でもスタックを溢れさせない（再帰を使っていないこと）", () => {
    const depth = 20_000;
    const xml = "<r>".repeat(depth) + "<leaf/>" + "</r>".repeat(depth);
    expect(findElements(xml, "leaf")).toHaveLength(1);
  });

  it("長い実体らしき文字列で走査が破綻しない", () => {
    const xml = `<root><a>&${"x".repeat(100_000)};</a></root>`;
    expect(() => findElements(xml, "a")).not.toThrow();
  });
});

describe("実フィクスチャに対する L1 読み取り", () => {
  function workbookXmlOf(caseId: string): string {
    const testCase = casesForRule("HIDDEN_SHEET").find((c) => c.id === caseId);
    if (!testCase) throw new Error(`ケースが見つかりません: ${caseId}`);
    const entry = unzipSync(testCase.build())["xl/workbook.xml"];
    if (!entry) throw new Error("xl/workbook.xml がありません");
    return strFromU8(entry);
  }

  it("検出用フィクスチャからシート名と表示状態を取り出せる", () => {
    const sheets = findElements(workbookXmlOf("hidden-sheet--detected"), "sheet");
    expect(
      sheets.map((sheet) => ({ name: sheet.attrs["name"], state: sheet.attrs["state"] ?? "visible" })),
    ).toEqual([
      { name: "集計表", state: "visible" },
      { name: "作業用", state: "hidden" },
      { name: "旧様式", state: "veryHidden" },
    ]);
  });

  it("非検出用フィクスチャはすべて visible として読める", () => {
    const sheets = findElements(workbookXmlOf("hidden-sheet--clean"), "sheet");
    expect(sheets.every((sheet) => (sheet.attrs["state"] ?? "visible") === "visible")).toBe(true);
    expect(sheets).toHaveLength(2);
  });

  it("イベント列として1回で走査できる（大きなXMLを想定した使い方）", () => {
    const events = [...parseXml(workbookXmlOf("hidden-sheet--detected"))];
    const openNames = events.filter((event) => event.type === "open").map((event) => event.name);
    expect(openNames).toContain("workbook");
    expect(openNames.filter((name) => name === "sheet")).toHaveLength(3);
  });
});
