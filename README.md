# ModParks Recipe
Minecraftのレシピ画像をjarのdata, assetsから動的に生成、配信するAPI、ツールです。<br />
今のところ、json形式のレシピをサポートしていない場合は生成できません。

- https://recipe.modparks.pitan76.net/

## API

- https://recipe.modparks.pitan76.net/api/

画像レスポンスの `Cache-Control` は `?v=`（アセットバージョン）の有無で変わります。`?v=` 付きは URL が内容を一意に表すため `public, max-age=31536000, immutable`、無しは `public, max-age=86400`（1日）です（詳細は「キャッシュと性能」）。

### エンドポイント一覧

| メソッド | パス | 説明 |
| --- | --- | --- |
| `GET` | `/api/list.json` | 全名前空間のレシピ索引、アセットバージョン、配信情報（`assets`）を返します。 |
| `GET` | `/api/:namespace/list.json` | 名前空間1つ分のレシピ索引を返します（`?lang=` でアイテム名を同梱）。 |
| `GET` | `/api/:namespace/:id.png` | レシピ画像（PNG）を返します。 |
| `GET` | `/api/:namespace/:id.jpg` | レシピ画像（JPG）を返します。 |
| `GET` | `/api/:namespace/:id.gif` | レシピ画像（アニメーションGIF）を返します。 |
| `PUT` | `/api/:namespace/recipe/:id` | レシピJSONをアップロード（要 認証）。 |
| `PUT` | `/api/:namespace/texture/:path` | テクスチャ等をアップロード（要 認証）。 |
| `PUT` | `/api/:namespace/model/:path` | モデルJSONをアップロード（要 認証）。 |
| `PUT` | `/api/:namespace/tag/:path` | タグJSONをアップロード（要 認証）。 |
| `PUT` | `/api/:namespace/lang/:locale` | 言語ファイル（アイテム名）をアップロード（要 認証）。 |
| `GET` | `/api/:namespace/lang.json` | 登録済みロケールの一覧を返します。 |
| `GET` | `/api/:namespace/lang/:locale.json` | 言語ファイル（翻訳キー→表示名）を返します。 |
| `GET` | `/api/names` | アイテムIDをまとめて表示名に解決します。 |
| `GET` | `/api/names.json` | 表示名の静的索引を返します。 |
| `GET` | `/api/:namespace/batch` | 複数レシピの画像を1回でまとめて返します（データURL）。 |
| `POST` | `/api/:namespace/batch` | 同上（IDが多くURLに載らない場合）。 |
| `GET` | `/api/:namespace/sprite` | 複数レシピを1枚のスプライトシートにして返します。 |
| `GET` | `/api/:namespace/asset/:path` | 生アセット（テクスチャ/モデル/タグ/言語）を返します。読み取り専用。 |
| `POST` | `/api/resolve` | 論理パスの一覧を渡し、R2上の在り処をまとめて返します。 |
| `POST` | `/api/preview` | jarを受け取りその場で画像を返します。保存も投稿枠の消費もしません（要 ログイン）。 |
| `GET` | `/api/:namespace/owner.json` | 名前空間の所有状況を返します。 |
| `POST` | `/api/:namespace/claim` | 名前空間の所有権を取得します（要 ログイン）。 |
| `GET` | `/upload` | アップロードページ。 |
| `POST` | `/api/upload` | jarを丸ごと投稿します（要 ログイン）。ブラウザ側の展開が失敗したときの経路。 |
| `GET` | `/auth/providers.json` | ログイン手段の一覧を返します。 |
| `GET` | `/auth/:provider/start` | ログインを開始します。 |
| `GET` | `/auth/:provider/callback` | ログインから戻る先。 |
| `GET` | `/auth/me` | ログイン中の利用者と残り投稿枠を返します。 |
| `GET` | `/auth/me/uploads` | 自分の投稿履歴を返します。 |
| `POST` | `/api/:namespace/recipe/:id/bundle` | レシピ＋テクスチャ＋モデルを一括アップロード（要 認証）。 |
| `POST` | `/api/:namespace/bulk` | レシピ/タグ/テクスチャ/モデルを大量一括投入（要 認証）。 |
| `POST` | `/api/:namespace/ingest/begin` | 取り込みセッションを開始（要 認証）。 |
| `POST` | `/api/:namespace/ingest/commit` | 取り込みセッションを確定（要 認証）。 |
| `POST` | `/api/:namespace/ingest/abort` | 取り込みセッションを破棄（要 認証）。 |
| `GET` | `/admin/reindex` | 索引を再生成します（要 `secret`）。 |
| `POST` | `/admin/invalidate` | 名前空間のキャッシュを無効化します（要 `secret`）。 |
| `GET` | `/admin/seed-versions` | 未設定の名前空間にアセットバージョンを付与します（要 `secret`）。 |
| `GET` | `/admin/sweep-ingests` | 放置された失効セッションを掃除します（要 `secret`）。 |
| `GET` | `/admin/clean/:namespace/:folder` | R2上の古いアセットを削除します（要 `secret`）。 |
| `GET` | `/admin/ls` | R2の中身を一覧します（読み取り専用。要 `secret`）。 |
| `GET` | `/admin/render3d/:namespace/:path` | ブロック1つを3D描画して返します（保存しない。要 `secret`）。 |
| `GET` | `/admin/purge/:namespace` | 生成済み3Dアイコンとエッジキャッシュを破棄します（要 `secret`）。 |
| `GET` | `/admin/gc-images` | 参照されなくなった世代の画像を数え、`?delete=1` で削除します（要 `secret`）。 |
| `GET` | `/admin/uploads` | 投稿履歴を照会します（要 `secret`）。 |
| `GET` | `/admin/gc/namespaces` | build を持つ名前空間を一覧します（要 `secret`）。 |
| `POST` | `/admin/gc/:namespace` | 参照されない build を掃除します（要 `secret`）。 |
| `POST` | `/admin/gc/blobs` | どの build からも参照されない blob を掃除します（要 `secret`）。 |
| `POST` | `/admin/migrate/:namespace/begin` | 従来配置から build への移行を開始します（要 `secret`）。 |
| `POST` | `/admin/migrate/:namespace/step` | 移行を1段進めます（要 `secret`）。 |
| `POST` | `/admin/migrate/:namespace/finish` | 移行を確定します（要 `secret`）。 |

### レシピ索引API

- `GET /api/list.json`
  - 全名前空間の索引（`{ count, generatedAt, versions, recipes: [{ id, result, type, tagged }] }`）。mp-recipe の検索ページが使います。アイテム名は含みません。

- `GET /api/:namespace/list.json`
  - 名前空間1つ分の索引。1つのModのページを描くのに全Modの索引を転送しないで済みます。
  - `?lang=<locale>` を付けると各エントリに完成品のアイテム名 `name` が入り、**一覧表示が1往復で完結します**（名前解決のための追加リクエストが不要）。未翻訳のアイテムにはIDがそのまま入るため、呼び出し側は `name` をそのまま表示できます。
  - レスポンス例:
    ```json
    {
      "namespace": "mymod",
      "version": "m2k9x1",
      "count": 1,
      "recipes": [
        { "id": "mymod:widget", "result": "mymod:widget", "type": "crafting_shaped", "tagged": true, "name": "ウィジェット" }
      ]
    }
    ```
  - `version` をそのまま画像URLの `?v=` に使えます（`0` は未設定を意味するので付けないでください）。
  - `assets: { base, rv }` はR2からの直接配信用です（「R2からの直接配信」を参照）。`base` が空なら無効です。
  - `tagged` は「素材が実際に切り替わる」ことを表します。タグを使っていても構成アイテムが1つなら偽です。閲覧側はこれが真のものだけ `.gif` を要求してください。静止画を GIF で配ると色数が落ち、PNG より重くなります。判定にはタグ本体の読み出しが要るため配信時に行い、結果は `cache/tagged/<rv>/...` に残して使い回します。初回だけは索引が持つ粗い値のまま返し、判定は裏で作ります。

### アイテム名API

アイテム名は jar / リソースパック由来の素の Minecraft lang JSON をそのまま `assets/<ns>/lang/<locale>.json` に保存し、テクスチャやモデルと同じアセットバージョンで無効化されます。画像と同様、`?v=` を付けると `immutable` で返ります。

対応ロケールはAPI側で固定していません。`GET /api/:namespace/lang.json` で実際に登録済みのロケールを取得できます。

- `GET /api/:namespace/lang/:locale.json`
  - 翻訳キー（`item.minecraft.stone` など）から表示名へのマップをそのまま返します。多数のアイテム名を扱う場合は1回引いて手元で解決するのが安く済みます。

- `GET /api/names?ids=<id,id,...>&lang=<locale>`
  - アイテムIDをまとめて表示名に解決します。IDはネームスペース付き（`minecraft:stone`）。省略時は `minecraft` 扱いです。
  - IDは1リクエストあたり最大500件。
  - `item.<ns>.<path>` → `block.<ns>.<path>` の順に翻訳キーを試します。
  - 未翻訳のIDはレスポンスに含まれません。ロケール間のフォールバックは行わないため、欠けたIDの扱いは呼び出し側で決められます。
  - レスポンス例: `{ "lang": "ja_jp", "names": { "minecraft:stone": "石" } }`

#### 取り込み

バニラのアイテム名は GitHub Actions で取り込みます。ワークフローは2つあります。

| ワークフロー | 使いどころ |
| --- | --- |
| `Fetch Minecraft Data` | 毎週日曜の定期実行。Minecraftデータ一式の更新に含めて取り込みます。 |
| `Upload Item Names` | 言語を追加したい・データを直したいときの単発実行。パイプライン全体を回さずに済みます。 |

どちらも Actions 画面の `Run workflow` から手動実行でき、`locales` にロケールを指定します（既定は `ja_jp,en_us`）。定期実行で取り込む言語を恒久的に増やすときは、`Fetch Minecraft Data` の `DEFAULT_LOCALES` を変更するだけです。API側はロケールを固定していないため、コード変更は要りません。

ローカルから直接叩く場合:

```
npm run upload-lang                             # バニラの ja_jp, en_us
npm run upload-lang -- ja_jp,en_us,zh_cn        # 対応言語を増やす
npm run upload-lang -- ja_jp,en_us --download-jar  # client.jar が無ければ取得する
npm run upload-lang -- ja_jp --jar mymod.jar    # Modのjarから抽出
```

バニラは出所が2つに分かれます。`en_us` は client.jar の中にしか無く、それ以外の言語は Mojang のアセットインデックスにしか無いためです。スクリプトはアセットインデックスを先に引き、そこに無かったロケールだけ `client.jar` から拾います。**`en_us` には client.jar が必要**なので、`npm run fetch-mc-data` を先に走らせるか `--download-jar` を付けてください（`Fetch Minecraft Data` では jar 取得の直後に走るため自動的に満たされます）。

Mod のアイテム名はこの操作では入りません。jar アップロード時に modparks 側の Worker が自動で取り込みます。

### 画像取得API

`GET /api/:namespace/:id.(png|jpg|gif)`

- **パスパラメータ**
  - `namespace`: 名前空間（例: `minecraft`、各Mod ID）。URLに含めることで、バニラ以外のMod（アドオン）のレシピ描画にも対応します。
  - `id`: レシピID。拡張子で出力形式を指定します。

- **クエリパラメータ**

  | 名前 | 型 | 既定値 | 説明 |
  | --- | --- | --- | --- |
  | `tagOffset` | 整数 | `0` | タグ（例えば木材など）内で代表として表示する要素のインデックス。 |
  | `scale` | 数値 | `2` | 画像サイズ指標（`0.5` 倍単位）。実サイズ = `118x56 * scale`。`scale=1`→118x56、`scale=2`→236x112（既定）、`scale=4`→472x224。`normalizeScale` で 1〜8 の整数に正規化されます。 |
  | `v` | 文字列 | なし | アセットバージョン（`list.json` の `versions` から取得）。付けると内容が不変となり `immutable` で返し、サーバ側のバージョン参照（R2往復）も省略します。省略時はサーバ側でバージョンを引くフォールバック経路になります。 |

- **形式ごとの挙動**
  - **PNG**: 透過を保持した静的画像。
  - **JPG**: 透過を持てないため、背景を白で合成した画像を返します。透過が必要な場合はPNGを使用してください。
  - **GIF**: タグに複数アイテムが含まれる場合などに、5フレームのアニメーションGIFをオンザフライで生成します。

- **レスポンス**
  - `200 OK`: 画像バイナリ（`image/png` / `image/jpeg` / `image/gif`）。
  - `404 Not Found`: 拡張子が不正、または該当レシピが存在しない場合（`Recipe not found`）。該当レシピ無しの場合は `public, max-age=300` でキャッシュし、壊れたリンクへの繰り返しアクセスで毎回 D1/R2 を叩かないようにします。

- **例**
  ```text
  GET /api/minecraft/wooden_sword.png
  GET /api/minecraft/wooden_sword.jpg
  GET /api/minecraft/wooden_sword.gif
  GET /api/minecraft/wooden_sword.png?tagOffset=2
  GET /api/minecraft/wooden_sword.png?scale=2
  ```

### 索引API

`GET /api/list.json`

R2上の索引（`index/recipes.json`）に、名前空間ごとのアセットバージョン `versions` を同梱して返します。索引とバージョンは並列に読むため追加の遅延はありません。クライアント側でフィルタリングするため、サーバー負荷はかかりません。`Cache-Control: public, max-age=60`（`versions` が変わると画像URLも変わるため短め。クライアントの再取得間隔と歩調を合わせます）。

- **レスポンス**（`application/json`）
  ```json
  {
    "count": 1234,
    "generatedAt": "2026-01-01T00:00:00.000Z",
    "versions": { "minecraft": "m9x2k1", "mymod": "m9x3p0" },
    "recipes": [
      { "id": "minecraft:iron_ingot_from_nuggets", "result": "minecraft:iron_ingot", "type": "crafting_shapeless" }
    ]
  }
  ```
  crafting レシピのみを含みます（`result` で結果アイテム別にグルーピング可能）。クライアントは各画像URLに `?v=versions[namespace]` を付けることで、画像1枚ごとのバージョン参照（R2往復）を消せます。索引が未生成の場合は `{ "count": 0, "versions": {}, "recipes": [] }` を返します。

### 書き込みAPI（Mod向け）

Modが自分のレシピ・テクスチャを直接R2へ投入するためのAPIです。バニラのjarパイプラインに依存せず、**本体側のCIから叩く**ことも想定しています。

- **認証**: `Authorization: Bearer <secret>` ヘッダ、または `?secret=<secret>`。`UPLOAD_SECRET` と `ADMIN_SECRET` の**いずれか**に一致すれば通ります。どちらも一致しない場合は `401`。
- **3Dアイコン**: ブロックは、モデルJSONを上げておけば**Worker側が自動で3Dアイソメトリック画像を生成**します。事前レンダリングは不要です（詳細は「アイテムアイコンの解決仕様」）。

- **`PUT /api/:namespace/recipe/:id`**
  レシピJSON（ボディ）を `data/:namespace/recipe/:id.json` に保存し、D1キャッシュ破棄・索引更新まで行います。
  ```bash
  curl -X PUT "https://recipe.modparks.pitan76.net/api/mymod/recipe/gadget" \
    -H "Authorization: Bearer $UPLOAD_SECRET" \
    -H "Content-Type: application/json" \
    --data @gadget_recipe.json
  ```

- **`PUT /api/:namespace/texture/:path`**
  `assets/:namespace/textures/:path` にバイナリ保存します（例: `item/gadget.png`、`block/foo.png`、`render3d/foo.png`）。
  ```bash
  curl -X PUT "https://recipe.modparks.pitan76.net/api/mymod/texture/item/gadget.png" \
    -H "Authorization: Bearer $UPLOAD_SECRET" \
    --data-binary @gadget.png
  ```

- **`PUT /api/:namespace/model/:path`**
  モデルJSONを `assets/:namespace/models/:path.json` に保存します（例: `item/gadget`、`block/machine`）。テクスチャのファイル名がIDと異なるアイテムの解決や、ブロックの3D生成に使われます。

- **`PUT /api/:namespace/tag/:path`**
  タグJSONを `data/:namespace/tags/:path.json` に保存します（例: `item/planks`）。

- **`PUT /api/:namespace/lang/:locale`**
  言語ファイル（アイテム名）を `assets/:namespace/lang/:locale.json` に保存します（例: `ja_jp`）。ボディは素の Minecraft lang JSON。ロケールを固定していないため、新しい言語は投入するだけで増やせます。

- **`POST /api/:namespace/recipe/:id/bundle`**
  レシピ1つと、それが参照するテクスチャ（およびオプションでモデル）を**1リクエストで一括投入**します。テクスチャは base64。
  ```json
  {
    "recipe": { "type": "minecraft:crafting_shaped", "pattern": ["#"], "key": { "#": { "item": "mymod:gadget" } }, "result": { "id": "mymod:widget" } },
    "textures": {
      "item/gadget.png": "<base64>",
      "item/widget.png": "<base64>"
    },
    "models": { "item/gadget": { "parent": "item/generated", "textures": { "layer0": "mymod:item/gadget" } } }
  }
  ```
  レスポンス: `{ "ok": true, "id": "mymod:gadget", "recipeStored": true, "textureCount": 2, "modelCount": 1 }`

- **`POST /api/:namespace/bulk`**
  レシピ/タグ/テクスチャ/モデル/言語ファイルを**まとめて投入**します。1ファイル1リクエストにするとサブリクエスト上限に達するため、抽出側は数回の bulk に分けて送ります。すべてオプションです。テクスチャは base64。
  ```json
  {
    "recipes":  { "<id>": <json|string>, ... },
    "tags":     { "<path>": <json|string>, ... },
    "textures": { "<path>.png": "<base64>", ... },
    "models":   { "<path>": <json|string>, ... },
    "langs":    { "<locale>": <json|string>, ... }
  }
  ```
  `?session=<id>` を付けると取り込みセッションの一部として扱われ（下記）、インデックス更新とバージョン更新を commit まで遅延します。付けない場合は従来どおり毎回インデックス更新＋バージョン更新を行います。

### 取り込みセッション（分割投入の一括確定）

1 mod の投入は数十回の bulk に分割されます。分割の途中で「レシピはあるがテクスチャが未着」の状態が公開されると、透明アイコンのままレンダリングされてキャッシュに焼き付きます。またバージョン更新が投入のたびに走ると、投入中ずっとキャッシュが定着しません。取り込みセッションは分割送信を**1つの論理トランザクション**として扱い、これらを防ぎます。

- **`POST /api/:namespace/ingest/begin`** → `{ "ok": true, "session": "<uuid>" }`
  セッションを開始します。
- **`POST /api/:namespace/bulk?session=<id>`**
  セッション中の bulk はインデックスを触らず、追加分をステージングします（バージョンも更新しません）。
- **`POST /api/:namespace/ingest/commit?session=<id>`** → `{ "ok": true, "committed": <件数> }`
  ステージング分を**1回でインデックスへマージ**し、バージョンを**1回だけ**更新します。ここで初めて公開状態が切り替わります。
- **`POST /api/:namespace/ingest/abort?session=<id>`** → `{ "ok": true, "aborted": true }`
  ステージングを破棄します。インデックスもバージョンも変更しません。

送出順は「依存される側（テクスチャ→モデル→タグ→レシピ）」で送ります。存在しない/失効したセッションへの bulk・commit は `409` を返します。失効セッションは30分でクリーンアップ対象になり、`/admin/sweep-ingests` で掃除できます。

## アップロード（`/upload`）

Mod 作者が jar を投げてレシピを取り込むためのページです。ログインすると1日あたりの投稿枠が与えられ、
残りは `/auth/me` が返します。枠は ModParks 側の Mod 作者に優先して回すため、こちらは少なめです
（[src/utils/auth/quota.ts](src/utils/auth/quota.ts) の `DAILY_UPLOAD_LIMIT`）。

枠を数えるのは `POST /api/:namespace/bulk` です。ポータルは jar をブラウザ側で展開して bulk へ直接
送るため、jar を丸ごと受ける `POST /api/upload`（展開に失敗したときの退避経路）だけで数えると素通り
します。共有名前空間（`c` など）への書き込みは投稿者の持ち物ではないので数えません。

### プレビュー（保存しない描画）

jar を選ぶと、**アップロードせずに**画像だけを作れます。投稿枠は消費しません。経路は2つあります。

- **この端末で描く**（既定・ログイン不要）
  ブラウザが jar を展開し、`generateRecipeSvg()` をそのまま呼びます。レシピのSVGは文字列として
  組み立てられるため、ラスタライザ（wasm）は要りません。手元に無い素材（`minecraft:` のテクスチャや
  モデル、`c:` のタグ）は `POST /api/resolve` で在り処をまとめて聞き、R2 から直接取ります。
  素材の依存は多段（タグ→アイテム→テクスチャ、モデル→親モデル→テクスチャ）なので、
  新しい不足が出なくなるまで「描いて集めて取る」を繰り返します。
  素材が揃わなかったレシピは**出力しません**。欠けた絵は、無いことより分かりにくい間違いになるためです。
- **サーバーで描く**（`POST /api/preview`、要ログイン）
  jar を送ってその場で描き、画像を返します。R2 にもインデックスにも何も書きません。
  保存しない描画が既存のキャッシュを汚さないよう、解決済みアイコンを永続化せず
  （`AssetReader.persistIcons = false`）、アイコンのメモもリクエストごとに別世代にします。

どちらも結果を PNG / GIF の zip でまとめて保存できます。端末で描いた場合は変換も zip 化もその場で
行うため、通信は発生しません。

## アイテムアイコンの解決仕様

レシピ画像の各スロットに描くアイコンは、`getItemImageBase64()`（[src/utils/minecraft/texture.ts](src/utils/minecraft/texture.ts)）が名前空間付きID `ns:path` から次の順で解決します。**最初に成功した段階を採用**します。

読み出し先は `AssetReader`（[src/core/asset-reader.ts](src/core/asset-reader.ts)）に抽象化されています。Worker は R2 と build マニフェストから読み、ブラウザは手元の jar と `/api/resolve` から読みます。描画そのものは同じコードです。

| # | 参照先 | 内容 |
| --- | --- | --- |
| 1 | `assets/<ns>/textures/render3d/<path>.png` | 事前レンダリング済み3D PNG。バニラは `render-blocks.ts` が生成。段階3のキャッシュ書き戻し先でもあります。 |
| 2 | `assets/<ns>/textures/item/<path>.png` | アイテムのフラットテクスチャ。アイテムは2Dで描くのが正なので、ここで確定します。 |
| 3 | モデルJSONから3D生成 | ブロック。下記「3Dブロックアイコンの生成」。 |
| 4 | `assets/<ns>/textures/block/<path>.png` | 3D生成できなかったブロックのフラットテクスチャ。 |
| 5 | モデルJSON経由のテクスチャ解決 | ファイル名がIDと異なる場合に、モデルの `textures` / `parent` を辿って実テクスチャを特定。 |
| 6 | 透明16x16 PNG | 何も見つからなかった場合。 |

### 3Dブロックアイコンの生成

段階3では、Worker上で `ns:item/<path>` → `ns:block/<path>` の順にモデルを読み、`parent` チェーンを解決してから等角投影のSVGを組み立て（[src/utils/model-parser.ts](src/utils/model-parser.ts)）、`@resvg/resvg-wasm` で128px PNGにします（`block-icon.ts` の `ICON_SIZE` と `render-blocks/render.ts` の `SIZE` が同値）。オフラインの `render-blocks.ts` と同じ投影・UV・面ごとの明度計算を使うため、**バニラの事前レンダリング結果と同じ見た目**になります。

生成できた場合は `assets/<ns>/textures/render3d/<path>.png` に保存するので、2回目以降のリクエストは段階1で即ヒットします（生成コストは1ブロックにつき初回のみ）。

**バニラとの意図的な差異**: 松明のように、ゲーム内ではインベントリで2Dスプライトとして描かれるブロック（item モデルが `item/generated`）も、**block モデルがあれば3Dで描きます**。レシピ画像はブロックの描画を揃えたほうが読みやすいためです。棒や剣のような純粋なアイテムは block モデルを持たないので、従来どおりフラットテクスチャになります。

**必須の前提**: MODのブロックモデルはバニラの親モデルを継承します（例: `"parent": "minecraft:block/cube"`）。したがって `assets/minecraft/models/**.json` がR2に存在しないと**MODブロックの形状を解決できず、3D化は行われません**。バニラのモデルJSONは `npm run fetch-mc-data`、または後述の `upload-vanilla-models.ts` で投入します。

**設計上の約束**: 親モデルが解決できず `elements`（実形状）が得られなかった場合は、**必ず null を返して段階4のフラットテクスチャへフォールバック**します。テクスチャ一覧から代替の立方体を組み立てるような処理は行いません。実物と異なる形が描かれてしまい、2D表示より悪化するためです。

**ブロックエンティティ**: チェストと頭部（スケルトン/ウィザースケルトン/ゾンビ/クリーパー/ピグリン/プレイヤー）は `builtin/entity` に解決されてエレメントを持たず、絵もエンティティ用テクスチャの中にあります。そのままでは何も見つからず空きスロットになるため、箱モデルとUVを合成しています（[src/core/chest.ts](src/core/chest.ts) / [src/core/skull.ts](src/core/skull.ts)、展開規則は [src/core/entity-box.ts](src/core/entity-box.ts) で共通）。ドラゴンの頭は単純な箱ではないため対象外です。

**未対応**: 時計やコンパスのように状態で絵が変わるアイテムは、通常のパスにテクスチャが無いため解決できません（透明になります）。

### 管理者API

いずれもクエリパラメータ `secret` が環境変数 `ADMIN_SECRET` と一致しない場合は `401 Unauthorized` を返します。

- **`GET /admin/reindex?secret=...`**
  R2上のレシピJSONを走査して索引（`index/recipes.json`）を再生成します。CIを待たずに索引をバックフィルする用途です。各レシピ本文を読み、`{ id, result, type }` の `recipes` 形式で書き出します（crafting 系のみ）。
  レスポンス: `{ "ok": true, "count": <採用件数>, "scanned": <走査件数> }`

- **`POST /admin/invalidate?secret=...`**（ボディに JSON）
  名前空間のアセットバージョンを上げ、その名前空間のレンダリング済み画像・アイコン（L1/L2）とクライアントの `?v=` を一斉に切り替えます。L1 は世代キー方式のため古いオブジェクトは参照されなくなり、lifecycle ルールで自然に消えます。
  ```jsonc
  { "namespace": "minecraft" }  // 単一名前空間
  { "all": true }               // 既知の全名前空間（レンダラー変更の手動反映など）
  ```
  レスポンス: `{ "ok": true, "invalidated": ["minecraft"] }`。個別レシピ単位の無効化はフィンガープリントを持たないため未対応（名前空間単位のみ）。

- **`GET /admin/seed-versions?secret=...`**
  索引に載る名前空間のうち、まだアセットバージョンを持たないものに初期値を付与します。バージョンが無いとクライアントが `?v=` を付けられず、画像ごとにサーバ側のバージョン参照が残るため、導入時に一度だけ実行します。索引は読むだけで書き換えません。
  レスポンス: `{ "ok": true, "namespaces": [...], "seeded": <件数> }`

- **`GET /admin/sweep-ingests?secret=...`**
  commit/abort されずに放置された、失効済みの取り込みセッションのステージングを一掃します。
  レスポンス: `{ "ok": true, "swept": <件数> }`

- **`GET /admin/clean/:namespace/:folder?secret=...`**
  `assets/:namespace/textures/:folder/` 配下の古いオブジェクトをR2から削除します。
  レスポンス: `Deleted <件数> old objects from <prefix>`

- **`GET /admin/render3d/:namespace/:path?secret=...`**
  ブロック1つを段階3の3D経路で描画して返します。`render3d/` の既存キャッシュを**バイパス**し、結果を**R2へ書き戻しません**。アイコンの見た目確認や、レンダラ変更前後の比較・性能計測に使います。`?format=svg` でラスタライズ前のSVG（ジオメトリ確認用）。描画できないブロックは `404`。
  ```bash
  curl -o stone.png "http://localhost:8787/admin/render3d/minecraft/stone?secret=$ADMIN_SECRET"
  ```

- **`GET /admin/purge/:namespace?secret=...`**
  その名前空間の生成済み3Dアイコン（`render3d/`）とエッジキャッシュを破棄します。レンダラを変更した後や、アイコンが古い・壊れている場合に使います。どちらも次のリクエストで自動再生成されます。

- **`GET /admin/ls?secret=...&prefix=...&limit=...&cursor=...`**
  R2の中身を一覧します（読み取り専用のデバッグ用）。「アップロードしたはずのアセットが使われない」といった調査に使います。`limit` は既定200・最大1000、`cursor` でページングします。
  レスポンス: `{ "prefix": "...", "count": 10, "truncated": false, "cursor": null, "objects": [{ "key": "...", "size": 123, "uploaded": "..." }] }`
  ```bash
  curl "https://recipe.modparks.pitan76.net/admin/ls?secret=$ADMIN_SECRET&prefix=assets/mymod/"
  ```

## キャッシュと性能

レシピ画像1枚の生成は、素材ごとのR2読み取りとラスタライズを伴うため素では重い処理です。次の多段構えで、同じ画像・同じアイコンを2度作らないようにしています。上の段ほど手前・高速です。

| 段 | 対象 | 効果 |
| --- | --- | --- |
| L3 | **ブラウザキャッシュ** | `?v=` 付きURLは `immutable` で返すため、再訪時はネットワークに出ません。 |
| L2 | **エッジキャッシュ**（Cache API） | 同一URLの再リクエストは再生成せずキャッシュから返します。`?v=` 付きは `max-age=31536000, immutable`、無しは `max-age=86400`。PoPローカルで容量圧迫時に追い出されます。 |
| L1 | **R2永続キャッシュ** | レンダリング済み画像（`cache/img/...`）と解決済みアイコン（`cache/icon/...`）をR2に保存します。PoPを跨ぐL2ミスでも、フルレンダリングではなくR2 GET 1回で返せます。キーにレンダラー版とアセットバージョンを含むため、更新時は別キーになり古い物は参照されなくなります（削除不要）。 |
| L0 | **アイソレート内アイコンメモ** | 解決済みアイコンをアイソレート内で共有します（[src/utils/icon-memo.ts](src/utils/icon-memo.ts)、上限3000件のLRU）。同一アイテムが多数のレシピ・スロットで使い回されるため効きます。解決失敗（透明フォールバック）も記録し、失敗時の多段プローブの再実行を防ぎます。 |
| — | **`render3d/` への保存** | 3Dブロックアイコンは初回生成時にR2へ保存され、以降は解決順の段階1で即ヒットします。 |
| — | **リクエスト内メモ化＋並列化** | 9スロット＋結果を並列に解決します。 |
| — | **モデル／テクスチャのメモ化** | 3D生成が読むモデルJSONとテクスチャを、isolate内でアセットバージョン単位にキャッシュします（[src/utils/block-icon.ts](src/utils/block-icon.ts)）。 |

L0/L1 のアイコンキャッシュがなぜ効くか: アイテムは数千種なのに対しレシピは数万件あり、同じアイコンが極端に使い回されます。1アイコンの解決は最大5段の直列R2プローブ（失敗時1秒超）を伴うため、これを畳み込む効果が大きいです。**解決失敗（透明アイコン）はL1に永続化しません** — テクスチャ未着の投入中に透明を固定してしまうのを防ぐためです（L0には短命に記録）。

**レンダラー版**（`RENDERER_VERSION`、[src/utils/render-version.ts](src/utils/render-version.ts)）はL1キーに含まれます。実際にキーへ載る `rv` は、これに共有名前空間（`c` / `forge` / `neoforge` / `minecraft`）のアセットバージョンの指紋を足したものです。1枚の画像は自分の名前空間だけで完結せず、共通タグを辿って素材を決めるため、共有側の更新が依存する画像へ伝わる必要があります。レンダリング系コードを変えたら値を上げると、過去のL1が自動的に参照されなくなります。環境変数 `RENDERER_VERSION` が設定されていればそれを優先します（CIがソースのハッシュを注入する運用に対応）。

**L1のゴミ掃除**: `rv`/バージョンが変わると古い `cache/` オブジェクトは参照されなくなりますが残ります。`GET /admin/gc-images?secret=...` で世代別の件数を数え、`&delete=1` を付けると現行世代以外を削除します（ModParks の管理画面からも実行できます）。R2 の lifecycle rule で `cache/` プレフィックスに期限を設定しておくのも有効です（wrangler.toml では設定できず、ダッシュボード操作が必要）。

### R2からの直接配信

L1（`cache/img/...`）にレンダリング済みの画像があるなら、Workerは「R2から読んで返すだけ」です。
これによってR2の公開ドメインを直接叩けば丸ごと不要になり、その画像分のWorker実行が消えます。

有効化の手順:

1. Cloudflareダッシュボードで `mp-recipe-images` バケットに Custom Domain を割り当てます（R2 > バケット > Settings > Public access）。
2. `wrangler.toml` の `PUBLIC_IMAGE_BASE` にそのURLを設定してデプロイします。未設定なら直接配信は無効のままです。

`/api/list.json` と `/api/:namespace/list.json` は `assets: { base, rv }` を返します。クライアントは
`base` と `rv`、索引の `version` からキーを組み立てて直接取得できます:

```
<base>/cache/img/<rv>/<namespace>/<version>/<id>@<scale>+<tagOffset>.<ext>
```

`scale` の既定は2、`tagOffset` の既定は0です。**未レンダリングの画像は404になります**。呼び出し側は
404のときだけ `/api/:namespace/:id.<ext>?v=<version>` へフォールバックしてください。Workerが生成して
L1へ保存するため、以降は直接配信でヒットします（検索ページは `<img>` の `onerror` でこれを行います）。

`version` が無い（`0`）ネームスペースはサーバ側がバージョンを引くため、キーを外から組めません。この場合は
従来どおりWorker経由になります。

注意: Custom Domainはバケット全体を公開読み取りにします（キー指定のGETのみで、一覧はできません）。
このバケットの中身はいずれもAPIから公開しているアセットですが、秘匿したい物を置かない前提は守ってください。

### キャッシュ破棄（アセットバージョン）

各名前空間の**アセットバージョン**は `meta/versions.json`（全名前空間を集約した単一オブジェクト）にR2保存されます。`/api/list.json` がこれを `versions` として配り、クライアントは画像URLに `?v=<version>` を載せます。バージョンが変われば画像URLも変わり、以前のキャッシュ（L1/L2/L3すべて）は参照されなくなります。

バージョンが上がる契機:

- **書き込みAPI**（`?session=` なしの単発 recipe/texture/model/tag、および `bulk`）— その名前空間を更新
- **取り込みセッションの commit** — 分割投入の最後に1回だけ
- **`POST /admin/invalidate`** — 手動（レンダラー変更の反映など）

個別の `cache.delete()` ではなくキーにバージョンを混ぜているのは、テクスチャ1枚の差し替えが**どのレシピ画像に影響するか特定できない**うえ、1つの画像に `?scale=` `?tagOffset=` のクエリ違いで**複数のキャッシュエントリ**が存在するためです。

`?v=` 付きリクエストはサーバ側のバージョン参照（R2往復）を行いません。`?v=` 無しのフォールバック経路ではサーバがバージョンを引き（isolate内で10秒メモ化）、キャッシュキーに `__v=<version>` として混ぜます。**`list.json` は最大60秒キャッシュされるため、アップロードの反映はクライアント側で最大60秒遅れます。**

## システムアーキテクチャ概要

本システムはCloudflareのEdgeネットワーク上で稼働し、以下の技術要素を組み合わせています：

1. **Cloudflare R2**:
   - `minecraft.jar` などから抽出したアセット（テクスチャPNG）やJSONデータ（レシピ・タグ）のマスター保存領域。
   - GitHub Actions（[.github/workflows/fetch-mc-data.yml](.github/workflows/fetch-mc-data.yml)）が週次で以下を実行します:
     1. `npm run fetch-mc-data` — 最新版クライアントjarをDLし、レシピ/タグJSON、item/blockテクスチャ、**モデルJSON（`assets/minecraft/models/**.json`）**をR2へアップロード（in-jarパスを保持）。同時に crafting レシピの索引 `index/recipes.json` も生成。モデルJSONはMODブロックの親モデル解決に必須です。
     2. `render-blocks.ts` — jarから3DブロックPNGを等角投影でレンダリングし、`assets/<ns>/textures/render3d/` へ直接アップロード（S3クライアントで並列）。
   - CIに必要なSecrets: `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`（R2のS3互換キー）。
   - **Modのアセット/レシピ**はこのバニラパイプラインには含まれません。書き込みAPI（上記）で投入します。Modブロックの3Dアイコンは事前レンダリング不要で、Worker側が初回リクエスト時に生成します。
   - Workerのデプロイ（`npm run deploy`）はコード変更時に手動で行います（データ更新では不要）。

2. **Cloudflare D1**:
   - R2上のJSONファイルは読み込みコストがかかるため、一度アクセスされたレシピやタグの情報はD1データベースに Lazy Cache（遅延保存） されます。

3. **Cloudflare Workers (Hono)**:
   - Satori と `@resvg/resvg-wasm` を用いて、MinecraftのクラフトグリッドUI（3x3、矢印、出力枠）を動的にSVG化し、PNGにエンコードして返却します。JPGは `jpeg-js`、GIFは `omggif` で生成します。
   - `chest` などのブロックエンティティは、`render-blocks.ts` がエンティティアトラス（`entity/chest/*.png`）からボックスモデルを合成してレンダリングします。
   - Workerシークレット: `ADMIN_SECRET`（管理者API用）、`UPLOAD_SECRET`（書き込みAPI用。未設定時は `ADMIN_SECRET` にフォールバック）。`npx wrangler secret put <NAME>` で設定します。

## 開発・セットアップ

```bash
# 依存関係のインストール
npm install

# R2にMinecraft公式アセットを抽出・アップロード（要 .env 設定）
npm run fetch-mc-data

# ローダーが定義するタグ（c: と neoforge:）の基盤データを投入
# （要 MP_RECIPE_URL と UPLOAD_SECRET。書き込みAPI経由なので build へ正しく載ります）
npm run fetch-common-tags

# 既存の索引に tagged を埋める（1回だけ。無くても配信時に補われます）
npm run backfill-tagged

# ローカルサーバー起動（D1/R2はローカルのエミュレータ＝空）
npm run dev

# ローカルサーバー起動（D1/R2は本番に直結。実データの調査・再現用）
npm run dev:remote

# Cloudflareへデプロイ
npm run deploy
```

`npm run deploy` は先にクライアントのバンドルを作ります。**ビルドが失敗した状態でデプロイしないでください。**
出力先は毎回空にしてから作り直すため、失敗すると `public/app` が空のまま、
[src/generated/client-bundles.ts](src/generated/client-bundles.ts) だけが古いファイル名を指し、
ページが真っ白になります。`R2_DRY_RUN=1` を付けると、R2 を使うスクリプトは書き込まず内容だけ表示します。

### 本番データを見ながらデバッグする

`npm run dev:remote` は `wrangler dev --remote` で、`wrangler.toml` の `preview_bucket_name` が本番バケットを指しているため**本番のR2/D1をそのまま読みます**。「アップロードしたアセットが表示されない」類の調査はこれで再現できます。書き込みも本番に飛ぶので、参照系での利用を前提としてください。

`--remote` では**Worker自体がCloudflare上で実行されます**（起動ログの `Starting remote preview`）。ローカルマシンからは各R2アクセスではなくHTTPリクエスト1往復ぶんしか回線を渡らないので、遅さを感じた場合はネットワーク距離ではなく**Worker内の処理回数**を疑ってください。切り分けには `/admin/render3d/` が使えます（R2に書き戻さないので何度でも叩けます）。

シークレットはローカルには降りてこないため、`.dev.vars`（gitignore済み）に置きます:

```
ADMIN_SECRET="localdebug"
UPLOAD_SECRET="localdebug"
```

```bash
npm run dev:remote                                            # → http://localhost:8787
curl "http://localhost:8787/admin/ls?secret=localdebug&prefix=assets/mymod/"
```

### バニラのモデルJSONを投入する

MODブロックの3D化には `assets/minecraft/models/**.json` が必要です（前述）。R2のS3認証情報が無くても、書き込みAPI経由で投入できます:

```bash
npx tsx src/scripts/upload-vanilla-models.ts http://localhost:8787
# 本番へ直接入れる場合:
#   UPLOAD_SECRET=... npx tsx src/scripts/upload-vanilla-models.ts https://recipe.modparks.pitan76.net
```

client.jar がなければ自動でダウンロードします。約3900件を150件ずつバルクAPIへ送るため、完了まで数分〜十数分かかります。

### スロット配置をローカルで即確認する

入力スロットと出力スロットのアイテム描画位置がズレて見えるときの切り分け用スクリプトです。R2 / wasm 初期化に依存せず、`client.jar` から実ブロックをレンダリング（＝本番と同じ画像）し、本番と同じ背景・同じ `iconSvg`・同じレイアウト定数（`src/utils/image-generator/layout.ts`）で SVG を組み立てて PNG 化します。

同じアイテム画像を「入力スロット(0)」と「出力スロット」の両方に置き、各スロット内でアイテムが実際にどこから描画されているかをピクセル単位で計測して表示します。**入力基準の出力ズレが (0,0) なら、スロット処理は入力・出力で完全一致**（見た目のズレは画像の中身＝ブロックレンダ自身の非対称な余白が原因）と判断できます。

```bash
npx tsx src/scripts/preview-slots.ts [modelId] [scale]
# 例:
npx tsx src/scripts/preview-slots.ts block/crafting_table       # scale 既定=1
npx tsx src/scripts/preview-slots.ts block/furnace 2            # さらに2倍に拡大
```

- **座標系の注意**: キャンバス `236x112` はすでにネイティブ UI `118x56` の2倍です。座標定数（`OUT_X=194` など）はこの 236 空間の値。`scale` 引数はさらにその上に掛かる倍率なので、**既定 1 = 座標をそのまま確認できる 236x112**。拡大したいときだけ 2,3… を指定します。
- 出力 PNG: `preview/slots-<modelId>@<scale>x.png`（プロジェクト内 `preview/` フォルダ）
- 標準出力に、入力/出力スロットの枠内オフセットと「入力基準の出力ズレ」を表示します。

## その他設計上の注意点
- Minecraft公式データそのものの直接公開は避け、あくまで「レシピ画像として合成された画像」をCDN経由で配信する設計としています。
- `namespace` をURLに含めることで、バニラ（`minecraft`）以外の別Mod（アドオン）のレシピ描画にも柔軟に対応できる設計になっています。
