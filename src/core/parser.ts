/**
 * @fileoverview JARファイル（またはZIPアーカイブ）からマイクラのレシピJSONファイルを解析・抽出するユーティリティ。
 */

import JSZip from 'jszip'

/** 解析されたレシピ情報の型定義。 */
export interface ParsedRecipe {
  /** レシピファイルの相対パス */
  path: string
  /** レシピのネームスペース（Mod ID など） */
  namespace: string
  /** レシピのJSONデータ */
  recipe: any
}

/**
 * JAR(ZIP)ファイルのArrayBufferから、レシピJSONを抽出する関数。
 * ブラウザ(フロントエンド)でも、サーバー(Worker)でも全く同じように動作します。
 * @param arrayBuffer JARファイルのバイナリデータ
 * @param targetModid 特定のMod IDでのみ抽出をフィルタリングしたい場合に指定するオプションのMod ID
 * @returns 解析されたレシピ一覧の配列
 */
export async function parseJarForRecipes(
  arrayBuffer: ArrayBuffer,
  targetModid?: string
): Promise<ParsedRecipe[]> {
  const zip = new JSZip()
  await zip.loadAsync(arrayBuffer)

  const recipes: ParsedRecipe[] = []

  // data/<namespace>/recipes/*.json を探索する
  const recipeRegex = /^data\/([^/]+)\/recipes\/.*\.json$/
  const filePromises: Promise<void>[] = []

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return

    const match = relativePath.match(recipeRegex)
    if (match) {
      const namespace = match[1]
      // 特定のmodidが指定されていればフィルタ、無ければすべて取得
      if (!targetModid || namespace === targetModid) {
        filePromises.push(
          zipEntry.async('string').then(content => {
            try {
              const json = JSON.parse(content)
              recipes.push({
                path: relativePath,
                namespace,
                recipe: json
              })
            } catch (e) {
              console.warn(`Failed to parse JSON for ${relativePath}`)
            }
          })
        )
      }
    }
  })

  await Promise.all(filePromises)
  return recipes
}
