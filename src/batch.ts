// 複数ファイルの一括スキャン（引き継ぎ書 §3 Phase 2）。
//
// 設計方針:
// - **1ファイルずつ順番に処理する。** 現場のブックは100MB級があり、同時に読み込むと
//   メモリを使い切る。ファイルごとに Worker を起こして終わったら落とす。
// - 途中で1ファイルが失敗しても全体を止めない。壊れたファイルが1つ混ざっているだけで
//   フォルダ全体の診断が出せなくなるほうが、利用者にとって損失が大きい。
// - **フォルダ選択で得られるパス（`webkitRelativePath`）を出力に載せない。**
//   引き継ぎ書 §7-2 が禁じる「ファイルパス」にあたる。使うのは `file.name` だけ。

import type { AnalysisResult } from "./analysis";
import { TOOL_VERSION } from "./analysis";
import { ACCESS_NOTICE } from "./report/branding";
import { analyzeInWorker, type RunningAnalysis } from "./worker/client";

/** 解析対象とする拡張子。それ以外は読み込まずに対象外として記録する。 */
const SUPPORTED_EXTENSION = /\.(xlsx|xlsm)$/i;

/**
 * Access のファイル。対象外だが、他の非対応形式とは区別して扱う。
 * 「診断できません」で終わらせず、有償診断への導線にするため（引き継ぎ書 §8 R-2 の選択肢B）。
 */
const ACCESS_EXTENSION = /\.(accdb|mdb)$/i;

/** 対象外・失敗の区分。表示側が文言を出し分けるために使う。 */
export type BatchSkipReason = "access" | "unsupported-extension" | "unreadable";

export interface BatchEntry {
  /** ファイル名のみ。パスは含めない。 */
  fileName: string;
  sizeBytes: number;
  status: "done" | "unsupported" | "error";
  result?: AnalysisResult;
  /** 対象外・失敗の区分。 */
  reason?: BatchSkipReason;
  /** 対象外・失敗の理由（利用者向けの文言）。 */
  message?: string;
}

export interface BatchResult {
  schemaVersion: "1.0";
  scannedAt: string;
  toolVersion: string;
  summary: {
    /** 選ばれたファイル数。 */
    files: number;
    /** 実際に解析できた数。 */
    analyzed: number;
    /** 対象外・失敗の数。 */
    skipped: number;
    /** 解析できたファイル全体の合計。 */
    red: number;
    yellow: number;
  };
  files: BatchEntry[];
}

export function summarizeBatch(entries: BatchEntry[], now: Date): BatchResult {
  const analyzed = entries.filter((entry) => entry.status === "done");
  return {
    schemaVersion: "1.0",
    scannedAt: now.toISOString(),
    toolVersion: TOOL_VERSION,
    summary: {
      files: entries.length,
      analyzed: analyzed.length,
      skipped: entries.length - analyzed.length,
      red: analyzed.reduce((sum, entry) => sum + (entry.result?.summary.red ?? 0), 0),
      yellow: analyzed.reduce((sum, entry) => sum + (entry.result?.summary.yellow ?? 0), 0),
    },
    files: entries,
  };
}

/** 要対応の多い順に並べる。同数なら注意の多い順、それも同じならファイル名順。 */
export function sortBySeverity(entries: BatchEntry[]): BatchEntry[] {
  return [...entries].sort((a, b) => {
    const redDiff = (b.result?.summary.red ?? -1) - (a.result?.summary.red ?? -1);
    if (redDiff !== 0) return redDiff;
    const yellowDiff = (b.result?.summary.yellow ?? -1) - (a.result?.summary.yellow ?? -1);
    if (yellowDiff !== 0) return yellowDiff;
    return a.fileName.localeCompare(b.fileName, "ja");
  });
}

export interface BatchHandlers {
  /** 次のファイルの処理に入ったとき。 */
  onFileStart: (index: number, total: number, fileName: string) => void;
  /** 処理中のファイルの進捗。 */
  onProgress: (stage: string, done: number, total: number) => void;
  onFileDone: (entry: BatchEntry) => void;
  onAllDone: (result: BatchResult) => void;
}

export interface RunningBatch {
  abort: () => void;
}

function analyzeOne(
  file: File,
  now: Date,
  onProgress: BatchHandlers["onProgress"],
  register: (running: RunningAnalysis) => void,
): Promise<BatchEntry> {
  const base = { fileName: file.name, sizeBytes: file.size };

  if (ACCESS_EXTENSION.test(file.name)) {
    return Promise.resolve({
      ...base,
      status: "unsupported",
      reason: "access",
      message: ACCESS_NOTICE,
    });
  }

  if (!SUPPORTED_EXTENSION.test(file.name)) {
    return Promise.resolve({
      ...base,
      status: "unsupported",
      reason: "unsupported-extension",
      message: "このツールが対応しているのは .xlsx と .xlsm です。",
    });
  }

  return file
    .arrayBuffer()
    .then(
      (bytes) =>
        new Promise<BatchEntry>((resolve) => {
          register(
            analyzeInWorker(bytes, file.name, now, {
              onProgress,
              onDone: (result) => resolve({ ...base, status: "done", result }),
              onError: (kind, message) =>
                resolve({
                  ...base,
                  status: kind === "unsupported" ? "unsupported" : "error",
                  reason: kind === "unsupported" ? "unsupported-extension" : "unreadable",
                  message,
                }),
            }),
          );
        }),
    )
    .catch(() => ({
      ...base,
      status: "error" as const,
      reason: "unreadable" as const,
      message: "ファイルを読み込めませんでした。",
    }));
}

/** 選ばれたファイルを順番に解析する。 */
export function runBatch(files: File[], now: Date, handlers: BatchHandlers): RunningBatch {
  let aborted = false;
  let current: RunningAnalysis | undefined;
  const entries: BatchEntry[] = [];

  const run = async (): Promise<void> => {
    for (let index = 0; index < files.length; index += 1) {
      if (aborted) return;
      const file = files[index];
      if (!file) continue;

      handlers.onFileStart(index, files.length, file.name);
      const entry = await analyzeOne(file, now, handlers.onProgress, (running) => {
        current = running;
      });
      current = undefined;
      if (aborted) return;

      entries.push(entry);
      handlers.onFileDone(entry);
    }
    handlers.onAllDone(summarizeBatch(entries, now));
  };

  void run();

  return {
    abort: () => {
      aborted = true;
      current?.abort();
      current = undefined;
    },
  };
}
