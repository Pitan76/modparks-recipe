/**
* jar からレシピ・タグ・テクスチャ・モデル・言語ファイルを抜き出す共有ロジック。
*
* これは生成物です。直接編集しても次のビルドで消えます。
* 実装元: src/core/jar-assets.ts / src/core/paths.ts
*
* 使い方: JSZip を先に読み込み、展開済みのインスタンスを渡します。
*   const zip = await JSZip.loadAsync(await file.arrayBuffer());
*   const { byNs, namespaces, counts } = await analyzeJar(zip);
*/
(function() {
	//#region src/core/namespaces.ts
	/**
	* @fileoverview 共有ネームスペースの定義。
	*
	* `c` / `forge` / `neoforge` は複数の mod が同じタグを分担して定義する共通タグの置き場で、
	* `minecraft` はバニラです。いずれも特定の投稿者のものではないため、先着による所有権の確保
	* （`authorizeWrite`）の対象から外します。ここを通してしまうと、最初に該当タグを含む jar を
	* 投げた人が共通タグ全体を占有し、以降の投稿が拒否されます。
	*/
	/** 誰の所有物にもならないネームスペース。 */
	var SHARED_NAMESPACES = [
		"c",
		"forge",
		"neoforge",
		"minecraft"
	];
	/**
	* 共有ネームスペースかどうかを返します。
	* @param ns ネームスペース
	*/
	function isSharedNamespace(ns) {
		return SHARED_NAMESPACES.includes(ns);
	}
	/** 判定順に並べた規則表。先に一致したものを採用します。 */
	var RULES = [
		["recipes", /^data\/([^/]+)\/recipes?\/(.+)\.json$/],
		["tags", /^data\/([^/]+)\/tags?\/(.+)\.json$/],
		["textures", /^assets\/([^/]+)\/textures\/((?:item|block)\/.+)\.png$/],
		["models", /^assets\/([^/]+)\/models\/((?:item|block)\/.+)\.json$/],
		["langs", /^assets\/([^/]+)\/lang\/([a-z]{2,8}(?:_[a-z0-9]{2,8})?)\.json$/]
	];
	/**
	* zip 内の1パスがどの種別のアセットかを判定します。
	* @param path zip エントリの相対パス
	* @returns 該当する種別と分解結果。対象外なら null
	*/
	function classifyAssetPath(path) {
		for (const [kind, re] of RULES) {
			const m = path.match(re);
			if (m) return {
				kind,
				namespace: m[1],
				id: m[2]
			};
		}
		return null;
	}
	//#endregion
	//#region src/core/jar-assets.ts
	/**
	* @fileoverview jar（zip）からレシピ・タグ・テクスチャ・モデル・言語ファイルを抜き出します。
	*
	* 特定のフレームワークやUIライブラリに依存しない純粋な処理として実装しており、
	* ModParks（メインアプリ）側へそのまま持っていけます。JSZip の実体は呼び出し側が渡します。
	*/
	/** 空の集計値を作ります。 */
	function emptyCounts() {
		return {
			recipes: 0,
			tags: 0,
			textures: 0,
			models: 0,
			langs: 0
		};
	}
	/** 空のネームスペース枠を作ります。 */
	function emptyAssets() {
		return {
			recipes: {},
			tags: {},
			textures: {},
			models: {},
			langs: {}
		};
	}
	/**
	* 読み込み済みの JSZip インスタンスからアセットを抽出し、ネームスペース別に分けます。
	* @param zip JSZip のインスタンス
	*/
	async function analyzeJar(zip) {
		const byNs = {};
		const ensureNs = (ns) => byNs[ns] || (byNs[ns] = emptyAssets());
		for (const path of Object.keys(zip.files)) {
			const entry = zip.files[path];
			if (entry.dir) continue;
			const hit = classifyAssetPath(path);
			if (!hit) continue;
			const bucket = ensureNs(hit.namespace)[hit.kind];
			if (hit.kind === "textures") {
				bucket[`${hit.id}.png`] = bytesToBase64(new Uint8Array(await entry.async("arraybuffer")));
				continue;
			}
			bucket[hit.id] = await entry.async("string");
		}
		for (const ns of Object.keys(byNs)) if (isSharedNamespace(ns)) byNs[ns] = {
			...emptyAssets(),
			tags: byNs[ns].tags
		};
		const counts = emptyCounts();
		for (const assets of Object.values(byNs)) for (const kind of Object.keys(counts)) counts[kind] += Object.keys(assets[kind]).length;
		return {
			byNs,
			namespaces: namespacesToSend(byNs),
			counts
		};
	}
	/**
	* 投入対象のネームスペースを選びます。
	*
	* レシピかタグを持つものだけを送ります。テクスチャやモデルだけを含むネームスペース
	* （バニラ資産を差し替える同梱リソース等）まで送ると、共有側の資産を壊しかねません。
	* @param byNs ネームスペース別の抽出結果
	*/
	function namespacesToSend(byNs) {
		return Object.keys(byNs).filter((ns) => Object.keys(byNs[ns].recipes).length > 0 || Object.keys(byNs[ns].tags).length > 0);
	}
	/**
	* Uint8Array を、ブラウザのスタック制限を避けつつ base64 にエンコードします。
	* @param bytes バイナリデータ
	*/
	function bytesToBase64(bytes) {
		let binary = "";
		for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	//#endregion
	//#region src/client/extractor-global.ts
	/**
	* @fileoverview `/extractor.js` の中身。`core/jar-assets` をグローバルに生やすだけの薄い層です。
	*
	* この公開URLは ModParks 本体や外部のツールが素の script タグで読み込むための口で、
	* バンドラを持たない呼び出し側もそのまま使えるようにしてあります。
	* 実装は TS 側に一本化してあるので、ここを手で書き足さないでください。
	*/
	var g = globalThis;
	g.analyzeJar = analyzeJar;
	g.bytesToBase64 = bytesToBase64;
	//#endregion
})();
