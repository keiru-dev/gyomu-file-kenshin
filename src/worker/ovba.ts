// MS-OVBA の圧縮コンテナを伸長する。
//
// VBA のモジュール本体は、OLE2 ストリームの中に Microsoft 独自の RLE 系圧縮で格納されている。
// ZIP でも gzip でもないため、既存のライブラリでは読めず自前実装が要る（引き継ぎ書 §8 R-1）。
//
// 仕様の要点（MS-OVBA 2.4.1）:
// - コンテナは署名バイト 0x01 で始まり、その後に「チャンク」が並ぶ
// - チャンクヘッダは 2 バイト（リトルエンディアン）
//     bit 0-11 : チャンクの長さ - 3（ヘッダ2バイトを含む）
//     bit 12-14: 署名。必ず 0b011
//     bit 15   : 1 なら圧縮済み、0 なら生データ
// - 圧縮チャンクは「フラグバイト1個 + トークン最大8個」の繰り返し
//     フラグの各ビット（下位から）が 0 ならリテラル1バイト、1 ならコピートークン2バイト
// - コピートークンの解釈は、そのチャンク内で既に展開したバイト数によってビット幅が変わる
//
// ★ 実装の検証について
// 自作の圧縮器で作ったデータを自作の伸長器で読んでも、自分の思い違いは見つけられない。
// Excel が実際に書き出した .xlsm（fixtures/vba/sample-macro.xlsm）を唯一の正解として検証する。

export class OvbaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OvbaError";
  }
}

/** 伸長結果を溜める、伸びるバイト列。 */
class ByteSink {
  private buffer = new Uint8Array(1024);
  private length = 0;

  push(byte: number): void {
    if (this.length === this.buffer.length) {
      const grown = new Uint8Array(this.buffer.length * 2);
      grown.set(this.buffer);
      this.buffer = grown;
    }
    this.buffer[this.length++] = byte;
  }

  /** 既に書き込んだ位置から読み戻す（コピートークン用）。 */
  at(index: number): number {
    return this.buffer[index] ?? 0;
  }

  get size(): number {
    return this.length;
  }

  toBytes(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

/**
 * コピートークンのビット幅。
 * そのチャンクで既に展開したバイト数（difference）に応じて 4〜12 ビットの間で変わる。
 * 仕様上は `max(ceil(log2(difference)), 4)`。浮動小数を避けて反復で求める。
 */
function copyTokenBitCount(difference: number): number {
  let bits = 4;
  while (bits < 12 && 1 << bits < difference) bits += 1;
  return bits;
}

/** 指定位置が圧縮コンテナの先頭として妥当か（署名バイト + 正しいチャンク署名）。 */
export function looksLikeContainer(data: Uint8Array, start: number): boolean {
  if (start + 2 >= data.length) return false;
  if (data[start] !== 0x01) return false;
  const header = (data[start + 1] ?? 0) | ((data[start + 2] ?? 0) << 8);
  return ((header >> 12) & 0x07) === 0b011;
}

/**
 * 圧縮コンテナを伸長する。
 * `start` はコンテナの署名バイト（0x01）の位置。
 */
export function decompressOvba(data: Uint8Array, start = 0): Uint8Array {
  if (!looksLikeContainer(data, start)) {
    throw new OvbaError("MS-OVBA の圧縮コンテナとして解釈できません。");
  }

  const out = new ByteSink();
  let position = start + 1;

  while (position + 1 < data.length) {
    const header = (data[position] ?? 0) | ((data[position + 1] ?? 0) << 8);
    position += 2;

    const chunkSignature = (header >> 12) & 0x07;
    if (chunkSignature !== 0b011) {
      // 後続がチャンクでなくなったら、そこでコンテナの終わりとみなす。
      break;
    }

    const chunkSize = (header & 0x0fff) + 3;
    const chunkEnd = Math.min(position + chunkSize - 2, data.length);
    const isCompressed = (header & 0x8000) !== 0;

    if (!isCompressed) {
      // 生データのチャンク。そのまま書き出す。
      for (let index = position; index < chunkEnd; index += 1) out.push(data[index] ?? 0);
      position = chunkEnd;
      continue;
    }

    // 圧縮チャンク。コピートークンの参照範囲はチャンク単位で閉じている。
    const chunkStart = out.size;

    while (position < chunkEnd) {
      const flags = data[position++] ?? 0;

      for (let bit = 0; bit < 8 && position < chunkEnd; bit += 1) {
        if (((flags >> bit) & 1) === 0) {
          out.push(data[position++] ?? 0);
          continue;
        }

        const token = (data[position] ?? 0) | ((data[position + 1] ?? 0) << 8);
        position += 2;

        const difference = out.size - chunkStart;
        const bitCount = copyTokenBitCount(difference);
        const lengthMask = 0xffff >> bitCount;
        const length = (token & lengthMask) + 3;
        const offset = (token >> (16 - bitCount)) + 1;

        const from = out.size - offset;
        if (from < chunkStart) {
          throw new OvbaError("圧縮データの参照位置が不正です。");
        }
        // 参照範囲が重なることがあるため、1バイトずつ写す。
        for (let index = 0; index < length; index += 1) out.push(out.at(from + index));
      }
    }

    position = chunkEnd;
  }

  return out.toBytes();
}

/**
 * モジュールのストリームからソース部分を取り出して伸長する。
 *
 * ストリームの先頭には可変長の「パフォーマンスキャッシュ」があり、その後ろに圧縮された
 * ソースが続く。開始位置は本来 `dir` ストリームの MODULEOFFSET に書かれているが、
 * `dir` は同じ圧縮がかかっているうえ、レコード内に Unicode 名が入れ子で続く箇所があり
 * 単純な走査では位置がずれる。
 *
 * ここでは**先頭から圧縮コンテナらしき位置を探し、伸長結果が VBA ソースとして妥当かを
 * 検証する**方式を採る。誤った位置から伸長すれば結果は VBA ソースにならないため、
 * 「見つけた」と言えるのは検証を通ったときだけになる。
 */
export function extractModuleSource(stream: Uint8Array): string | undefined {
  for (let start = 0; start + 2 < stream.length; start += 1) {
    if (!looksLikeContainer(stream, start)) continue;

    let decompressed: Uint8Array;
    try {
      decompressed = decompressOvba(stream, start);
    } catch {
      continue;
    }

    const text = decodeVbaText(decompressed);
    // VBA のモジュールは必ずこの宣言で始まる（MS-OVBA 2.3.4.3）。
    if (text.startsWith("Attribute VB_Name")) return text;
  }
  return undefined;
}

/**
 * VBA ソースのバイト列を文字列にする。
 *
 * 本来の文字コードは `dir` の PROJECTCODEPAGE に書かれている。日本語環境では cp932 が多い。
 * 静的解析で見たいのはキーワード（ASCII）なので、**ASCII 以外は判定に使わない**前提で
 * バイトをそのまま文字にする（latin1 相当）。
 * これにより文字コードの推定に失敗しても、キーワード検出の結果は変わらない。
 *
 * ★ 復号したテキストは判定にのみ使い、Finding に載せてはならない（顧客の業務ロジックそのもの）。
 */
export function decodeVbaText(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}
