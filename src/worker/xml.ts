// Worker スコープで動く軽量 XML リーダー。
//
// なぜ自前かというと、Worker には DOM が無く `DOMParser` が使えないため（M0 の R-E で実測）。
// 引き継ぎ書 §4.1 は DOMParser を推奨しているが、§4.3 の「解析は Worker で」と両立しないので、
// L1 が必要とする範囲（属性の取り出しと要素の列挙）だけを満たす読み取り器を用意する。
//
// 設計方針:
// - 未信頼入力（顧客のExcel）を読むため、正規表現のバックトラッキングに依存しない。
//   すべてインデックス走査で、入力長に対して線形に処理する。
// - `<!DOCTYPE>` の内部サブセットで宣言された実体は決して展開しない。
//   外部実体の取得は CSP でも止まるが、そもそも解決しない設計にすることで
//   XXE と実体展開爆弾（billion laughs）に構造的な耐性を持たせる。
// - 未知の実体は展開せず、そのまま文字列として残す。

export interface XmlAttributes {
  readonly [name: string]: string;
}

export type XmlEvent =
  | {
      readonly type: "open";
      /** 接頭辞込みの名前。例: "cp:coreProperties" */
      readonly qName: string;
      /** 接頭辞を除いた名前。例: "coreProperties" */
      readonly name: string;
      readonly attrs: XmlAttributes;
      readonly selfClosing: boolean;
    }
  | { readonly type: "close"; readonly qName: string; readonly name: string }
  | { readonly type: "text"; readonly value: string };

/** 接頭辞を除いたローカル名を返す。"a:b" → "b" */
function localNameOf(qName: string): string {
  const colon = qName.indexOf(":");
  return colon === -1 ? qName : qName.slice(colon + 1);
}

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

/**
 * XML の実体参照を復号する。
 * 既定の5実体と数値文字参照のみを扱い、それ以外は「展開しない」。
 * DOCTYPE で宣言されたカスタム実体を解決しないのは意図的（XXE 対策）。
 */
export function decodeXmlText(value: string): string {
  if (!value.includes("&")) return value;

  let result = "";
  let index = 0;

  while (index < value.length) {
    const amp = value.indexOf("&", index);
    if (amp === -1) {
      result += value.slice(index);
      break;
    }
    result += value.slice(index, amp);

    const semicolon = value.indexOf(";", amp + 1);
    // 実体参照が長すぎるものは実体とみなさない（壊れた入力での無駄な走査を避ける）。
    if (semicolon === -1 || semicolon - amp > 32) {
      result += "&";
      index = amp + 1;
      continue;
    }

    const body = value.slice(amp + 1, semicolon);
    let decoded: string | undefined;

    if (body.startsWith("#x") || body.startsWith("#X")) {
      const codePoint = Number.parseInt(body.slice(2), 16);
      decoded = isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : undefined;
    } else if (body.startsWith("#")) {
      const codePoint = Number.parseInt(body.slice(1), 10);
      decoded = isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : undefined;
    } else {
      decoded = NAMED_ENTITIES.get(body);
    }

    if (decoded === undefined) {
      // 未知の実体はそのまま残す。勝手に展開しない。
      result += value.slice(amp, semicolon + 1);
    } else {
      result += decoded;
    }
    index = semicolon + 1;
  }

  return result;
}

function isValidCodePoint(codePoint: number): boolean {
  return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff;
}

/**
 * 開始タグの終端 ">" の位置を返す。
 * 属性値の中の ">" は XML では合法なので、引用符の内側を無視する必要がある。
 * 見つからなければ -1。
 */
function findTagEnd(xml: string, start: number): number {
  let quote: string | undefined;
  for (let index = start; index < xml.length; index += 1) {
    const char = xml[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

/** 開始タグの中身（"sheet name=\"a\" state=\"hidden\"" 部分）から名前と属性を取り出す。 */
function parseTagBody(body: string): { qName: string; attrs: XmlAttributes } {
  let index = 0;
  while (index < body.length && !WHITESPACE.has(body[index] ?? "")) index += 1;
  const qName = body.slice(0, index);

  const attrs: Record<string, string> = {};

  while (index < body.length) {
    while (index < body.length && WHITESPACE.has(body[index] ?? "")) index += 1;
    if (index >= body.length) break;

    const nameStart = index;
    while (index < body.length && !WHITESPACE.has(body[index] ?? "") && body[index] !== "=") index += 1;
    const attrName = body.slice(nameStart, index);
    if (attrName === "") break;

    while (index < body.length && WHITESPACE.has(body[index] ?? "")) index += 1;
    if (body[index] !== "=") {
      // 値の無い属性。XML では不正だが、壊れたファイルでも止まらないよう空文字として扱う。
      attrs[attrName] = "";
      continue;
    }
    index += 1; // "=" を消費
    while (index < body.length && WHITESPACE.has(body[index] ?? "")) index += 1;

    const quote = body[index];
    if (quote !== '"' && quote !== "'") {
      attrs[attrName] = "";
      continue;
    }
    index += 1;
    const valueStart = index;
    const valueEnd = body.indexOf(quote, valueStart);
    if (valueEnd === -1) {
      attrs[attrName] = decodeXmlText(body.slice(valueStart));
      break;
    }
    attrs[attrName] = decodeXmlText(body.slice(valueStart, valueEnd));
    index = valueEnd + 1;
  }

  return { qName, attrs };
}

/** XML を先頭から1回だけ走査し、イベントを順に返す。 */
export function* parseXml(xml: string): Generator<XmlEvent> {
  let index = 0;

  while (index < xml.length) {
    const lt = xml.indexOf("<", index);

    if (lt === -1) {
      const tail = xml.slice(index);
      if (tail !== "") yield { type: "text", value: decodeXmlText(tail) };
      return;
    }

    if (lt > index) {
      yield { type: "text", value: decodeXmlText(xml.slice(index, lt)) };
    }

    // コメント
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      index = end === -1 ? xml.length : end + 3;
      continue;
    }

    // CDATA（中身は実体復号せずそのまま）
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      const value = xml.slice(lt + 9, end === -1 ? xml.length : end);
      if (value !== "") yield { type: "text", value };
      index = end === -1 ? xml.length : end + 3;
      continue;
    }

    // 処理命令（<?xml ... ?> を含む）
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      index = end === -1 ? xml.length : end + 2;
      continue;
    }

    // <!DOCTYPE ...> 等の宣言。内部サブセットごと読み飛ばし、実体は一切解決しない。
    if (xml.startsWith("<!", lt)) {
      const bracket = xml.indexOf("[", lt);
      const firstGt = findTagEnd(xml, lt + 2);
      if (bracket !== -1 && (firstGt === -1 || bracket < firstGt)) {
        const subsetEnd = xml.indexOf("]", bracket + 1);
        const declEnd = subsetEnd === -1 ? -1 : xml.indexOf(">", subsetEnd + 1);
        index = declEnd === -1 ? xml.length : declEnd + 1;
      } else {
        index = firstGt === -1 ? xml.length : firstGt + 1;
      }
      continue;
    }

    // 終了タグ
    if (xml.startsWith("</", lt)) {
      const end = findTagEnd(xml, lt + 2);
      if (end === -1) return;
      const qName = xml.slice(lt + 2, end).trim();
      yield { type: "close", qName, name: localNameOf(qName) };
      index = end + 1;
      continue;
    }

    // 開始タグ
    const end = findTagEnd(xml, lt + 1);
    if (end === -1) return;
    let body = xml.slice(lt + 1, end);
    const selfClosing = body.endsWith("/");
    if (selfClosing) body = body.slice(0, -1);

    const { qName, attrs } = parseTagBody(body);
    if (qName !== "") {
      yield { type: "open", qName, name: localNameOf(qName), attrs, selfClosing };
    }
    index = end + 1;
  }
}

export interface XmlElement {
  readonly qName: string;
  readonly name: string;
  readonly attrs: XmlAttributes;
  /** 子要素のテキストも含めた、要素配下のテキストを連結したもの。 */
  readonly text: string;
}

/**
 * ローカル名が一致する要素をすべて取り出す。名前空間の接頭辞は無視する。
 * 入れ子の同名要素にも対応する。
 */
export function findElements(xml: string, localName: string): XmlElement[] {
  const found: XmlElement[] = [];

  // 収集中の要素スタック。深さを追い、閉じたところで確定する。
  const open: { qName: string; attrs: XmlAttributes; depth: number; text: string }[] = [];
  let depth = 0;

  for (const event of parseXml(xml)) {
    if (event.type === "text") {
      for (const element of open) element.text += event.value;
      continue;
    }

    if (event.type === "open") {
      if (event.name === localName) {
        if (event.selfClosing) {
          found.push({ qName: event.qName, name: event.name, attrs: event.attrs, text: "" });
        } else {
          open.push({ qName: event.qName, attrs: event.attrs, depth, text: "" });
        }
      }
      if (!event.selfClosing) depth += 1;
      continue;
    }

    // close
    depth -= 1;
    const last = open[open.length - 1];
    if (last && last.depth === depth) {
      open.pop();
      found.push({ qName: last.qName, name: localName, attrs: last.attrs, text: last.text });
    }
  }

  return found;
}

/** ローカル名が一致する最初の要素。無ければ undefined。 */
export function firstElement(xml: string, localName: string): XmlElement | undefined {
  return findElements(xml, localName)[0];
}
