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
    "ids": ["minecraft:wooden_sword", "minecraft:iron_ingot"]
  }
  ```
  索引が未生成の場合は `{ "count": 0, "ids": [] }` を返します。

### 管理者API

いずれもクエリパラメータ `secret` が環境変数 `ADMIN_SECRET` と一致しない場合は `401 Unauthorized` を返します。

- **`GET /admin/reindex?secret=...`**
  R2上のレシピJSONを走査して索引（`index/recipes.json`）を再生成します。CIを待たずに索引をバックフィルする用途です。
  レスポンス: `{ "ok": true, "count": <件数> }`

- **`GET /admin/clean/:namespace/:folder?secret=...`**
  `assets/:namespace/textures/:folder/` 配下の古いオブジェクトをR2から削除します。
  レスポンス: `Deleted <件数> old objects from <prefix>`

## システムアーキテクチャ概要

本システムはCloudflareのEdgeネットワーク上で稼働し、以下の技術要素を組み合わせています：

1. **Cloudflare R2**:
   - `minecraft.jar` などから抽出したアセット（テクスチャPNG）やJSONデータ（レシピ・タグ）のマスター保存領域。
   - GitHub Actions（[.github/workflows/fetch-mc-data.yml](.github/workflows/fetch-mc-data.yml)）が週次で以下を実行します:
     1. `npm run fetch-mc-data` — 最新版クライアントjarをDLし、レシピ/タグJSONとitem/blockテクスチャをR2へアップロード（in-jarパスを保持）。
     2. `render-blocks.ts` — jarから3DブロックPNGを等角投影でレンダリング。
     3. `upload-pngs-wrangler.sh` — 3DPNGを `assets/<ns>/textures/render3d/` へアップロード。
   - 必要なSecrets: `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`（S3互換アップロード用）、`CLOUDFLARE_API_TOKEN`（wrangler経由のPNGアップロード用）。
   - Workerのデプロイ（`npm run deploy`）はコード変更時に手動で行います（データ更新では不要）。

2. **Cloudflare D1**:
   - R2上のJSONファイルは読み込みコストがかかるため、一度アクセスされたレシピやタグの情報はD1データベースに Lazy Cache（遅延保存） されます。

3. **Cloudflare Workers (Hono)**:
   - Satori と `@resvg/resvg-wasm` を用いて、MinecraftのクラフトグリッドUI（3x3、矢印、出力枠）を動的にSVG化し、PNGにエンコードして返却します。
   - `omggif` を用いて、複数のPNGフレームからアニメーションGIFをオンザフライで生成します。

## 開発・セットアップ

```bash
# 依存関係のインストール
npm install

# R2にMinecraft公式アセットを抽出・アップロード（要 .env 設定）
npm run fetch-mc-data

# ローカルサーバー起動
npm run dev

# Cloudflareへデプロイ
npm run deploy
```

## その他設計上の注意点
- Minecraft公式データそのものの直接公開は避け、あくまで「レシピ画像として合成された画像」をCDN経由で配信する設計としています。
- `namespace` をURLに含めることで、バニラ（`minecraft`）以外の別Mod（アドオン）のレシピ描画にも柔軟に対応できる設計になっています。
