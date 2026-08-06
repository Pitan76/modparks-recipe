import { defineConfig } from 'vite';

/**
 * `/extractor.js` を公開URLのまま吐き直すためのビルド。
 *
 * ハッシュ付きのバンドル（vite.client.config.ts）とは違い、外部が直接読む固定URLなので
 * ファイル名を変えられません。素の script タグから読めるよう IIFE で出します。
 * `public/` を出力先にしつつ `emptyOutDir` を切っているのは、他の静的ファイルを消さないためです。
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public',
    emptyOutDir: false,
    // 呼び出し側は素の script タグなので、モジュール前提の出力にはできない
    target: 'es2019',
    // 読んで流用されることを想定した配布物なので、潰さずコメントごと出す。
    // 2kB 程度でしかなく、縮めて得られるものより中身が読めることのほうが価値が大きい。
    minify: false,
    lib: {
      entry: 'src/client/extractor-global.ts',
      formats: ['iife'],
      name: 'MPRExtractor',
      fileName: () => 'extractor.js',
    },
    rollupOptions: {
      output: {
        banner:
          '/**\n' +
          ' * jar からレシピ・タグ・テクスチャ・モデル・言語ファイルを抜き出す共有ロジック。\n' +
          ' *\n' +
          ' * これは生成物です。直接編集しても次のビルドで消えます。\n' +
          ' * 実装元: src/core/jar-assets.ts / src/core/paths.ts\n' +
          ' *\n' +
          ' * 使い方: JSZip を先に読み込み、展開済みのインスタンスを渡します。\n' +
          ' *   const zip = await JSZip.loadAsync(await file.arrayBuffer());\n' +
          ' *   const { byNs, namespaces, counts } = await analyzeJar(zip);\n' +
          ' */',
      },
    },
  },
});
