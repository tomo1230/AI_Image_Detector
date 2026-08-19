import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * /models/ 配下の実在しないファイルに対し、Vite の SPA フォールバック
 * (index.html を 200 で返す)を抑止して 404 を返す。
 *
 * これが無いと、transformers.js が「ローカルに無いモデル」を取得しようとした際に
 * HTML を 200 で受け取り、JSON 解析に失敗し、リモート(HF Hub)へのフォールバックも
 * 壊れる。404 を返せば、リモートモデルは正しく HF へフォールバックする。
 */
function modelsNotFoundPlugin(): Plugin {
  return {
    name: "models-404-not-fallback",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url && url.startsWith("/models/")) {
          // 旧バージョンの誤った 200-HTML がキャッシュされる事故を防ぐ。
          res.setHeader("Cache-Control", "no-store");
          const filePath = path.join(
            process.cwd(),
            "public",
            decodeURIComponent(url)
          );
          if (!fs.existsSync(filePath)) {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
        }
        next();
      });
    },
  };
}

// transformers.js と c2pa は WASM を使うため、最適化対象から外して
// そのまま配信させる(事前バンドルでの取り違えを防ぐ)。
export default defineConfig({
  plugins: [modelsNotFoundPlugin()],
  optimizeDeps: {
    exclude: ["@huggingface/transformers", "c2pa"],
  },
  server: {
    // SharedArrayBuffer (WASM スレッド) を有効化するためのヘッダ。
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
