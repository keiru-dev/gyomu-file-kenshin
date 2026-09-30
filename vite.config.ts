import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * 配布物を識別するためのビルドID。
 * 流出経路を追えるようにするための措置（防止はできないが、どこから出たかの手がかりになる）。
 * 配布経路ごとに `DIST_TAG=note-article npm run build` のようにタグを付けて配る。
 */
function buildId(): string {
  let commit = "nogit";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // git が無い環境でもビルドは通す。
  }
  const now = new Date();
  const stamp =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, "0")}` +
    `${String(now.getDate()).padStart(2, "0")}`;
  const tag = process.env["DIST_TAG"];
  return tag ? `${tag}/${commit}-${stamp}` : `${commit}-${stamp}`;
}

// ツールのバージョンは package.json を唯一の出所にする（手書きの二重管理を避ける）。
// 成果物の「このツールについて」と、JSON 出力の toolVersion に使う。
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
  dependencies?: Record<string, string>;
};

// C-5 のライセンス表記を成果物に自動で埋め込む。
// 手書きだと依存を差し替えたときに古い表記が残るため、実際にインストールされている
// パッケージの package.json から読む。GPL 系が混ざったらビルド時に落とす。
const ALLOWED_LICENSE_PATTERN = /^(MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC)$/;

const dependencyLicenses = Object.keys(packageJson.dependencies ?? {}).map((name) => {
  const meta = JSON.parse(
    readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), "utf8"),
  ) as { version: string; license?: string };
  const license = meta.license ?? "UNKNOWN";
  if (!ALLOWED_LICENSE_PATTERN.test(license)) {
    throw new Error(
      `[C-5] 許容されないライセンスの依存があります: ${name}@${meta.version} (${license})。` +
        "MIT / Apache-2.0 / BSD 系のみ許容し、GPL 系は顧客への再配布が発生するため使えません。",
    );
  }
  return { name, version: meta.version, license };
});

/** 問い合わせ先のURL。`CONTACT_URL=none` を指定すると URL を埋め込まない。 */
function contactUrl(): string | null {
  const value = process.env.CONTACT_URL;
  if (value === "none") return null;
  return value && value !== "" ? value : "https://www.keiru-ai.com/contact?from=scanner";
}

/** 問い合わせの案内文。URL を持たない版では、どこへ連絡すればよいかを文章で示す。 */
function contactNote(): string {
  const value = process.env.CONTACT_NOTE;
  if (value && value !== "") return value;
  return contactUrl() === null
    ? "ご相談は、お取引のプラットフォーム上のメッセージからお願いします。"
    : "";
}

// R-A の仕上げ。出力を IIFE にしても Vite は <script type="module" crossorigin> を書き出す。
// モジュールスクリプトは CORS の対象なので file:// では読み込みに失敗する（＝ダブルクリックで白画面）。
// バンドルは IIFE なのでモジュール文脈は不要。属性を落として古典スクリプトに戻す。
//
// ただし type="module" には暗黙の defer があるため、属性を外すだけだと
// <head> 内で body の生成前に実行され、DOM 取得が null になって即例外になる（実測 2026-08-09）。
// classic script の inline に defer は効かないので、タグ自体を </body> 直前へ移す。
//
// viteSingleFile の後に走らせる必要があるため、plugins 配列でこの順に置いている。
function inlineScriptAsClassicAtBodyEnd(): Plugin {
  return {
    name: "inline-script-as-classic-at-body-end",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".html")) continue;
        if (typeof file.source !== "string") continue;

        let html = file.source;
        const inlineScripts: string[] = [];

        // src を持たない（＝インライン化済みの）script を抜き出す。
        html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attrs: string, body: string) => {
          if (/\ssrc\s*=/i.test(attrs)) return whole; // 外部参照は verify-artifact が別途落とす
          inlineScripts.push(body);
          return "";
        });

        if (inlineScripts.length === 0) continue;

        const rebuilt = inlineScripts.map((body) => `<script>${body}</script>`).join("\n");
        if (html.includes("</body>")) {
          // 置換文字列ではなくコールバックを使うこと。文字列を渡すと $& や $` が
          // 置換の特殊シーケンスとして解釈され、バンドル内の該当箇所が壊れる。
          // SheetJS のような大きなバンドルでは実際に発生し、
          // 「Uncaught SyntaxError: Invalid regular expression: missing /」として現れた（実測 2026-08-09）。
          html = html.replace("</body>", () => `${rebuilt}\n</body>`);
        } else {
          html += rebuilt;
        }
        file.source = html;
      }
    },
  };
}

// C-1（単一HTML・外部依存ゼロ）と R-A（file:// で ES モジュールは CORS で読めない）への対応。
//
// R-A: Vite の既定出力は <script type="module">。モジュールスクリプトは CORS の対象で、
// file:// は不透明オリジンのため読み込み自体が失敗する。http://localhost では完全に動作し、
// ダブルクリックしたときだけ白画面になるため極めて気づきにくい。
// 対策として出力を IIFE に固定し、動的 import も単一チャンクへ畳み込む。
// 実際に file:// で動くかは scripts/verify-artifact.mjs と手動のダブルクリック確認で担保する。
export default defineConfig({
  define: {
    __TOOL_VERSION__: JSON.stringify(packageJson.version),
    // ビルド年。「© <発行年> keiru」を手書きの固定値にしないための措置（devkit のブランド規約）。
    __BUILD_YEAR__: JSON.stringify(String(new Date().getFullYear())),
    __DEPENDENCY_LICENSES__: JSON.stringify(dependencyLicenses),
    __BUILD_ID__: JSON.stringify(buildId()),
    // 問い合わせ先。配布経路によっては外部URLを載せられない（ココナラ等）。
    //   既定            … keiru のお問い合わせフォームへのリンク
    //   CONTACT_URL=none … URLを持たせず、案内文だけを出す
    // 詳細は docs/distribution.md。
    __CONTACT_URL__: JSON.stringify(contactUrl()),
    __CONTACT_NOTE__: JSON.stringify(contactNote()),
  },
  // Worker は classic script として出力する。ES モジュール形式の Worker は file:// で
  // 読み込めないため（R-A と同じ理由）。
  worker: { format: "iife" },
  // removeViteModuleLoader は true にしないこと。IIFE 出力ではアプリ本体を
  // Vite のローダー shim と誤認して丸ごと削除し、空の <script> が出力される（実測 2026-08-09）。
  plugins: [
    viteSingleFile({ useRecommendedBuildConfig: false, removeViteModuleLoader: false }),
    inlineScriptAsClassicAtBodyEnd(),
  ],
  build: {
    target: "es2020",
    assetsInlineLimit: 100_000_000, // すべてのアセットを data: URI としてインライン化
    cssCodeSplit: false,
    reportCompressedSize: false,
    // sourcemap は成果物に外部 .map 参照を残しうるため無効。
    sourcemap: false,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "app.js",
        assetFileNames: "app.[ext]",
      },
    },
  },
});
