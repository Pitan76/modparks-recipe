# ModParks Recipe
ModParks用のレシピを管理するAPI、CDN？、本体のリソースを減らすためにここに管理のJSを分散<br />
jarを受け取るのとレシピ単体画像両方受け付ける。
jarそのものからレシピを組み立てて画像にしておく
modidごとに保管する (重複があればauthorのprefixをつけだす)

# ModParks Recipe 構築プラン

本体 (ModParks) のリソース負荷を軽減し、レシピ管理用APIおよびJSのCDN配信サーバーとして機能する `mp-recipe` の立ち上げプランです。

## 概要と目的
- **役割**: レシピ管理API、およびフロントエンドへ配信する分離されたJavaScriptリソースのホスティング・CDN。
- **目的**: 本体 (Next.js) から重い処理（レシピのパース、画像生成、あるいは専用UIコンポーネントのJS）を切り離し、パフォーマンスを向上させる。

## Open Questions

**1. 使用するフレームワークについて**
Cloudflare環境（本体がCloudflare上で動いているため）と相性が良く、APIと静的ファイル(CDN)配信の両方に優れた **Hono (Cloudflare Workers)** を使用する

**2. 配信する「管理のJS」の詳細**
本体から切り離す「JS」とは、どのような処理を行うスクリプトでしょうか？
- A. ブラウザ側で読み込ませるためのウィジェットや重いUI用のスクリプト（CDNとしての役割）
- B. レシピのJSON解析や画像生成などのバックエンド処理（APIとしての役割）

A, B両方です。

**3. データ保存先 (データベース / ストレージ)**
 `mp-recipe` 用に別のD1データベースやR2バケット（画像用など）を用意する

## Proposed Changes

承認いただいた後、以下の手順でセットアップを行います。

### 1. プロジェクトの初期化 (Hono / Cloudflare Workers の場合)
#### [NEW] `e:\workspace\ptms76\modparks\mp-recipe\package.json`
- Hono および Wrangler (Cloudflare) の依存関係を追加
- `dev`, `deploy` 用のスクリプトを設定

#### [NEW] `e:\workspace\ptms76\modparks\mp-recipe\wrangler.toml`
- Cloudflare Workers のルーティング・リソース定義

#### [NEW] `e:\workspace\ptms76\modparks\mp-recipe\src\index.ts`
- Hono アプリケーションのエントリポイント
- ヘルスチェックおよびベースとなるAPIエンドポイントの用意

#### [NEW] `e:\workspace\ptms76\modparks\mp-recipe\public\`
- CDNとして配信する静的JSやアセットを配置するディレクトリの設定 (HonoのServe Staticミドルウェアを使用)

## Verification Plan

- `npm run dev` (または `wrangler dev`) を使用してローカルサーバーを起動。
- `/api/health` などのエンドポイントにアクセスし、正常にレスポンスが返ることを確認。
- `/public/` 以下のダミーJSファイルにブラウザからアクセスし、CDNとして静的ファイルが正しく配信されるか確認。
