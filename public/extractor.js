/**
 * @fileoverview クライアント側で JAR ファイルを解凍・解析するための共有ロジック。
 * 
 * 特定のフレームワーク（Next.js/Hono）やUIライブラリに依存しないプレーンな JS として実装し、
 * 将来的に ModParks (メインアプリ) 側でもそのままコピーして流用できるように設計されています。
 * 
 * 呼び出し側で JSZip をグローバルに読み込んでおく必要があります。
 */

// アセットパス検出用の正規表現定義
const RECIPE_PATH = /^data\/([^/]+)\/recipes?\/(.+)\.json$/;
const TAG_PATH = /^data\/([^/]+)\/tags?\/(.+)\.json$/;
const TEXTURE_PATH = /^assets\/([^/]+)\/textures\/((?:item|block)\/.+)\.png$/;
const MODEL_PATH = /^assets\/([^/]+)\/models\/((?:item|block)\/.+)\.json$/;
const LANG_PATH = /^assets\/([^/]+)\/lang\/([a-z]{2,8}(?:_[a-z0-9]{2,8})?)\.json$/;

/**
 * 読み込んだ JSZip インスタンスからアセットを抽出し、bulk API 送信用のオブジェクトを組み立てます。
 * @param {object} zip JSZip のインスタンス
 * @returns {Promise<{
 *   data: { recipes: object, tags: object, textures: object, models: object, langs: object },
 *   namespaces: string[],
 *   counts: { recipes: number, tags: number, textures: number, models: number, langs: number }
 * }>} 抽出されたデータとメタ情報
 */
async function analyzeJar(zip) {
  const data = { recipes: {}, tags: {}, textures: {}, models: {}, langs: {} };
  const namespaces = new Set();
  const paths = Object.keys(zip.files).filter(p => !zip.files[p].dir);

  for (const path of paths) {
    let m;
    if ((m = path.match(RECIPE_PATH))) {
      namespaces.add(m[1]);
      data.recipes[m[2]] = await zip.files[path].async('string');
    } else if ((m = path.match(TAG_PATH))) {
      data.tags[m[2]] = await zip.files[path].async('string');
    } else if ((m = path.match(TEXTURE_PATH))) {
      const bytes = new Uint8Array(await zip.files[path].async('arraybuffer'));
      data.textures[m[2] + '.png'] = bytesToBase64(bytes);
    } else if ((m = path.match(MODEL_PATH))) {
      data.models[m[2]] = await zip.files[path].async('string');
    } else if ((m = path.match(LANG_PATH))) {
      data.langs[m[2]] = await zip.files[path].async('string');
    }
  }

  return {
    data,
    namespaces: Array.from(namespaces),
    counts: {
      recipes: Object.keys(data.recipes).length,
      tags: Object.keys(data.tags).length,
      textures: Object.keys(data.textures).length,
      models: Object.keys(data.models).length,
      langs: Object.keys(data.langs).length
    }
  };
}

/**
 * Uint8Array のバイナリデータを、スタックオーバーフローを避けて base64 にエンコードします。
 * @param {Uint8Array} bytes 
 * @returns {string} base64文字列
 */
function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000; // スタック上限を避けるため分割処理
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// 念のため、CommonJS / ESModule の環境でも使えるように export 定義
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { analyzeJar, bytesToBase64 };
} else if (typeof exports !== 'undefined') {
  exports.analyzeJar = analyzeJar;
  exports.bytesToBase64 = bytesToBase64;
}
