// メインスレッド側の Worker 窓口。
//
// 単一HTML内での Worker 起動は Blob URL 経由で行う（引き継ぎ書 §4.3）。
// Vite の `?worker&inline` がバンドルを埋め込み、実行時に Blob を作って起動する。
// CSP の `worker-src blob:` はこのために必要（C-2 の注記を参照）。

import AnalyzeWorker from "./analyze?worker&inline";
import type { AnalysisResult, WorkerResponse } from "../analysis";

export interface AnalysisHandlers {
  onProgress?: (stage: string, done: number, total: number) => void;
  onDone: (result: AnalysisResult) => void;
  /** kind: "unsupported" は非対応形式、"unknown" は想定外の失敗。 */
  onError: (kind: "unsupported" | "unknown", message: string) => void;
}

export interface RunningAnalysis {
  /**
   * 解析を中断する。
   * 解析は Worker 内で同期実行されるため、メッセージでは止められない。
   * terminate() で Worker ごと落とすのが唯一の確実な手段。
   */
  abort: () => void;
}

/**
 * ファイルを Worker で解析する。
 * バイト列は転送（transfer）するため、呼び出し側の ArrayBuffer は解析後に空になる。
 */
export function analyzeInWorker(
  bytes: ArrayBuffer,
  fileName: string,
  now: Date,
  handlers: AnalysisHandlers,
): RunningAnalysis {
  const worker = new AnalyzeWorker();
  let finished = false;

  const cleanUp = (): void => {
    finished = true;
    worker.terminate();
  };

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === "progress") {
      handlers.onProgress?.(message.stage, message.done, message.total);
      return;
    }
    if (message.type === "done") {
      cleanUp();
      handlers.onDone(message.result);
      return;
    }
    cleanUp();
    handlers.onError(message.kind, message.message);
  };

  worker.onerror = () => {
    if (finished) return;
    cleanUp();
    handlers.onError("unknown", "解析処理を開始できませんでした。");
  };

  worker.postMessage({ type: "analyze", bytes, fileName, nowIso: now.toISOString() }, [bytes]);

  return {
    abort: () => {
      if (finished) return;
      cleanUp();
    },
  };
}
