/**
 * 1つの検出ルールに対して「検出されるべき」「検出されるべきでない」を対で用意する。
 * 引き継ぎ書 §10 が求める「各ルールの検出・非検出の両方を検証」を、フィクスチャ側から支える構造。
 */
export interface FixtureCase {
  /** ファイル名にも使う識別子。例: "hidden-sheet--detected" */
  id: string;
  /** 対応する検出ルール。例: "HIDDEN_SHEET" */
  ruleId: string;
  /** detected = そのルールが検出されるべき / clean = 検出されてはならない */
  expectation: "detected" | "clean";
  /** 何を再現しているかの説明（日本語）。 */
  description: string;
  /** .xlsx のバイト列を生成する。同じケースからは常に同じバイト列が出ること。 */
  build(): Uint8Array;
}
