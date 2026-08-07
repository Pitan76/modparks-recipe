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
	//#endregion
	//#region src/core/paths.ts
	/**
	* @fileoverview アセット種別の唯一の出所。
	*
	* 1つの種別は「jar のどこにあるか」「論理パスの何という根に置くか」「R2 のどのキーに落ちるか」
	* 「中身がバイナリか」「外から読ませてよいか」を同時に持ちます。これらが別々の場所に書かれて
	* いると、種別を1つ足すのに5ファイルを直すことになり、必ずどこかが取り残されます。実際
	* `items/`（1.21.4以降のアイテム定義）は読み出し側だけが知っていて、投入側が丸ごと欠けたまま
	* 動いていました。
	*
	* 種別を増やすときは、この表に1行足すだけで済むようにしてあります。
	*/
	/** data/<ns>/recipe(s)/<id>.json。1.21 以降は単数形の `recipe/`。 */
	var RECIPE_PATH = /^data\/([^/]+)\/recipes?\/(.+)\.json$/;
	/** data/<ns>/tag(s)/<種別>/<id>.json。`id` は `item/planks` のように種別を含みます。 */
	var TAG_PATH = new RegExp(`^data/([^/]+)/tags?/((?:${[
		"item",
		"items",
		"block",
		"blocks"
	].join("|")})/.+)\\.json$`);
	/**
	* 種別表。`classifyAssetPath` はこの順に当てるため、狭い規則を先に置いてください。
	*
	* `models` を `items` より先に置いているのは、両方に当たりうるパスを従来どおり `models` として
	* 扱うためです。順番を入れ替えると既存の分類が変わります。
	*/
	var ASSET_KINDS = [
		{
			kind: "recipes",
			jarPath: RECIPE_PATH,
			root: "recipe",
			rootAliases: ["recipes"],
			container: "data",
			binary: false,
			publiclyReadable: false
		},
		{
			kind: "tags",
			jarPath: TAG_PATH,
			root: "tags",
			rootAliases: [],
			container: "data",
			binary: false,
			publiclyReadable: true
		},
		{
			kind: "textures",
			jarPath: /^assets\/([^/]+)\/textures\/((?:item|block)\/.+)\.png$/,
			root: "textures",
			rootAliases: [],
			container: "assets",
			binary: true,
			publiclyReadable: true
		},
		{
			kind: "models",
			jarPath: /^assets\/([^/]+)\/models\/((?:item|block)\/.+)\.json$/,
			root: "models",
			rootAliases: [],
			container: "assets",
			binary: false,
			publiclyReadable: true
		},
		{
			kind: "items",
			jarPath: /^assets\/([^/]+)\/items\/(.+)\.json$/,
			root: "items",
			rootAliases: [],
			container: "assets",
			binary: false,
			publiclyReadable: true
		},
		{
			kind: "langs",
			jarPath: /^assets\/([^/]+)\/lang\/([a-z]{2,8}(?:_[a-z0-9]{2,8})?)\.json$/,
			root: "lang",
			rootAliases: [],
			container: "assets",
			binary: false,
			publiclyReadable: true
		}
	];
	/** 種別名から決まりごとを引く表。 */
	var BY_KIND = new Map(ASSET_KINDS.map((spec) => [spec.kind, spec]));
	new Map(ASSET_KINDS.flatMap((spec) => [spec.root, ...spec.rootAliases].map((root) => [root, spec])));
	/**
	* 種別名から決まりごとを引きます。
	* @param kind 種別名
	*/
	function assetKind(kind) {
		return BY_KIND.get(kind);
	}
	/** 種別ごとに空の器を作ります。 */
	function emptyByKind(make) {
		return Object.fromEntries(ASSET_KINDS.map((spec) => [spec.kind, make()]));
	}
	/**
	* zip 内の1パスがどの種別のアセットかを判定します。
	* @param path zip エントリの相対パス
	* @returns 該当する種別と分解結果。対象外なら null
	*/
	function classifyAssetPath(path) {
		for (const spec of ASSET_KINDS) {
			const m = path.match(spec.jarPath);
			if (m) return {
				kind: spec.kind,
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
	/**
	* 同梱 jar（JiJ）の置き場。Fabric は `META-INF/jars/`、NeoForge は `META-INF/jarjar/` を使います。
	* ライブラリの同梱が主目的ですが、複数のサブ mod を1つの jar に束ねる構成ではレシピもここに入ります。
	*/
	var NESTED_JAR = /^META-INF\/(?:jars|jarjar)\/[^/]+\.jar$/;
	/**
	* 同梱 jar を開く合計サイズの上限。
	*
	* 入れ子は呼び出し側が用意した jar の中身次第で膨らみます。ブラウザで展開する経路があるため、
	* 際限なく開かないよう頭を打っておきます。
	*/
	var NESTED_BUDGET_BYTES = 64 * 1024 * 1024;
	/** 空の集計値を作ります。 */
	function emptyCounts() {
		return emptyByKind(() => 0);
	}
	/** 空のネームスペース枠を作ります。 */
	function emptyAssets() {
		return emptyByKind(() => ({}));
	}
	/**
	* 既定の同梱 jar 読み込み口。ページに読み込まれた JSZip をそのまま使います。
	* @returns JSZip が居なければ null（入れ子は諦め、平坦な走査だけ行います）
	*/
	function globalZipLoader() {
		const zip = globalThis.JSZip;
		return zip ? (data) => zip.loadAsync(data) : null;
	}
	/**
	* 読み込み済みの JSZip インスタンスからアセットを抽出し、ネームスペース別に分けます。
	*
	* 同梱 jar（JiJ）は1段だけ開きます。入れ子は実際上1段で足り、深さに際限を設けない再帰は
	* 細工した jar への入口になるためです。
	* @param zip JSZip のインスタンス
	* @param loadZip 同梱 jar を開く読み込み口。省略時はグローバルの JSZip を使います
	*/
	async function analyzeJar(zip, loadZip = globalZipLoader()) {
		const byNs = {};
		const nested = await collectAssets(byNs, zip);
		let nestedJars = 0;
		if (loadZip) {
			let budget = NESTED_BUDGET_BYTES;
			for (const bytes of nested) {
				if (bytes.byteLength > budget) break;
				budget -= bytes.byteLength;
				const inner = await loadZip(bytes).catch(() => null);
				if (!inner) continue;
				await collectAssets(byNs, inner);
				nestedJars++;
			}
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
			counts,
			nestedJars
		};
	}
	/**
	* 1つの zip を走査し、見つけたアセットを `byNs` に積みます。
	* @param byNs 積み先。複数の jar から同じ器へ合流させます
	* @param zip 走査する zip
	* @returns 見つかった同梱 jar の中身
	*/
	async function collectAssets(byNs, zip) {
		const nested = [];
		for (const path of Object.keys(zip.files)) {
			var _hit$namespace;
			const entry = zip.files[path];
			if (entry.dir) continue;
			if (NESTED_JAR.test(path)) {
				nested.push(await entry.async("arraybuffer"));
				continue;
			}
			const hit = classifyAssetPath(path);
			if (!hit) continue;
			const bucket = (byNs[_hit$namespace = hit.namespace] || (byNs[_hit$namespace] = emptyAssets()))[hit.kind];
			if (assetKind(hit.kind).binary) {
				bucket[`${hit.id}.png`] = bytesToBase64(new Uint8Array(await entry.async("arraybuffer")));
				continue;
			}
			bucket[hit.id] = await entry.async("string");
		}
		return nested;
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
