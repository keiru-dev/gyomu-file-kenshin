// 解析の本体（Worker から独立した純粋な関数）と、Worker とのやり取りに使う型。
//
// Worker の外に出しているのは、Node 上のテストからそのまま呼べるようにするため。
// Worker の配線（src/worker/analyze.ts）は、この関数に postMessage を被せているだけ。

import { runRules } from "./rules";
import { buildCoverageNotes } from "./rules/checklist";
import type { CoverageNote } from "./rules/checklist";
import type { Finding } from "./rules/types";
import { readCells } from "./worker/cells";
import { readContainer, UnsupportedFormatError } from "./worker/container";
import type { ProgressReporter } from "./worker/container";

export const TOOL_VERSION = __TOOL_VERSION__;

/** 引き継ぎ書 §6.4 の JSON 出力スキーマ。 */
export interface AnalysisResult {
  schemaVersion: "1.0";
  /** ISO 8601（UTC）。 */
  scannedAt: string;
  toolVersion: string;
  file: {
    /** ファイル名のみ。パスは含めない（引き継ぎ書 §6.4 / §7-2）。 */
    name: string;
    sizeBytes: number;
    format: "xlsx" | "xlsm";
    /**
     * 対象ファイルの指紋（SHA-256 の16進）。取得できなければ undefined。
     * どのファイルに対する診断結果かを後から特定するために使う（docs/operations.md）。
     * ハッシュは元データではないので §7-2 に反しない。
     */
    sha256?: string;
  };
  summary: { red: number; yellow: number; info: number };
  findings: Finding[];
  /**
   * 確認しきれなかった範囲。該当がなければ空配列。
   *
   * 「確認していない範囲は、その旨を明記します」（CLAUDE.md）を、文面ではなく
   * データとして持つ。ここが空であることが「全項目を確認できた」の根拠になる。
   *
   * schemaVersion は "1.0" のまま据え置いた。**追加のみで、既存フィールドの意味を
   * 変えていない**ため、既存の読み手は無視すれば従来どおり動く。
   */
  limitations: CoverageNote[];
}

export interface AnalyzeOptions {
  /** ファイル名のみ。パスを渡さないこと。 */
  fileName: string;
  /** 走査日時。「最終更新から N 日以上」の判定に使う。 */
  now: Date;
  onProgress?: ProgressReporter;
  /**
   * 対象ファイルの指紋。計算は非同期なので、この関数の外で求めて渡す。
   * 解析そのものを同期のまま保つための分担（テストからも呼びやすい）。
   */
  sha256?: string;
}

/** ファイル名から拡張子だけを見て形式を決める。 */
function formatOf(fileName: string): "xlsx" | "xlsm" {
  return fileName.toLowerCase().endsWith(".xlsm") ? "xlsm" : "xlsx";
}

/**
 * L1 → L2 → ルール適用 を通しで実行する。
 * ZIP でない等の非対応形式は UnsupportedFormatError を投げる（呼び出し側で明示的に表示する）。
 */
export function analyzeWorkbook(bytes: Uint8Array, options: AnalyzeOptions): AnalysisResult {
  const { fileName, now, onProgress } = options;

  onProgress?.("ファイルの構造を確認中", 0, 1);
  const container = readContainer(bytes, onProgress);

  const cells = readCells(bytes, onProgress);

  onProgress?.("問題点を照合中", 0, 1);
  const findings = runRules({
    container,
    cells,
    fileName,
    fileSizeBytes: bytes.length,
    now,
  });
  onProgress?.("問題点を照合中", 1, 1);

  return {
    schemaVersion: "1.0",
    scannedAt: now.toISOString(),
    toolVersion: TOOL_VERSION,
    file: {
      name: fileName,
      sizeBytes: bytes.length,
      format: formatOf(fileName),
      ...(options.sha256 === undefined ? {} : { sha256: options.sha256 }),
    },
    summary: {
      red: findings.filter((finding) => finding.severity === "RED").length,
      yellow: findings.filter((finding) => finding.severity === "YELLOW").length,
      info: findings.filter((finding) => finding.severity === "INFO").length,
    },
    findings,
    limitations: buildCoverageNotes({
      // 打ち切りはシート単位で起きる。1枚でも打ち切られていれば、
      // ブック全体としては「一部にとどめた」と伝えるのが正しい。
      formulasTruncated: cells.sheets.some((sheet) => sheet.formulasTruncated),
      errorsTruncated: cells.sheets.some((sheet) => sheet.errorsTruncated),
      vbaStreamCount: container.vba?.streamCount ?? 0,
      vbaAnalyzedModules: container.vba?.analyzedModules ?? 0,
    }),
  };
}

export { UnsupportedFormatError };

// --- Worker とのやり取り ---------------------------------------------------

export interface AnalyzeRequest {
  type: "analyze";
  /** 転送されたファイル本体。 */
  bytes: ArrayBuffer;
  fileName: string;
  /** 走査日時（ISO 8601）。Worker 側で new Date() を呼ばず、呼び出し側の時刻を使う。 */
  nowIso: string;
}

export type WorkerRequest = AnalyzeRequest;

export type WorkerResponse =
  | { type: "progress"; stage: string; done: number; total: number }
  | { type: "done"; result: AnalysisResult }
  | { type: "error"; kind: "unsupported" | "unknown"; message: string };
