// L1: コンテナ層。
//
// .xlsx / .xlsm の実体は ZIP アーカイブ。SheetJS（L2）では取りこぼす、あるいは取得が回りくどい
// 情報を、内部XMLから直接読み取る（引き継ぎ書 §4.1）。
//
// XML の読み取りは src/worker/xml.ts を使う。`DOMParser` は Worker に存在しないため使えない
// （M0 の R-E で実測）。
//
// メモリ方針: 100MB 級のブックを想定し、ZIP を丸ごと展開しない。fflate の filter で
// 必要なパートだけを選んで解凍する。シートXMLは1枚ずつ読み、読み終えたら参照を捨てる。

import { unzipSync, strFromU8 } from "fflate";
import { findElements, firstElement, parseXml } from "./xml";
import { readVbaProject, type VbaInfo } from "./vba";

/** 対応していない形式（ZIP ではない、workbook が無い等）。UI で明示的にエラー表示する。 */
export class UnsupportedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

export type SheetState = "visible" | "hidden" | "veryHidden";

export interface SheetInfo {
  name: string;
  state: SheetState;
  /** ZIP 内のパート名。例: "xl/worksheets/sheet1.xml" */
  partPath: string;
  /** sheetProtection 要素があるか。 */
  isProtected: boolean;
  /** 保護にパスワードが設定されているか（password / hashValue のいずれか）。 */
  hasPasswordProtection: boolean;
  /** 結合セルの数。 */
  mergedCellCount: number;
}

export interface DefinedNameInfo {
  name: string;
  /** 参照先の数式。壊れていれば #REF! を含む。 */
  formula: string;
}

export interface ExternalLinkInfo {
  /** 参照先のパス（rels の Target）。 */
  target: string;
  /** TargetMode="External" が付いているか。 */
  isExternalMode: boolean;
}

export interface ConnectionInfo {
  name: string;
  connectionString: string;
  command: string | undefined;
}

export interface DocPropsInfo {
  creator: string | undefined;
  lastModifiedBy: string | undefined;
  /** ISO 8601 文字列のまま保持する。日付解釈はルール側の責務。 */
  created: string | undefined;
  modified: string | undefined;
}

export interface PivotCacheInfo {
  refreshedDate: string | undefined;
  recordCount: number | undefined;
}

export interface CalcInfo {
  /** 反復計算が有効か（循環参照を許容する設定）。 */
  iterate: boolean;
  /** "auto" / "manual" / "autoNoTable"。未指定なら undefined。 */
  calcMode: string | undefined;
}

export interface ContainerInfo {
  /** マクロを含むか（xl/vbaProject.bin の有無）。 */
  hasVba: boolean;
  /**
   * VBA プロジェクトの構成（Phase 2）。マクロが無い場合と、
   * 中身が VBA として読めない場合は undefined。
   */
  vba: VbaInfo | undefined;
  sheets: SheetInfo[];
  definedNames: DefinedNameInfo[];
  calc: CalcInfo;
  externalLinks: ExternalLinkInfo[];
  connections: ConnectionInfo[];
  docProps: DocPropsInfo | undefined;
  pivotCaches: PivotCacheInfo[];
  /** ZIP 内の全パート名。INFO 指標や将来の判定に使う。 */
  partNames: string[];
  /** 展開後の合計バイト数。圧縮爆弾めいたファイルの把握にも使う。 */
  uncompressedBytes: number;
}

/** 解析の進捗を受け取るコールバック。UI の進捗表示に使う。 */
export type ProgressReporter = (stage: string, done: number, total: number) => void;

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

/** 先頭4バイトが ZIP のローカルファイルヘッダか。 */
export function hasZipSignature(bytes: Uint8Array): boolean {
  if (bytes.length < ZIP_SIGNATURE.length) return false;
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** ZIP の中身を解凍せずに一覧するだけの走査。 */
function listEntries(bytes: Uint8Array): { names: string[]; uncompressedBytes: number } {
  const names: string[] = [];
  let uncompressedBytes = 0;
  unzipSync(bytes, {
    filter: (file) => {
      names.push(file.name);
      uncompressedBytes += file.originalSize;
      return false; // 1件も解凍しない
    },
  });
  return { names, uncompressedBytes };
}

/** 指定した1つのパートだけを解凍して文字列で返す。無ければ undefined。 */
function readTextPart(bytes: Uint8Array, partName: string): string | undefined {
  const extracted = unzipSync(bytes, { filter: (file) => file.name === partName });
  const part = extracted[partName];
  return part === undefined ? undefined : strFromU8(part);
}

/** "xl/workbook.xml" → "xl" */
function directoryOf(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  return slash === -1 ? "" : partPath.slice(0, slash);
}

/** "xl" と "worksheets/sheet1.xml" → "xl/worksheets/sheet1.xml"。"/x" のような絶対指定にも対応。 */
function resolvePartPath(baseDirectory: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);

  const segments = baseDirectory === "" ? [] : baseDirectory.split("/");
  for (const segment of target.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

/** "xl/workbook.xml" → "xl/_rels/workbook.xml.rels" */
function relsPathOf(partPath: string): string {
  const directory = directoryOf(partPath);
  const fileName = partPath.slice(directory === "" ? 0 : directory.length + 1);
  return directory === "" ? `_rels/${fileName}.rels` : `${directory}/_rels/${fileName}.rels`;
}

interface Relationship {
  id: string;
  type: string;
  target: string;
  targetMode: string | undefined;
}

function parseRelationships(xml: string | undefined): Relationship[] {
  if (xml === undefined) return [];
  return findElements(xml, "Relationship").map((element) => ({
    id: element.attrs["Id"] ?? "",
    type: element.attrs["Type"] ?? "",
    target: element.attrs["Target"] ?? "",
    targetMode: element.attrs["TargetMode"],
  }));
}

/** Type の末尾セグメントで関係の種類を判定する（名前空間URIの前半に依存しない）。 */
function relationshipKind(type: string): string {
  const slash = type.lastIndexOf("/");
  return slash === -1 ? type : type.slice(slash + 1);
}

function parseSheetState(value: string | undefined): SheetState {
  if (value === "hidden") return "hidden";
  if (value === "veryHidden") return "veryHidden";
  return "visible";
}

/**
 * connections.xml を読む。
 * 接続文字列は `connection` の子要素（dbPr / webPr）にあるため、要素の入れ子を追う必要がある。
 * イベント走査で親子を対応付ける。
 */
function parseConnections(xml: string): ConnectionInfo[] {
  const result: ConnectionInfo[] = [];
  let current: ConnectionInfo | undefined;

  for (const event of parseXml(xml)) {
    if (event.type === "close") {
      if (event.name === "connection") current = undefined;
      continue;
    }
    if (event.type !== "open") continue;

    if (event.name === "connection") {
      current = { name: event.attrs["name"] ?? "", connectionString: "", command: undefined };
      result.push(current);
      if (event.selfClosing) current = undefined;
      continue;
    }
    if (current === undefined) continue;

    // DB接続。
    if (event.name === "dbPr") {
      current.connectionString = event.attrs["connection"] ?? "";
      current.command = event.attrs["command"];
      continue;
    }
    // Webクエリ。接続先URLを接続文字列として扱う。
    if (event.name === "webPr") {
      const url = event.attrs["url"];
      if (url !== undefined) current.connectionString = url;
    }
  }

  return result;
}

/**
 * シートXMLから保護と結合セルの情報だけを取り出す。
 *
 * シートXMLの大半は `sheetData`（セル本体）で、大きなブックでは1枚で数十MBになる。
 * 全体を走査すると 30シートで数秒かかったため（50MB のブックで実測 7.8 秒）、
 * 目的の要素の位置を先に見つけて、その周辺だけを解析する。
 *
 * 対象の要素名はいずれも `sheetData` の外にあり、セル値の中に生の `<sheetProtection` が
 * 現れることはない（XML 内のテキストとしては `&lt;` にエスケープされるため）。
 */
function readSheetDetails(sheetXml: string): Pick<SheetInfo, "isProtected" | "hasPasswordProtection" | "mergedCellCount"> {
  let isProtected = false;
  let hasPasswordProtection = false;

  const protectionIndex = sheetXml.indexOf("<sheetProtection");
  if (protectionIndex !== -1) {
    isProtected = true;
    // 属性は短いので、開始位置から十分な幅だけを切り出して解析する。
    const protection = firstElement(sheetXml.slice(protectionIndex, protectionIndex + 4096), "sheetProtection");
    hasPasswordProtection =
      protection?.attrs["password"] !== undefined || protection?.attrs["hashValue"] !== undefined;
  }

  let mergedCellCount = 0;
  const mergeStart = sheetXml.indexOf("<mergeCells");
  if (mergeStart !== -1) {
    const mergeEnd = sheetXml.indexOf("</mergeCells>", mergeStart);
    const block = mergeEnd === -1 ? sheetXml.slice(mergeStart) : sheetXml.slice(mergeStart, mergeEnd);
    // "mergeCells"（複数形）はローカル名が違うので一致しない。
    mergedCellCount = findElements(block, "mergeCell").length;
  }

  return { isProtected, hasPasswordProtection, mergedCellCount };
}

/**
 * L1 の読み取りを実行する。
 * ZIP でない、または workbook が見つからない場合は UnsupportedFormatError を投げる。
 */
export function readContainer(bytes: Uint8Array, onProgress?: ProgressReporter): ContainerInfo {
  if (!hasZipSignature(bytes)) {
    throw new UnsupportedFormatError(
      "このファイルは .xlsx / .xlsm 形式ではありません（ZIP 形式のヘッダが見つかりませんでした）。",
    );
  }

  let entries: { names: string[]; uncompressedBytes: number };
  try {
    entries = listEntries(bytes);
  } catch {
    throw new UnsupportedFormatError("ファイルの構造を読み取れませんでした（壊れている可能性があります）。");
  }
  const partNames = entries.names;

  // --- workbook パートの特定 ---------------------------------------------
  const rootRels = parseRelationships(readTextPart(bytes, "_rels/.rels"));
  const workbookRel = rootRels.find((rel) => relationshipKind(rel.type) === "officeDocument");
  const workbookPath = workbookRel ? resolvePartPath("", workbookRel.target) : "xl/workbook.xml";

  const workbookXml = readTextPart(bytes, workbookPath);
  if (workbookXml === undefined) {
    throw new UnsupportedFormatError("ブック本体（workbook.xml）が見つかりませんでした。");
  }
  const workbookDirectory = directoryOf(workbookPath);
  const workbookRels = parseRelationships(readTextPart(bytes, relsPathOf(workbookPath)));
  const relById = new Map(workbookRels.map((rel) => [rel.id, rel]));

  // --- シート ------------------------------------------------------------
  const sheetElements = findElements(workbookXml, "sheet");
  const sheets: SheetInfo[] = [];

  sheetElements.forEach((element, index) => {
    onProgress?.("シートを読み取り中", index, sheetElements.length);

    const relId = element.attrs["r:id"] ?? element.attrs["id"] ?? "";
    const rel = relById.get(relId);
    const partPath = rel ? resolvePartPath(workbookDirectory, rel.target) : "";

    // シートXMLは1枚ずつ読む。まとめて展開すると大きなブックでメモリを圧迫する。
    const sheetXml = partPath === "" ? undefined : readTextPart(bytes, partPath);
    const details =
      sheetXml === undefined
        ? { isProtected: false, hasPasswordProtection: false, mergedCellCount: 0 }
        : readSheetDetails(sheetXml);

    sheets.push({
      name: element.attrs["name"] ?? "",
      state: parseSheetState(element.attrs["state"]),
      partPath,
      ...details,
    });
  });
  onProgress?.("シートを読み取り中", sheetElements.length, sheetElements.length);

  // --- 名前定義 ----------------------------------------------------------
  const definedNames: DefinedNameInfo[] = findElements(workbookXml, "definedName").map((element) => ({
    name: element.attrs["name"] ?? "",
    formula: element.text,
  }));

  // --- 計算設定 ----------------------------------------------------------
  const calcPr = firstElement(workbookXml, "calcPr");
  const iterateValue = calcPr?.attrs["iterate"];
  const calc: CalcInfo = {
    iterate: iterateValue === "1" || iterateValue === "true",
    calcMode: calcPr?.attrs["calcMode"],
  };

  // --- 外部リンク --------------------------------------------------------
  const externalLinks: ExternalLinkInfo[] = [];
  for (const rel of workbookRels) {
    if (relationshipKind(rel.type) !== "externalLink") continue;
    const linkPath = resolvePartPath(workbookDirectory, rel.target);
    const linkRels = parseRelationships(readTextPart(bytes, relsPathOf(linkPath)));
    for (const linkRel of linkRels) {
      if (relationshipKind(linkRel.type) !== "externalLinkPath") continue;
      externalLinks.push({ target: linkRel.target, isExternalMode: linkRel.targetMode === "External" });
    }
  }

  // --- 外部データ接続 ----------------------------------------------------
  const connections: ConnectionInfo[] = [];
  const connectionsRel = workbookRels.find((rel) => relationshipKind(rel.type) === "connections");
  const connectionsPath = connectionsRel
    ? resolvePartPath(workbookDirectory, connectionsRel.target)
    : `${workbookDirectory}/connections.xml`;
  const connectionsXml = readTextPart(bytes, connectionsPath);
  if (connectionsXml !== undefined) {
    connections.push(...parseConnections(connectionsXml));
  }

  // --- ドキュメントプロパティ --------------------------------------------
  const corePropsRel = rootRels.find((rel) => relationshipKind(rel.type) === "core-properties");
  const corePropsPath = corePropsRel ? resolvePartPath("", corePropsRel.target) : "docProps/core.xml";
  const corePropsXml = readTextPart(bytes, corePropsPath);
  const docProps: DocPropsInfo | undefined =
    corePropsXml === undefined
      ? undefined
      : {
          creator: firstElement(corePropsXml, "creator")?.text,
          lastModifiedBy: firstElement(corePropsXml, "lastModifiedBy")?.text,
          created: firstElement(corePropsXml, "created")?.text,
          modified: firstElement(corePropsXml, "modified")?.text,
        };

  // --- ピボットキャッシュ ------------------------------------------------
  const pivotCaches: PivotCacheInfo[] = [];
  for (const rel of workbookRels) {
    if (relationshipKind(rel.type) !== "pivotCacheDefinition") continue;
    const cacheXml = readTextPart(bytes, resolvePartPath(workbookDirectory, rel.target));
    if (cacheXml === undefined) continue;
    const element = firstElement(cacheXml, "pivotCacheDefinition");
    const recordCountText = element?.attrs["recordCount"];
    const recordCount = recordCountText === undefined ? undefined : Number(recordCountText);
    pivotCaches.push({
      refreshedDate: element?.attrs["refreshedDate"],
      recordCount: Number.isFinite(recordCount) ? recordCount : undefined,
    });
  }

  // --- VBA の構成 --------------------------------------------------------
  const vbaPartName = partNames.find((name) => name.toLowerCase().endsWith("vbaproject.bin"));
  let vba: VbaInfo | undefined;
  if (vbaPartName !== undefined) {
    const extracted = unzipSync(bytes, { filter: (file) => file.name === vbaPartName });
    const vbaBytes = extracted[vbaPartName];
    if (vbaBytes !== undefined) vba = readVbaProject(vbaBytes);
  }

  return {
    hasVba: vbaPartName !== undefined,
    vba,
    sheets,
    definedNames,
    calc,
    externalLinks,
    connections,
    docProps,
    pivotCaches,
    partNames,
    uncompressedBytes: entries.uncompressedBytes,
  };
}
