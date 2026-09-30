// VBA プロジェクト（vbaProject.bin）を組み立てるための道具。
//
// 用途は2つ:
//   1. 検出ルール用のフィクスチャを作る（架空のマクロを含む .xlsm）
//   2. Excel が書き出した実ファイルから、端末固有の情報を伏せた版を作る
//
// ★ 圧縮は行わず、MS-OVBA の「非圧縮チャンク」だけでコンテナを組む。
// 仕様上これは正当な形式であり（2.4.1.3.12 の CompressedChunkFlag = 0）、
// **自作の圧縮器を持たずに済む**。自作の圧縮器で作ったデータを自作の伸長器で読むと、
// 自分の思い違いを検証できなくなるため、あえて持たない判断（引き継ぎ書 §8 R-1）。

import { CFB } from "xlsx";

/** 非圧縮チャンク1つに入れられる最大バイト数（MS-OVBA 2.4.1.1.4）。 */
const MAX_CHUNK_BYTES = 4096;

/** バイト列を MS-OVBA の圧縮コンテナ形式（非圧縮チャンク）で包む。 */
export function writeOvbaContainer(data: Uint8Array): Uint8Array {
  const chunks: number[] = [0x01]; // 署名バイト

  for (let offset = 0; offset < data.length; offset += MAX_CHUNK_BYTES) {
    const slice = data.subarray(offset, offset + MAX_CHUNK_BYTES);
    // CompressedChunkSize = (header & 0x0FFF) + 3 で、ヘッダ2バイトを含む全長。
    // 全長 = 2 + slice.length なので、格納する値は slice.length - 1。
    const header = ((slice.length - 1) & 0x0fff) | (0b011 << 12); // bit15 = 0 → 非圧縮
    chunks.push(header & 0xff, (header >> 8) & 0xff);
    for (const byte of slice) chunks.push(byte);
  }

  return new Uint8Array(chunks);
}

/** 文字列を latin1 のバイト列にする（ASCII 前提）。 */
function toBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

export type VbaModuleKindSpec = "document" | "module" | "class" | "form";

export interface VbaModuleSpec {
  name: string;
  kind: VbaModuleKindSpec;
  /** VBA のソース。`Attribute VB_Name` 行は自動で付ける。 */
  source: string;
}

const PROJECT_DECLARATION: Record<VbaModuleKindSpec, (name: string) => string> = {
  document: (name) => `Document=${name}/&H00000000`,
  module: (name) => `Module=${name}`,
  class: (name) => `Class=${name}`,
  form: (name) => `BaseClass=${name}`,
};

/**
 * vbaProject.bin を組み立てる。
 * 構造は Excel が書き出すものに合わせてあるが、最小限（PROJECT / VBA/dir / 各モジュール）。
 */
export function buildVbaProject(modules: VbaModuleSpec[]): Uint8Array {
  const container = CFB.utils.cfb_new();

  // PROJECT は圧縮されないプレーンテキスト。モジュールの種別はここから読み取られる。
  const projectLines = [
    'ID="{00000000-0000-0000-0000-000000000000}"',
    ...modules.map((module) => PROJECT_DECLARATION[module.kind](module.name)),
    'Name="VBAProject"',
    'HelpContextID="0"',
    "",
    "[Workspace]",
    ...modules.map((module) => `${module.name}=0, 0, 0, 0, C`),
    "",
  ];
  CFB.utils.cfb_add(container, "/PROJECT", toBytes(projectLines.join("\r\n")));

  // dir は本来モジュールの一覧やコードページを持つが、このツールは読まないので最小限にする。
  CFB.utils.cfb_add(container, "/VBA/dir", writeOvbaContainer(toBytes("VBAProject")));

  for (const module of modules) {
    const source = `Attribute VB_Name = "${module.name}"\r\n${module.source}\r\n`;
    CFB.utils.cfb_add(container, `/VBA/${module.name}`, writeOvbaContainer(toBytes(source)));
  }

  return new Uint8Array(CFB.write(container, { type: "array" }) as number[]);
}
