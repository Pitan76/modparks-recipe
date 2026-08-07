import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'fs';

/**
 * 存在するエントリだけを対象にします。移行を1ページずつ進められるようにするためです。
 */
function entries(): Record<string, string> {
  const candidates = { search: 'src/client/search/main.tsx', portal: 'src/client/portal/main.tsx' };
  const found: Record<string, string> = {};
  for (const [name, path] of Object.entries(candidates)) {
    if (existsSync(path)) found[name] = path;
  }
  return found;
}

/**
 * 検索ページとアップロードのクライアントバンドル。
 *
 * 素の index.html を組む既定のビルド（vite.config.ts）とは出力先が別なので、
 * どちらかを流しても相手の成果物を消しません。
 */
export default defineConfig({
  // outDir が public 配下にあるため、publicDir を切らないと public/* が二重に複製される
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: 'public/app',
    emptyOutDir: true,
    // CSS は Worker がHTMLに直接埋めるため、JS からは吐かせない
    cssCodeSplit: false,
    rollupOptions: {
      // ラスタライザ（satori / resvg）の wasm は Worker 側だけで使います。ブラウザ側の描画は
      // SVG を組み立てるところまでで完結するため、読み込まれない経路のために解析させません。
      external: [/\.wasm$/],
      input: entries(),
      output: {
        // エントリ名は固定です。HTMLは毎回 Worker が組み立てるので名前を伝える仕組みは要らず、
        // 逆にハッシュを入れると「HTMLだけ古いまま残り、指し先のJSは消えている」404が起きます。
        // 常に再検証させるぶんの往復1回は、その事故を無くす対価として払います（index.ts の `onFound`）。
        entryFileNames: '[name].js',
        // 分割チャンクはHTMLからではなくエントリから参照されます。エントリが常に最新なら
        // 消えたチャンクを指すことはないため、ハッシュ付きのまま永続キャッシュに載せます。
        chunkFileNames: 'chunk-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
      },
    },
  },
});
