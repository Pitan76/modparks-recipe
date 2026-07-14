import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { jwt } from 'hono/jwt'
import JSZip from 'jszip'

type Bindings = {
  JWT_SECRET: string
  DB: D1Database
  BUCKET: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

// CORSの設定: 本体からのアクセスを許可
app.use('*', cors())

// APIヘルスチェック
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', service: 'mp-recipe' })
})

// === 認証ミドルウェア (デカップリング設計) ===
// 独立性を保つため、ModParks本体のDBは直接見ず、
// 本体側で発行・署名されたJWTトークンを検証するのみとする設計です。
// 環境変数 (JWT_SECRET) が設定されている場合のみ認証を要求します。
app.use('/api/upload/*', async (c, next) => {
  const secret = c.env.JWT_SECRET
  if (!secret) {
    // 開発環境などでSECRETが無い場合はスキップ（またはエラーにするか選択可能）
    // 本番環境では必須とするため、設定漏れを防ぐためにエラーにするのが安全です。
    return c.json({ error: 'Server configuration error: JWT_SECRET is missing' }, 500)
  }

  const jwtMiddleware = jwt({
    secret,
  })
  return jwtMiddleware(c, next)
})

import { parseJarForRecipes } from './core/parser'
import { renderRecipeToPng } from './core/renderer'

// === 公開API (誰でもアクセス可能: GET) ===

// 特定のModのレシピ情報一覧を取得
app.get('/api/recipes/:modid', async (c) => {
  const modid = c.req.param('modid')
  
  // D1から対象のレシピ一覧を取得
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM recipes WHERE modid = ? ORDER BY created_at DESC'
    ).bind(modid).all()

    return c.json({
      modid,
      recipes: results
    })
  } catch (e: any) {
    return c.json({ error: 'Database error', details: e.message }, 500)
  }
})

// R2から画像を配信するエンドポイント
app.get('/images/:modid/:filename', async (c) => {
  const modid = c.req.param('modid')
  const filename = c.req.param('filename')
  const key = `images/${modid}/${filename}`

  const object = await c.env.BUCKET.get(key)
  if (!object) {
    return c.notFound()
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)

  return new Response(object.body, { headers })
})

// 保存せず、受け取ったJARからレシピ画像（SVG等）を組み立てて返すだけのAPI
app.post('/api/assemble', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  const modid = body['modid']

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No jar file provided' }, 400)
  }

  try {
    const arrayBuffer = await file.arrayBuffer()
    const recipes = await parseJarForRecipes(arrayBuffer, modid as string)

    // TODO: parser結果をSVGなどにレンダリングするロジックを呼ぶ
    // 今回はパース結果のみ返す

    return c.json({
      message: 'Assembled recipes',
      recipeCount: recipes.length,
      recipes
    })
  } catch (e: any) {
    console.error("Assembly error", e)
    return c.json({ error: 'Failed to assemble recipes', details: e.message }, 500)
  }
})

// === 管理者用API (要JWT認証: POST) ===

// 1. Jarファイルのアップロードと解析（保存目的）
app.post('/api/upload/jar', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  const modid = body['modid']

  // JWTのペイロードからユーザー情報を取得可能
  const payload = c.get('jwtPayload')

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No jar file provided' }, 400)
  }

  try {
    const arrayBuffer = await file.arrayBuffer()
    const recipes = await parseJarForRecipes(arrayBuffer, modid as string)
    const savedRecipes: any[] = []

    // パースしたレシピを画像化してD1/R2に保存する
    for (const r of recipes) {
      try {
        // 画像生成
        const pngBytes = await renderRecipeToPng(r.recipe)
        
        // R2への保存
        // path は 'data/namespace/recipes/abc.json' など
        const filename = r.path.split('/').pop()?.replace('.json', '.png') || 'recipe.png'
        const imageKey = `images/${modid}/${filename}`
        
        await c.env.BUCKET.put(imageKey, pngBytes, {
          httpMetadata: { contentType: 'image/png' }
        })
        
        // D1への保存
        const id = `${modid}:${r.path}`
        const dataJson = JSON.stringify(r.recipe)
        const now = Date.now()
        
        await c.env.DB.prepare(
          `INSERT OR REPLACE INTO recipes (id, modid, path, data, image_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(id, modid, r.path, dataJson, imageKey, now).run()

        savedRecipes.push({
          id,
          path: r.path,
          imageKey
        })
      } catch (err) {
        console.error(`Failed to save recipe ${r.path}`, err)
      }
    }

    return c.json({ 
      message: 'Jar file parsed and recipes saved',
      modid,
      fileName: file.name,
      size: file.size,
      user: payload, // デバッグ用
      savedCount: savedRecipes.length,
      recipes: savedRecipes
    })
  } catch (e: any) {
    console.error("JAR parsing error", e)
    return c.json({ error: 'Failed to parse JAR file', details: e.message }, 500)
  }
})

// 2. 個別レシピ画像のアップロード
app.post('/api/upload/image', async (c) => {
  const body = await c.req.parseBody()
  const image = body['image']
  const modid = body['modid']
  const recipeId = body['recipeId']

  if (!image || !(image instanceof File)) {
    return c.json({ error: 'No image provided' }, 400)
  }

  // TODO: R2 バケットに画像を保存
  // パス例: /recipes/{modid}/{recipeId}.png

  return c.json({ 
    message: 'Image uploaded',
    modid,
    recipeId,
    fileName: image.name 
  })
})

// === 静的ファイル (CDN) の配信 ===
// wrangler.toml で設定した public/ ディレクトリ内のファイルを配信する
// (* にマッチしないリクエストは自動的に serveStatic へフォールバックされるが、
// 明示的にエンドポイントを作ることも可能。ここでは /assets/* をCDN用とする)
app.get('/*', serveStatic())

export default app
