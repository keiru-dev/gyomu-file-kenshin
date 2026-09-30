// 検証用 .xlsm から、端末固有の情報（ホームディレクトリ名など）を伏せる。
//
//   npx vite-node scripts/redact-vba-fixture.ts
//
// なぜ必要か:
// Excel が書き出す vbaProject.bin の `dir` ストリームには、**そのファイルを編集した端末の
// ローカルパスが埋め込まれる**（型ライブラリのキャッシュ位置）。検証用ファイルをリポジトリに
// 置く以上、利用者名がそのまま残るのは望ましくない。
//
// ★ モジュール本体のストリームは書き換えない。
// このファイルの価値は「Microsoft が実際に圧縮したデータ」であることにあり、そこを作り直すと
// MS-OVBA 伸長の検証オラクルとして意味を失う（引き継ぎ書 §8 R-1）。伏せるのは dir だけ。

import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import { CFB } from "xlsx";
import { writeOvbaContainer } from "../fixtures/vba-builder";
import { decodeVbaText, decompressOvba, looksLikeContainer } from "../src/worker/ovba";

const TARGET = "fixtures/vba/sample-macro.xlsm";

/** 伏せる対象。ホームディレクトリ配下のパスに現れる利用者名を置き換える。 */
function redact(text: string): { text: string; hits: string[] } {
  const hits: string[] = [];
  const replaced = text.replace(/\/Users\/[^/\s"#]+/g, (match) => {
    hits.push(match);
    // 長さは変わってよい（非圧縮チャンクで書き直すため）。
    return "/Users/user";
  });
  return { text: replaced, hits };
}

function toBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

const original = new Uint8Array(readFileSync(TARGET));
const parts = unzipSync(original);
const vbaPart = parts["xl/vbaProject.bin"];
if (!vbaPart) throw new Error("xl/vbaProject.bin がありません");

const container = CFB.read(vbaPart, { type: "array" });
const dirEntry = CFB.find(container, "/VBA/dir");
if (!dirEntry) throw new Error("VBA/dir がありません");

const dirBytes = dirEntry.content as Uint8Array;
if (!looksLikeContainer(dirBytes, 0)) throw new Error("dir が圧縮コンテナではありません");

const plain = decodeVbaText(decompressOvba(dirBytes, 0));
const { text, hits } = redact(plain);

if (hits.length === 0) {
  console.log("端末固有のパスは見つかりませんでした。変更しません。");
  process.exit(0);
}

console.log("伏せる対象:");
for (const hit of [...new Set(hits)]) console.log(`  ${hit} → /Users/user`);

// dir を非圧縮コンテナとして書き直す。伸長結果が同じであればツール側の読み取りは変わらない。
dirEntry.content = writeOvbaContainer(toBytes(text)) as unknown as never;
dirEntry.size = (dirEntry.content as unknown as Uint8Array).length;

const rebuiltVba = new Uint8Array(CFB.write(container, { type: "array" }) as number[]);
parts["xl/vbaProject.bin"] = rebuiltVba;

writeFileSync(TARGET, zipSync(parts, { mtime: new Date("2020-01-01T00:00:00Z") }));
console.log(`\n${TARGET} を書き換えました（vbaProject.bin: ${vbaPart.length} → ${rebuiltVba.length} bytes）。`);
console.log("モジュール本体のストリームは変更していません（伸長の検証オラクルとして残すため）。");
