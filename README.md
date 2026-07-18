# ModParks Recipe

ModParks用のレシピ画像を動的に生成・配信するCDN/APIサーバーです。  

## エンドポイントURL

本番環境 (Custom Domain):
**`https://recipe.modparks.pitan76.net/`**

### 画像取得API

- **静的PNG画像の取得**
  ```text
  GET /recipe/:namespace/:id.png
  ```
  例: `https://recipe.modparks.pitan76.net/recipe/minecraft/wooden_sword.png`

- **アニメーションGIF画像の取得** (タグに複数アイテムが含まれる場合など)
  ```text
  GET /recipe/:namespace/:id.gif
  ```
  例: `https://recipe.modparks.pitan76.net/recipe/minecraft/wooden_sword.gif`

- **タグの代表アイテムを指定（オフセット機能）**
  クエリパラメータ `tagOffset` を渡すことで、タグ（例えば木材など）内の特定の要素を代表画像として表示させることができます。
  ```text
  GET /recipe/:namespace/:id.png?tagOffset=2
  ```

## システムアーキテクチャ概要

本システムはCloudflareのEdgeネットワーク上で稼働し、以下の技術要素を組み合わせています：

1. **Cloudflare R2**:
   - `minecraft.jar` などから抽出したアセット（テクスチャPNG）やJSONデータ（レシピ・タグ）のマスター保存領域。
   - GitHub Actions (`npm run fetch-mc-data`) によって自動でデータが抽出・アップロードされます。

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
