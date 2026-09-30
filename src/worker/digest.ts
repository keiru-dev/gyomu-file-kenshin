// 診断対象ファイルの指紋（SHA-256）。
//
// なぜ要るか（docs/operations.md）:
// 顧客のファイルを預かって診断し、レポートを返す運用では、**どのファイルに対する結果かを
// 後から特定できる**ことに意味がある。同名ファイルの区別、更新後の再診断との比較、
// 誤ったレポートを渡していないことの確認に使える。
//
// ★ ハッシュは元データではないので §7-2 に反しない。
// 逆にハッシュから中身を復元することもできない。
//
// 実測（2026-08-16・`file://` + C-2 の CSP + 通信遮断）:
// Chrome 151 / Edge 151 / Firefox 153 のいずれも `isSecureContext` が true で、
// **Worker の中でも `crypto.subtle` が使える**ことを確認済み。
// `crypto.subtle` は secure context 限定なので、この確認なしに「使える」とは書けなかった。

/** バイト列の SHA-256 を16進文字列で返す。使えない環境では undefined。 */
export async function sha256Hex(bytes: Uint8Array): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;

  try {
    // BufferSource として渡すため、必要なぶんだけを切り出したビューを作る。
    const digest = await subtle.digest("SHA-256", bytes.slice().buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    // 指紋が取れなくても診断そのものは成立する。ここで解析全体を止めない。
    return undefined;
  }
}

/** 画面に出すときの読みやすい形。4文字ずつ区切る。 */
export function formatDigest(hex: string): string {
  return (hex.match(/.{1,4}/g) ?? [hex]).join(" ");
}
