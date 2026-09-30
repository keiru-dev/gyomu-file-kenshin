// VBA プロジェクト（xl/vbaProject.bin）の構成を読む。
//
// vbaProject.bin は OLE2 複合ドキュメント（CFB）。SheetJS が `CFB` を公開しているので、
// **追加依存なし**で解析できる（バンドルにも既に含まれている）。
//
// 取るのは「構成」と「ソースの静的解析結果」。モジュール本体は MS-OVBA の独自圧縮が
// かかっており、伸長は src/worker/ovba.ts が担う。
//
// ★ C-4 / §7-2: この層は **名前もソースも返さない**。
// モジュール名は顧客の業務内容を推測させ、ソースは業務ロジックそのもの。
// 返すのは種別ごとの件数・サイズ・類型ごとの該当件数だけで、そもそも持ち出せない形にしてある。

import { CFB } from "xlsx";
import { extractModuleSource } from "./ovba";

/** モジュールの種別。PROJECT ストリームの宣言から判別する。 */
export type VbaModuleKind = "document" | "module" | "class" | "form";

/**
 * VBA ソースから読み取った、危険になりうる操作の件数。
 * ★ 件数だけを持つ。ソース断片は持たない（顧客の業務ロジックそのものであるため）。
 */
export interface VbaCodeSignals {
  /** 外部への通信（XMLHTTP / WinHttp など）。 */
  network: number;
  /** シェル・外部プログラムの実行。 */
  shell: number;
  /** ファイルの書き出し・削除。 */
  fileAccess: number;
  /** 外部データベースへの接続。 */
  database: number;
  /** パスワードらしき記述。 */
  credential: number;
  /** 開いたときなどに自動で動く仕掛け。 */
  autoRun: number;
}

export interface VbaInfo {
  /** 種別ごとのモジュール数。 */
  counts: Record<VbaModuleKind, number>;
  /** モジュール本体ストリームの合計バイト数（圧縮された状態）。規模の目安。 */
  totalStreamBytes: number;
  /** モジュール本体ストリームの数。PROJECT の宣言数と一致するはず。 */
  streamCount: number;
  /** ソースを読み取れたモジュールの数。伸長できなければ 0 のままになる。 */
  analyzedModules: number;
  /** ソースの行数（属性行と空行を除く）。規模の目安。 */
  sourceLines: number;
  /** 危険になりうる操作の件数。 */
  signals: VbaCodeSignals;
}

/** モジュール本体ではない、VBA ストレージ内のメタデータ用ストリーム。 */
const METADATA_STREAMS = new Set(["dir", "_VBA_PROJECT"]);

/**
 * PROJECT ストリームから種別ごとの件数を数える。
 *
 * PROJECT は MS-OVBA では**圧縮されていない**プレーンテキストで、次のような行が並ぶ:
 *   Document=ThisWorkbook/&H00000000
 *   Module=Module1
 *   Class=Class1
 *   BaseClass=UserForm1
 *
 * バイト列を latin1 として読む。名前部分は日本語だと文字化けしうるが、
 * **名前は使わない**ので支障がない。判定に使う左辺のキーワードは常に ASCII。
 */
function countModules(projectStream: Uint8Array): Record<VbaModuleKind, number> {
  let text = "";
  for (const byte of projectStream) text += String.fromCharCode(byte);

  const counts: Record<VbaModuleKind, number> = { document: 0, module: 0, class: 0, form: 0 };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("Document=")) counts.document += 1;
    else if (line.startsWith("Module=")) counts.module += 1;
    else if (line.startsWith("Class=")) counts.class += 1;
    else if (line.startsWith("BaseClass=")) counts.form += 1;
  }

  return counts;
}

/**
 * vbaProject.bin を解析する。
 * CFB として読めない場合（壊れている、あるいは中身が VBA ではない）は undefined を返し、
 * 呼び出し側は「マクロあり」だけを扱う。ここで例外を投げて解析全体を止めない。
 */
export function readVbaProject(bytes: Uint8Array): VbaInfo | undefined {
  let container: ReturnType<typeof CFB.read>;
  try {
    container = CFB.read(bytes, { type: "array" });
  } catch {
    return undefined;
  }

  let totalStreamBytes = 0;
  let streamCount = 0;
  let projectStream: Uint8Array | undefined;
  const moduleStreams: Uint8Array[] = [];

  container.FullPaths.forEach((fullPath: string, index: number) => {
    const entry = container.FileIndex[index];
    if (!entry || entry.type !== 2) return; // ストリームのみ

    const name = fullPath.slice(fullPath.lastIndexOf("/") + 1);
    if (name === "PROJECT") {
      projectStream = entry.content as Uint8Array;
      return;
    }

    // モジュール本体は VBA ストレージの直下にある。
    if (!fullPath.includes("/VBA/")) return;
    if (METADATA_STREAMS.has(name)) return;

    streamCount += 1;
    const content = entry.content as Uint8Array;
    totalStreamBytes += entry.size ?? content.length;
    moduleStreams.push(content);
  });

  if (projectStream === undefined && streamCount === 0) return undefined;

  // ソースを伸長して静的解析にかける。伸長できないモジュールがあっても止めない。
  let analyzedModules = 0;
  let sourceLines = 0;
  const signals = emptySignals();

  for (const stream of moduleStreams) {
    const source = extractModuleSource(stream);
    if (source === undefined) continue;
    analyzedModules += 1;
    const scanned = scanVbaSource(source);
    sourceLines += scanned.lines;
    for (const key of Object.keys(signals) as (keyof VbaCodeSignals)[]) {
      signals[key] += scanned.signals[key];
    }
  }

  return {
    counts: projectStream ? countModules(projectStream) : { document: 0, module: 0, class: 0, form: 0 },
    totalStreamBytes,
    streamCount,
    analyzedModules,
    sourceLines,
    signals,
  };
}

// --- ソースの静的解析 -------------------------------------------------------
//
// ★ ここで扱う VBA ソースは顧客の業務ロジックそのもの。数式以上に機微であり、
// 判定に使うだけで **Finding に載せてはならない**（引き継ぎ書 §7-2）。
// この関数が返すのも件数だけで、ソースや行の内容は返さない。

/**
 * コメントと属性行を落とす。
 * VBA のコメントは `'`（文字列の外）または行頭の `Rem`。
 * コメントアウトされたコードを「実行される」と誤検知しないために必要。
 */
function stripNonCode(source: string): string[] {
  const lines: string[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    // モジュールの属性行は VBA が自動で付けるもので、利用者が書いたコードではない。
    if (/^\s*Attribute\s+VB_/i.test(rawLine)) continue;
    if (/^\s*Rem\b/i.test(rawLine)) continue;

    let code = "";
    let inString = false;
    for (let index = 0; index < rawLine.length; index += 1) {
      const character = rawLine[index];
      if (character === '"') {
        inString = !inString;
        code += character;
        continue;
      }
      if (character === "'" && !inString) break; // ここから先はコメント
      code += character;
    }

    if (code.trim() !== "") lines.push(code);
  }

  return lines;
}

/**
 * 類型ごとの検出パターン。
 * VBA は大文字小文字を区別しないので、判定も区別しない。
 * C-4: いずれも一般的な API 名・言語構文であり、特定の企業や業種に由来しない。
 */
const SIGNAL_PATTERNS: Record<keyof VbaCodeSignals, RegExp> = {
  network:
    /\b(?:MSXML2|ServerXMLHTTP|XMLHTTP|WinHttp|WinHttpRequest|InternetOpen|URLDownloadToFile|WinInet)\b/i,
  shell: /\b(?:Shell\s*\(|Shell\s+"|WScript\.Shell|ShellExecute|\.Exec\s*\()/i,
  fileAccess:
    /\b(?:Open\s+.+\s+For\s+(?:Output|Append|Binary|Random)|Kill\s+|FileSystemObject|CreateTextFile|OpenTextFile|SaveCopyAs|\.SaveAs\b|SetAttr\s+)/i,
  database: /\b(?:ADODB|OpenDatabase|DAO\.|Recordset|ConnectionString)\b/i,
  credential: /\b(?:Password|Passwd|Pwd)\b\s*(?::=|=)/i,
  autoRun: /\b(?:Auto_Open|Auto_Close|Auto_Exec|Workbook_Open|Workbook_BeforeClose|Document_Open)\b/i,
};

function emptySignals(): VbaCodeSignals {
  return { network: 0, shell: 0, fileAccess: 0, database: 0, credential: 0, autoRun: 0 };
}

/** 1モジュールぶんのソースを走査し、類型ごとの該当行数を数える。 */
export function scanVbaSource(source: string): { lines: number; signals: VbaCodeSignals } {
  const codeLines = stripNonCode(source);
  const signals = emptySignals();

  for (const line of codeLines) {
    for (const [key, pattern] of Object.entries(SIGNAL_PATTERNS)) {
      if (pattern.test(line)) signals[key as keyof VbaCodeSignals] += 1;
    }
  }

  return { lines: codeLines.length, signals };
}
