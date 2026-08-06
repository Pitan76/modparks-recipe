import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

/** 生成したバンドル名の受け渡し先。Worker はここを読んで script タグを書きます。 */
const MANIFEST_FILE = 'src/generated/client-bundles.ts';

/**
 * ビルド結果のファイル名をTSとして書き出すプラグイン。
 *
 * ファイル名にはハッシュが入るため、Worker 側で名前を決め打ちできません。
 * ビルドのたびにここを更新し、`?v=` を付けずとも新しい版が読まれるようにします。
 */
function emitBundleManifest(): Plugin {
  return {
    name: 'emit-bundle-manifest',
    writeBundle(_options, bundle) {
      const entries: Record<string, string> = {};
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) entries[chunk.name] = chunk.fileName;
      }
      const body =
        '/** 自動生成。`npm run build:client` が書き換えます。手で編集しないこと。 */\n' +
        `export const CLIENT_BUNDLES = ${JSON.stringify(entries, null, 2)} as const;\n`;
      mkdirSync(dirname(MANIFEST_FILE), { recursive: true });
      writeFileSync(MANIFEST_FILE, body, 'utf8');
    },
  };
}

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
 * 検索ページと投稿ポータルのクライアントバンドル。
 *
 * 素の index.html を組む既定のビルド（vite.config.ts）とは出力先が別なので、
 * どちらかを流しても相手の成果物を消しません。
 */
export default defineConfig({
  // outDir が public 配下にあるため、publicDir を切らないと public/* が二重に複製される
  publicDir: false,
  plugins: [react(), emitBundleManifest()],
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
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: 'chunk-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
      },
    },
  },
});
