// 架空の .xlsx / .xlsm を生の OOXML から組み立てるための土台。
//
// C-4 厳守: ここで生成するデータはすべて架空。実在の事業体・業務知見・命名規則を一切含めない。
// シート名やヘッダ名は「一般的な設計欠陥の類型」を再現するために必要な範囲の、ありふれた語のみを使う。
//
// SheetJS の書き出し機能では作れない欠陥（外部リンク、connections.xml、veryHidden、
// sheetProtection、#REF! など）を扱うため、パーツを直接組み立てて fflate で ZIP 化する。
// この方式は M0 の R-D probe で SheetJS が読めることを実測済み。
//
// 要素の並び順は OOXML スキーマのシーケンス制約に従うこと。順序を崩すと Excel や
// SheetJS が読めなくなる。workbook は sheets → externalReferences → definedNames →
// calcPr → pivotCaches、worksheet は sheetData → sheetProtection → mergeCells。

import { zipSync, strToU8 } from "fflate";
import { buildVbaProject, type VbaModuleSpec } from "./vba-builder";

/**
 * 出力に元データが漏れていないことを M7 のテストで検証するための番兵。
 * フィクスチャのセル値に必ず含め、レポート / JSON にこの文字列が現れないことを assert する。
 */
export const FIXTURE_SENTINEL = "SENTINEL_CELL_VALUE_7F3A";

/** ZIP の再現性を保つための固定タイムスタンプ。生成のたびにバイト列が変わらないようにする。 */
const FIXED_MTIME = new Date("2020-01-01T00:00:00Z");

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// OOXML の名前空間。URI 形式だが「識別子」であって取得先ではない（CSP 下でも取得されない）。
const NS_CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_SPREADSHEET = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_CORE_PROPS_REL = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
const NS_VBA_REL = "http://schemas.microsoft.com/office/2006/relationships/vbaProject";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_DCTERMS = "http://purl.org/dc/terms/";
const NS_DCMITYPE = "http://purl.org/dc/dcmitype/";
const NS_XSI = "http://www.w3.org/2001/XMLSchema-instance";
const NS_CORE_PROPS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";

const CT_WORKBOOK = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const CT_WORKBOOK_MACRO = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";
const CT_WORKSHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const CT_CORE_PROPS = "application/vnd.openxmlformats-package.core-properties+xml";
const CT_CONNECTIONS = "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml";
const CT_EXTERNAL_LINK = "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml";
const CT_PIVOT_CACHE_DEF =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml";
const CT_VBA = "application/vnd.ms-office.vbaProject";

/** シートの表示状態。`veryHidden` は Excel の UI からは再表示できない。 */
export type SheetState = "visible" | "hidden" | "veryHidden";

export interface CellSpec {
  /** セル参照。例: "A1" */
  ref: string;
  /** 文字列値（インライン文字列として書き出す）。 */
  value?: string;
  /** 数式。先頭の "=" は付けない。例: "SUM(A1:A5)" */
  formula?: string;
  /**
   * 数式の計算結果キャッシュ。省略時は "0"。
   * 実際の Excel は必ずキャッシュ値を書き込む。省略すると SheetJS がセル自体を生成せず、
   * 数式が1件も読めなくなる（実測 2026-08-09）。
   */
  cachedValue?: string;
  /** エラー値。例: "#REF!"。指定すると t="e" のセルになる。 */
  error?: string;
}

export interface SheetProtectionSpec {
  /**
   * 疑似的なパスワードハッシュ（16進4桁）。省略するとパスワード無しの保護になる。
   * **実在のパスワードから計算した値ではなく、単なる固定の見せかけ。**
   * Phase 1 は「保護されているか」「パスワード属性があるか」しか見ないため、これで足りる。
   */
  passwordHash?: string;
}

export interface SheetSpec {
  name: string;
  /** 省略時は visible。 */
  state?: SheetState;
  cells?: CellSpec[];
  /** 結合セルの範囲。例: ["A1:C1", "A2:A5"] */
  merges?: string[];
  /** シート保護。未指定なら保護なし。 */
  protection?: SheetProtectionSpec;
}

export interface DefinedNameSpec {
  name: string;
  /** 参照先の数式。壊れた名前定義を作るには "#REF!#REF!$A$1" のような値を入れる。 */
  formula: string;
}

export interface CalcPrSpec {
  /** 反復計算（循環参照を許容する設定）。 */
  iterate?: boolean;
  /** 計算モード。manual は更新漏れによる誤値のリスクがある。 */
  calcMode?: "auto" | "manual" | "autoNoTable";
}

export interface ConnectionSpec {
  name: string;
  /** 接続文字列。HARDCODED_CREDENTIAL の再現には Password= を含める（値は架空）。 */
  connectionString: string;
  /** 取得コマンド（SQL など）。 */
  command?: string;
}

export interface ExternalLinkSpec {
  /**
   * 参照先のパス。UNC（\\server\share\...）やローカル絶対パス（file:///C:/...）を
   * 入れると EXT_LINK_BROKEN の対象になる。
   */
  target: string;
  /** 参照先ブックのシート名。 */
  sheetNames?: string[];
}

export interface PivotCacheSpec {
  /** 最終更新日時（ISO 8601）。古いほど PIVOT_CACHE_STALE の対象になる。 */
  refreshedDate: string;
  /** キャッシュしているレコード数。肥大の指標。 */
  recordCount: number;
}

export interface WorkbookSpec {
  sheets: SheetSpec[];
  /** docProps/core.xml を出力する場合に指定。属人化検出（AUTHOR_SINGLE_LEGACY）で使う。 */
  docProps?: {
    creator: string;
    lastModifiedBy: string;
    /** ISO 8601。例: "2015-04-01T09:00:00Z" */
    created: string;
    modified: string;
  };
  definedNames?: DefinedNameSpec[];
  calcPr?: CalcPrSpec;
  connections?: ConnectionSpec[];
  externalLinks?: ExternalLinkSpec[];
  pivotCaches?: PivotCacheSpec[];
  /**
   * xl/vbaProject.bin を含める（.xlsm 相当にする）。
   * **中身はダミーのバイト列**で、CFB としては読めない。「マクロあり」だけを見る用途。
   */
  vba?: boolean;
  /**
   * 実際に読める VBA プロジェクトを埋め込む（Phase 2 用）。指定すると vba より優先される。
   * ソースは非圧縮チャンクで格納するため、自作の圧縮器を持たずに済む
   * （fixtures/vba-builder.ts を参照）。
   */
  vbaModules?: VbaModuleSpec[];
}

/** XML のテキスト・属性値のエスケープ。フィクスチャ側でも必ず通す。 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** "A1" → 1、"AA12" → 12。 */
function rowNumberOf(ref: string): number {
  const digits = ref.replace(/^[A-Z]+/i, "");
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`セル参照から行番号を取得できません: ${ref}`);
  }
  return parsed;
}

function buildSheetXml(sheet: SheetSpec): string {
  const cells = sheet.cells ?? [];

  // 行ごとにまとめる。OOXML は row の昇順を期待する。
  const byRow = new Map<number, CellSpec[]>();
  for (const cell of cells) {
    const row = rowNumberOf(cell.ref);
    const bucket = byRow.get(row);
    if (bucket) bucket.push(cell);
    else byRow.set(row, [cell]);
  }

  const rows = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rowNumber, rowCells]) => {
      const cellXml = rowCells
        .map((cell) => {
          const ref = escapeXml(cell.ref);
          if (cell.error !== undefined) {
            return `<c r="${ref}" t="e"><v>${escapeXml(cell.error)}</v></c>`;
          }
          if (cell.formula !== undefined) {
            const cached = escapeXml(cell.cachedValue ?? "0");
            return `<c r="${ref}"><f>${escapeXml(cell.formula)}</f><v>${cached}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell.value ?? "")}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cellXml}</row>`;
    })
    .join("");

  // CT_Worksheet のシーケンス: sheetData → sheetProtection → mergeCells
  let protectionXml = "";
  if (sheet.protection) {
    const passwordAttr =
      sheet.protection.passwordHash === undefined
        ? ""
        : ` password="${escapeXml(sheet.protection.passwordHash)}"`;
    protectionXml = `<sheetProtection sheet="1" objects="1" scenarios="1"${passwordAttr}/>`;
  }

  const merges = sheet.merges ?? [];
  const mergeXml =
    merges.length === 0
      ? ""
      : `<mergeCells count="${merges.length}">` +
        merges.map((ref) => `<mergeCell ref="${escapeXml(ref)}"/>`).join("") +
        `</mergeCells>`;

  return (
    `${XML_DECL}<worksheet xmlns="${NS_SPREADSHEET}">` +
    `<sheetData>${rows}</sheetData>${protectionXml}${mergeXml}` +
    `</worksheet>`
  );
}

/** workbook.xml.rels の1エントリ。 */
interface RelEntry {
  id: string;
  type: string;
  target: string;
}

export function buildXlsx(spec: WorkbookSpec): Uint8Array {
  if (spec.sheets.length === 0) {
    throw new Error("シートが1枚も指定されていません");
  }

  const externalLinks = spec.externalLinks ?? [];
  const pivotCaches = spec.pivotCaches ?? [];
  const connections = spec.connections ?? [];
  const hasConnections = connections.length > 0;
  const hasDocProps = spec.docProps !== undefined;
  const vbaModules = spec.vbaModules;
  const isMacroEnabled = spec.vba === true || (vbaModules !== undefined && vbaModules.length > 0);

  // --- リレーションID の採番 ---------------------------------------------
  // workbook.xml から参照する ID は、ここで決めたものと必ず一致させる。
  const rels: RelEntry[] = [];
  let nextRelId = 1;
  const takeRelId = (): string => `rId${nextRelId++}`;

  const sheetRelIds = spec.sheets.map((_unused, index) => {
    const id = takeRelId();
    rels.push({ id, type: `${NS_DOC_REL}/worksheet`, target: `worksheets/sheet${index + 1}.xml` });
    return id;
  });

  const externalLinkRelIds = externalLinks.map((_unused, index) => {
    const id = takeRelId();
    rels.push({
      id,
      type: `${NS_DOC_REL}/externalLink`,
      target: `externalLinks/externalLink${index + 1}.xml`,
    });
    return id;
  });

  const pivotCacheRelIds = pivotCaches.map((_unused, index) => {
    const id = takeRelId();
    rels.push({
      id,
      type: `${NS_DOC_REL}/pivotCacheDefinition`,
      target: `pivotCache/pivotCacheDefinition${index + 1}.xml`,
    });
    return id;
  });

  if (hasConnections) {
    rels.push({ id: takeRelId(), type: `${NS_DOC_REL}/connections`, target: "connections.xml" });
  }
  if (isMacroEnabled) {
    rels.push({ id: takeRelId(), type: NS_VBA_REL, target: "vbaProject.bin" });
  }

  // --- workbook.xml ------------------------------------------------------
  const sheetTags = spec.sheets
    .map((sheet, index) => {
      const state = sheet.state ?? "visible";
      // state="visible" は既定なので属性を出さない（実ファイルの見た目に近づける）。
      const stateAttr = state === "visible" ? "" : ` state="${state}"`;
      const relId = sheetRelIds[index];
      return `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${stateAttr} r:id="${relId}"/>`;
    })
    .join("");

  const externalReferencesXml =
    externalLinkRelIds.length === 0
      ? ""
      : `<externalReferences>` +
        externalLinkRelIds.map((id) => `<externalReference r:id="${id}"/>`).join("") +
        `</externalReferences>`;

  const definedNames = spec.definedNames ?? [];
  const definedNamesXml =
    definedNames.length === 0
      ? ""
      : `<definedNames>` +
        definedNames
          .map(
            (definedName) =>
              `<definedName name="${escapeXml(definedName.name)}">${escapeXml(definedName.formula)}</definedName>`,
          )
          .join("") +
        `</definedNames>`;

  let calcPrXml = "";
  if (spec.calcPr) {
    const parts = ['calcId="191029"'];
    if (spec.calcPr.calcMode !== undefined) parts.push(`calcMode="${spec.calcPr.calcMode}"`);
    if (spec.calcPr.iterate === true) parts.push('iterate="1"', 'iterateCount="100"');
    calcPrXml = `<calcPr ${parts.join(" ")}/>`;
  }

  const pivotCachesXml =
    pivotCacheRelIds.length === 0
      ? ""
      : `<pivotCaches>` +
        pivotCacheRelIds
          .map((id, index) => `<pivotCache cacheId="${index + 1}" r:id="${id}"/>`)
          .join("") +
        `</pivotCaches>`;

  // CT_Workbook のシーケンス順を守る。
  const workbookXml =
    `${XML_DECL}<workbook xmlns="${NS_SPREADSHEET}" xmlns:r="${NS_DOC_REL}">` +
    `<sheets>${sheetTags}</sheets>` +
    externalReferencesXml +
    definedNamesXml +
    calcPrXml +
    pivotCachesXml +
    `</workbook>`;

  // --- [Content_Types].xml ----------------------------------------------
  const overrides: string[] = [
    `<Override PartName="/xl/workbook.xml" ContentType="${isMacroEnabled ? CT_WORKBOOK_MACRO : CT_WORKBOOK}"/>`,
  ];
  spec.sheets.forEach((_unused, index) => {
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="${CT_WORKSHEET}"/>`,
    );
  });
  if (hasDocProps) {
    overrides.push(`<Override PartName="/docProps/core.xml" ContentType="${CT_CORE_PROPS}"/>`);
  }
  if (hasConnections) {
    overrides.push(`<Override PartName="/xl/connections.xml" ContentType="${CT_CONNECTIONS}"/>`);
  }
  externalLinks.forEach((_unused, index) => {
    overrides.push(
      `<Override PartName="/xl/externalLinks/externalLink${index + 1}.xml" ContentType="${CT_EXTERNAL_LINK}"/>`,
    );
  });
  pivotCaches.forEach((_unused, index) => {
    overrides.push(
      `<Override PartName="/xl/pivotCache/pivotCacheDefinition${index + 1}.xml" ContentType="${CT_PIVOT_CACHE_DEF}"/>`,
    );
  });

  const contentTypesXml =
    `${XML_DECL}<Types xmlns="${NS_CONTENT_TYPES}">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    (isMacroEnabled ? `<Default Extension="bin" ContentType="${CT_VBA}"/>` : "") +
    overrides.join("") +
    `</Types>`;

  // --- パーツの組み立て --------------------------------------------------
  const parts: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypesXml),
    "_rels/.rels": strToU8(
      `${XML_DECL}<Relationships xmlns="${NS_PACKAGE_REL}">` +
        `<Relationship Id="rId1" Type="${NS_DOC_REL}/officeDocument" Target="xl/workbook.xml"/>` +
        (hasDocProps
          ? `<Relationship Id="rId2" Type="${NS_CORE_PROPS_REL}" Target="docProps/core.xml"/>`
          : "") +
        `</Relationships>`,
    ),
    "xl/workbook.xml": strToU8(workbookXml),
    "xl/_rels/workbook.xml.rels": strToU8(
      `${XML_DECL}<Relationships xmlns="${NS_PACKAGE_REL}">` +
        rels
          .map((rel) => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${escapeXml(rel.target)}"/>`)
          .join("") +
        `</Relationships>`,
    ),
  };

  spec.sheets.forEach((sheet, index) => {
    parts[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(buildSheetXml(sheet));
  });

  if (spec.docProps) {
    const props = spec.docProps;
    parts["docProps/core.xml"] = strToU8(
      `${XML_DECL}<cp:coreProperties xmlns:cp="${NS_CORE_PROPS}" xmlns:dc="${NS_DC}" ` +
        `xmlns:dcterms="${NS_DCTERMS}" xmlns:dcmitype="${NS_DCMITYPE}" xmlns:xsi="${NS_XSI}">` +
        `<dc:creator>${escapeXml(props.creator)}</dc:creator>` +
        `<cp:lastModifiedBy>${escapeXml(props.lastModifiedBy)}</cp:lastModifiedBy>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(props.created)}</dcterms:created>` +
        `<dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(props.modified)}</dcterms:modified>` +
        `</cp:coreProperties>`,
    );
  }

  if (hasConnections) {
    const connectionXml = connections
      .map((connection, index) => {
        const command =
          connection.command === undefined ? "" : ` command="${escapeXml(connection.command)}"`;
        return (
          `<connection id="${index + 1}" name="${escapeXml(connection.name)}" type="1" refreshedVersion="6">` +
          `<dbPr connection="${escapeXml(connection.connectionString)}"${command}/>` +
          `</connection>`
        );
      })
      .join("");
    parts["xl/connections.xml"] = strToU8(
      `${XML_DECL}<connections xmlns="${NS_SPREADSHEET}">${connectionXml}</connections>`,
    );
  }

  externalLinks.forEach((link, index) => {
    const number = index + 1;
    const sheetNames = link.sheetNames ?? ["Sheet1"];
    parts[`xl/externalLinks/externalLink${number}.xml`] = strToU8(
      `${XML_DECL}<externalLink xmlns="${NS_SPREADSHEET}" xmlns:r="${NS_DOC_REL}">` +
        `<externalBook r:id="rId1"><sheetNames>` +
        sheetNames.map((name) => `<sheetName val="${escapeXml(name)}"/>`).join("") +
        `</sheetNames></externalBook></externalLink>`,
    );
    parts[`xl/externalLinks/_rels/externalLink${number}.xml.rels`] = strToU8(
      `${XML_DECL}<Relationships xmlns="${NS_PACKAGE_REL}">` +
        `<Relationship Id="rId1" Type="${NS_DOC_REL}/externalLinkPath" ` +
        `Target="${escapeXml(link.target)}" TargetMode="External"/>` +
        `</Relationships>`,
    );
  });

  pivotCaches.forEach((cache, index) => {
    parts[`xl/pivotCache/pivotCacheDefinition${index + 1}.xml`] = strToU8(
      `${XML_DECL}<pivotCacheDefinition xmlns="${NS_SPREADSHEET}" xmlns:r="${NS_DOC_REL}" ` +
        `refreshedDate="${escapeXml(cache.refreshedDate)}" recordCount="${cache.recordCount}" ` +
        `createdVersion="6" refreshedVersion="6" invalid="1">` +
        `<cacheSource type="worksheet"/><cacheFields count="0"/>` +
        `</pivotCacheDefinition>`,
    );
  });

  if (vbaModules !== undefined && vbaModules.length > 0) {
    parts["xl/vbaProject.bin"] = buildVbaProject(vbaModules);
  } else if (isMacroEnabled) {
    // ダミーのバイト列。実在の VBA プロジェクト（OLE2 複合ドキュメント）ではない。
    // 中身を読ませたい場合は vbaModules を使うこと。
    parts["xl/vbaProject.bin"] = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
  }

  return zipSync(parts, { mtime: FIXED_MTIME });
}
