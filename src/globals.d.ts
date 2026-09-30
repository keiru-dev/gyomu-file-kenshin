// ビルド時に Vite の define で差し替えられる定数。
// 実体は vite.config.ts で package.json とビルド日から埋め込む。

/** ツールのバージョン（package.json の version）。 */
declare const __TOOL_VERSION__: string;

/** ビルドした年（西暦4桁）。著作権表記に使う。手書きの固定値にしないための仕組み。 */
declare const __BUILD_YEAR__: string;

/** 問い合わせ先のURL。`CONTACT_URL=none` でビルドすると null になる。 */
declare const __CONTACT_URL__: string | null;

/** 問い合わせの案内文。URL を持たない版で使う。 */
declare const __CONTACT_NOTE__: string;

/** 配布物を識別するビルドID。`DIST_TAG` を付けてビルドすると配布経路も含まれる。 */
declare const __BUILD_ID__: string;

/** 実行時依存のライセンス表記（C-5）。node_modules の実体から生成される。 */
declare const __DEPENDENCY_LICENSES__: readonly { name: string; version: string; license: string }[];

/** Vite の `?worker&inline` インポート。単一HTML化のため必ず inline を使う。 */
declare module "*?worker&inline" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
