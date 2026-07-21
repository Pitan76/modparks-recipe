# ModParks Recipe
ModParks用のレシピ画像を動的に生成・配信するCDN/APIサーバーです。  

- https://recipe.modparks.pitan76.net/

## API

- https://recipe.modparks.pitan76.net/api/

すべての画像レスポンスは `Cache-Control: public, max-age=86400`（1日）を返します。

### エンドポイント一覧

| メソッド | パス | 説明 |
| --- | --- | --- |
| `GET` | `/api/list.json` | レシピの索引（JSON）を返します。 |
| `GET` | `/api/:namespace/:id.png` | レシピ画像（PNG）を返します。 |
| `GET` | `/api/:namespace/:id.jpg` | レシピ画像（JPG）を返します。 |
| `GET` | `/api/:namespace/:id.gif` | レシピ画像（アニメーションGIF）を返します。 |
| `PUT` | `/api/:namespace/recipe/:id` | レシピJSONをアップロード（要 認証）。 |
| `PUT` | `/api/:namespace/texture/:path` | テクスチャ等をアップロード（要 認証）。 |
| `PUT` | `/api/:namespace/tag/:path` | タグJSONをアップロード（要 認証）。 |
| `POST` | `/api/:namespace/recipe/:id/bundle` | レシピ＋テクスチャを一括アップロード（要 認証）。 |
| `GET` | `/admin/reindex` | 索引を再生成します（要 `secret`）。 |
| `GET` | `/admin/clean/:namespace/:folder` | R2上の古いアセットを削除します（要 `secret`）。 |

### 画像取得API

`GET /api/:namespace/:id.(png|jpg|gif)`

- **パスパラメータ**
  - `namespace`: 名前空間（例: `minecraft`、各Mod ID）。URLに含めることで、バニラ以外のMod（アドオン）のレシピ描画にも対応します。
  - `id`: レシピID。拡張子で出力形式を指定します。

- **クエリパラメータ**

  | 名前 | 型 | 既定値 | 説明 |
  | --- | --- | --- | --- |
  | `tagOffset` | 整数 | `0` | タグ（例えば木材など）内で代表として表示する要素のインデックス。 |
  | `scale` | 数値 | — | 画像の拡大率。`normalizeScale` で正規化されます。 |

- **形式ごとの挙動**
  - **PNG**: 透過を保持した静的画像。
  - **JPG**: 透過を持てないため、背景を白で合成した画像を返します。透過が必要な場合はPNGを使用してください。
  - **GIF**: タグに複数アイテムが含まれる場合などに、5フレームのアニメーションGIFをオンザフライで生成します。

- **レスポンス**
  - `200 OK`: 画像バイナリ（`image/png` / `image/jpeg` / `image/gif`）。
  - `404 Not Found`: 拡張子が不正、または該当レシピが存在しない場合（`Recipe not found`）。

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

CI パイプラインが生成した索引（R2上の静的ファイル）をそのまま返します。クライアント側でフィルタリングするため、サーバー負荷はかかりません。`Cache-Control: public, max-age=3600`。

- **レスポンス**（`application/json`）
  ```json
  {
    "count": 1234,
    "generatedAt": "2026-01-01T00:00:00.000Z",
    "recipes": [
      { "id": "minecraft:iron_ingot_from_nuggets", "result": "minecraft:iron_ingot", "type": "crafting_shapeless" }
    ]
  }
  ```
  crafting レシピのみを含みます（`result` で結果アイテム別にグルーピング可能）。索引が未生成の場合は `{ "count": 0, "ids": [] }` を返します。

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

- **`PUT /api/:namespace/tag/:path`**
  タグJSONを `data/:namespace/tags/:path.json` に保存します（例: `item/planks`）。

- **`POST /api/:namespace/recipe/:id/bundle`**
  レシピ1つと、それが参照するテクスチャを**1リクエストで一括投入**します。テクスチャは base64。
  ```json
  {
    "recipe": { "type": "minecraft:crafting_shaped", "pattern": ["#"], "key": { "#": { "item": "mymod:gadget" } }, "result": { "id": "mymod:widget" } },
    "textures": {
      "item/gadget.png": "<base64>",
      "item/widget.png": "<base64>"
    }
  }
  ```
  レスポンス: `{ "ok": true, "id": "mymod:gadget", "recipeStored": true, "textureCount": 2 }`

## アイテムアイコンの解決仕様

レシピ画像の各スロットに描くアイコンは、`getItemImageBase64()`（[src/utils/minecraft.ts](src/utils/minecraft.ts)）が名前空間付きID `ns:path` から次の順で解決します。**最初に成功した段階を採用**します。

| # | 参照先 | 内容 |
| --- | --- | --- |
| 1 | `assets/<ns>/textures/render3d/<path>.png` | 事前レンダリング済み3D PNG。バニラは `render-blocks.ts` が生成。段階3のキャッシュ書き戻し先でもあります。 |
| 2 | `assets/<ns>/textures/item/<path>.png` | アイテムのフラットテクスチャ。アイテムは2Dで描くのが正なので、ここで確定します。 |
| 3 | モデルJSONから3D生成 | ブロック。下記「3Dブロックアイコンの生成」。 |
| 4 | `assets/<ns>/textures/block/<path>.png` | 3D生成できなかったブロックのフラットテクスチャ。 |
| 5 | モデルJSON経由のテクスチャ解決 | ファイル名がIDと異なる場合に、モデルの `textures` / `parent` を辿って実テクスチャを特定。 |
| 6 | 透明16x16 PNG | 何も見つからなかった場合。 |

### 3Dブロックアイコンの生成

段階3では、Worker上で `ns:item/<path>` → `ns:block/<path>` の順にモデルを読み、`parent` チェーンを解決してから等角投影のSVGを組み立て（[src/utils/model-parser.ts](src/utils/model-parser.ts)）、`@resvg/resvg-wasm` で64px PNGにします。オフラインの `render-blocks.ts` と同じ投影・UV・面ごとの明度計算を使うため、**バニラの事前レンダリング結果と同じ見た目**になります。

生成できた場合は `assets/<ns>/textures/render3d/<path>.png` に保存するので、2回目以降のリクエストは段階1で即ヒットします（生成コストは1ブロックにつき初回のみ）。

**必須の前提**: MODのブロックモデルはバニラの親モデルを継承します（例: `"parent": "minecraft:block/cube"`）。したがって `assets/minecraft/models/**.json` がR2に存在しないと**MODブロックの形状を解決できず、3D化は行われません**。バニラのモデルJSONは `npm run fetch-mc-data`、または後述の `upload-vanilla-models.ts` で投入します。

**設計上の約束**: 親モデルが解決できず `elements`（実形状）が得られなかった場合は、**必ず null を返して段階4のフラットテクスチャへフォールバック**します。テクスチャ一覧から代替の立方体を組み立てるような処理は行いません。実物と異なる形が描かれてしまい、2D表示より悪化するためです。

### 管理者API

いずれもクエリパラメータ `secret` が環境変数 `ADMIN_SECRET` と一致しない場合は `401 Unauthorized` を返します。

- **`GET /admin/reindex?secret=...`**
  R2上のレシピJSONを走査して索引（`index/recipes.json`）を再生成します。CIを待たずに索引をバックフィルする用途です。
  レスポンス: `{ "ok": true, "count": <件数> }`

- **`GET /admin/clean/:namespace/:folder?secret=...`**
  `assets/:namespace/textures/:folder/` 配下の古いオブジェクトをR2から削除します。
  レスポンス: `Deleted <件数> old objects from <prefix>`

- **`GET /admin/ls?secret=...&prefix=...&limit=...&cursor=...`**
  R2の中身を一覧します（読み取り専用のデバッグ用）。「アップロードしたはずのアセットが使われない」といった調査に使います。`limit` は既定200・最大1000、`cursor` でページングします。
  レスポンス: `{ "prefix": "...", "count": 10, "truncated": false, "cursor": null, "objects": [{ "key": "...", "size": 123, "uploaded": "..." }] }`
  ```bash
  curl "https://recipe.modparks.pitan76.net/admin/ls?secret=$ADMIN_SECRET&prefix=assets/mymod/"
  ```

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

# ローカルサーバー起動（D1/R2はローカルのエミュレータ＝空）
npm run dev

# ローカルサーバー起動（D1/R2は本番に直結。実データの調査・再現用）
npm run dev:remote

# Cloudflareへデプロイ
npm run deploy
```

### 本番データを見ながらデバッグする

`npm run dev:remote` は `wrangler dev --remote` で、`wrangler.toml` の `preview_bucket_name` が本番バケットを指しているため**本番のR2/D1をそのまま読みます**。「アップロードしたアセットが表示されない」類の調査はこれで再現できます。書き込みも本番に飛ぶので、参照系での利用を前提としてください。

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

## その他設計上の注意点
- Minecraft公式データそのものの直接公開は避け、あくまで「レシピ画像として合成された画像」をCDN経由で配信する設計としています。
- `namespace` をURLに含めることで、バニラ（`minecraft`）以外の別Mod（アドオン）のレシピ描画にも柔軟に対応できる設計になっています。
