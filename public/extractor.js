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
 * 読み込んだ JSZip インスタンスからアセットを抽出し、名前空間別に分離したオブジェクトを組み立てます。
 * @param {object} zip JSZip のインスタンス
 * @returns {Promise<{
 *   byNs: object,
 *   namespaces: string[],
 *   counts: { recipes: number, tags: number, textures: number, models: number, langs: number }
 * }>} 抽出されたデータとメタ情報
 */
async function analyzeJar(zip) {
  const byNs = {};
  const ensureNs = (ns) =>
    (byNs[ns] ||= { recipes: {}, tags: {}, textures: {}, models: {}, langs: {} });

  const namespaces = new Set();
  const paths = Object.keys(zip.files).filter(p => !zip.files[p].dir);

  for (const path of paths) {
    let m;
    if ((m = path.match(RECIPE_PATH))) {
      const [, ns, id] = m;
      namespaces.add(ns);
      ensureNs(ns).recipes[id] = await zip.files[path].async('string');
    } else if ((m = path.match(TAG_PATH))) {
      const [, ns, id] = m;
      ensureNs(ns).tags[id] = await zip.files[path].async('string');
    } else if ((m = path.match(TEXTURE_PATH))) {
      const [, ns, id] = m;
      const bytes = new Uint8Array(await zip.files[path].async('arraybuffer'));
      ensureNs(ns).textures[id + '.png'] = bytesToBase64(bytes);
    } else if ((m = path.match(MODEL_PATH))) {
      const [, ns, id] = m;
      ensureNs(ns).models[id] = await zip.files[path].async('string');
    } else if ((m = path.match(LANG_PATH))) {
      const [, ns, id] = m;
      ensureNs(ns).langs[id] = await zip.files[path].async('string');
    }
  }

  const counts = { recipes: 0, tags: 0, textures: 0, models: 0, langs: 0 };
  for (const ns of Object.keys(byNs)) {
    counts.recipes += Object.keys(byNs[ns].recipes).length;
    counts.tags += Object.keys(byNs[ns].tags).length;
    counts.textures += Object.keys(byNs[ns].textures).length;
    counts.models += Object.keys(byNs[ns].models).length;
    counts.langs += Object.keys(byNs[ns].langs).length;
  }

  return {
    byNs,
    namespaces: Array.from(namespaces),
    counts
  };
}

/**
 * Uint8Array のバイナリデータを、ブラウザのスタック制限を避けて安全に base64 にエンコードします。
 * @param {Uint8Array} bytes 
 * @returns {string} base64文字列
 */
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
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
