// Worker のエントリ。解析本体は src/analysis.ts にあり、ここは postMessage を被せるだけ。
//
// このファイルは `?worker&inline` で読み込まれ、バンドル結果が Blob URL 経由で起動される。
// 外部 worker ファイルを出力すると C-1（単一HTML）違反になるため、inline は必須。
//
// 中断について: 解析は同期処理なので、実行中に届いた「中断」メッセージは処理されない。
// 中断は呼び出し側の worker.terminate() で行う（src/worker/client.ts）。
// ここで擬似的な中断フラグを持たせても実際には止まらないため、あえて実装していない。

import { analyzeWorkbook, UnsupportedFormatError } from "../analysis";
import type { WorkerRequest, WorkerResponse } from "../analysis";
import { sha256Hex } from "./digest";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== "analyze") return;

  const bytes = new Uint8Array(request.bytes);

  // 指紋の計算は非同期。解析本体を同期のまま保つため、先に済ませてから渡す。
  // 取れなくても診断は成立するので、失敗しても止めない（digest.ts 側で undefined になる）。
  void sha256Hex(bytes).then((sha256) => {
  try {
    const result = analyzeWorkbook(bytes, {
      fileName: request.fileName,
      now: new Date(request.nowIso),
      sha256,
      onProgress: (stage, done, total) => post({ type: "progress", stage, done, total }),
    });
    post({ type: "done", result });
  } catch (error) {
    if (error instanceof UnsupportedFormatError) {
      post({ type: "error", kind: "unsupported", message: error.message });
      return;
    }
    // 想定外の失敗。元データの内容が混ざらないよう、メッセージは固定文にする。
    post({
      type: "error",
      kind: "unknown",
      message: "ファイルの解析中に問題が発生しました。ファイルが壊れている可能性があります。",
    });
  }
  });
};
