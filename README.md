# ModParks Recipe
ModParks用のレシピ画像を動的に生成・配信するCDN/APIサーバーです。  

- https://recipe.modparks.pitan76.net/

## エンドポイントURL
- https://recipe.modparks.pitan76.net/api/

### 画像取得API

- **静的画像の取得（PNG / JPG）**
  ```text
  GET /api/:namespace/:id.png
  GET /api/:namespace/:id.jpg
  ```
  例: `https://recipe.modparks.pitan76.net/api/minecraft/wooden_sword.png`

  > JPGは透過を持てないため、背景を白で合成した画像を返します。透過が必要な場合はPNGを使用してください。

- **アニメーションGIF画像の取得** (タグに複数アイテムが含まれる場合など)
  ```text
  GET /api/:namespace/:id.gif
  ```
  例: `https://recipe.modparks.pitan76.net/api/minecraft/wooden_sword.gif`

- **タグの代表アイテムを指定（オフセット機能）**
  クエリパラメータ `tagOffset` を渡すことで、タグ（例えば木材など）内の特定の要素を代表画像として表示させることができます。
  ```text
  GET /api/:namespace/:id.png?tagOffset=2
  ```

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
