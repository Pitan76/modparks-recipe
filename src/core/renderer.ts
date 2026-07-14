import satori from 'satori'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import { CRAFTING_3X3_SCALE2_B64 } from './assets'

let wasmInitialized = false
export async function initResvgWasm() {
  if (wasmInitialized) return
  try {
    const res = await fetch('https://unpkg.com/@resvg/resvg-wasm/index_bg.wasm')
    const buffer = await res.arrayBuffer()
    await initWasm(buffer)
    wasmInitialized = true
  } catch (e) {
    console.error("Failed to init wasm", e)
  }
}

let robotoFont: ArrayBuffer | null = null
async function getFont() {
  if (robotoFont) return robotoFont
  const res = await fetch('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Me5Q.ttf')
  robotoFont = await res.arrayBuffer()
  return robotoFont
}

/**
 * アイテム名（例: minecraft:apple）を短くフォーマットする
 */
function formatItemName(itemId: string): string {
  if (!itemId) return ''
  const parts = itemId.split(':')
  const name = parts.length > 1 ? parts[1] : parts[0]
  // 長すぎる場合は省略
  return name.length > 8 ? name.substring(0, 7) + '…' : name
}

/**
 * レシピJSONから3x3のグリッド配列（長さ9）を作成する
 */
function parseCraftingGrid(recipe: any): string[] {
  const grid = Array(9).fill('')

  if (recipe.type === 'minecraft:crafting_shaped' && recipe.pattern && recipe.key) {
    const pattern = recipe.pattern as string[]
    // pattern は最大3行、各行最大3文字
    for (let r = 0; r < Math.min(pattern.length, 3); r++) {
      const row = pattern[r]
      for (let c = 0; c < Math.min(row.length, 3); c++) {
        const char = row[c]
        if (char !== ' ' && recipe.key[char]) {
          const keyItem = recipe.key[char]
          // item か tag か
          const itemId = keyItem.item || keyItem.tag || JSON.stringify(keyItem)
          grid[r * 3 + c] = itemId
        }
      }
    }
  } else if (recipe.type === 'minecraft:crafting_shapeless' && recipe.ingredients) {
    const ingredients = recipe.ingredients as any[]
    for (let i = 0; i < Math.min(ingredients.length, 9); i++) {
      const ing = ingredients[i]
      const itemId = ing.item || ing.tag || JSON.stringify(ing)
      grid[i] = itemId
    }
  }

  return grid
}

/**
 * レシピJSONデータからPNG画像(Uint8Array)を生成する共通関数
 * ブラウザでもWorkerでも動作します
 */
export async function renderRecipeToPng(recipe: any): Promise<Uint8Array> {
  await initResvgWasm()
  const font = await getFont()

  const gridItems = parseCraftingGrid(recipe)
  
  let resultItemId = ''
  let resultCount = ''
  if (recipe.result) {
    resultItemId = recipe.result.item || recipe.result.id || JSON.stringify(recipe.result)
    if (recipe.result.count && recipe.result.count > 1) {
      resultCount = String(recipe.result.count)
    }
  } else if (recipe.output) {
    resultItemId = recipe.output.item || recipe.output.id || JSON.stringify(recipe.output)
  }

  // スロットの座標 (Scale 2x)
  // Base spacing: 18px -> scaled: 36px
  // Base offset: 2px -> scaled: 4px
  const slots = gridItems.map((itemId, i) => {
    const row = Math.floor(i / 3)
    const col = i % 3
    const x = 4 + col * 36
    const y = 4 + row * 36

    return {
      type: 'div',
      props: {
        style: {
          position: 'absolute',
          left: x,
          top: y,
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 8,
          color: 'white',
          textShadow: '1px 1px 0 #000',
          textAlign: 'center',
          lineHeight: 1,
          wordBreak: 'break-all',
          overflow: 'hidden'
        },
        children: formatItemName(itemId)
      }
    }
  })

  // 出力スロット
  const outputSlot = {
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        left: 192,
        top: 40,
        width: 32, // とりあえず同じサイズ枠で
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        color: 'white',
        textShadow: '1px 1px 0 #000',
        textAlign: 'center',
        lineHeight: 1
      },
      children: formatItemName(resultItemId)
    }
  }
  
  // 出力個数
  const outputCountNode = resultCount ? {
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        left: 192 + 32 - 10, // 右下に配置
        top: 40 + 32 - 12,
        fontSize: 12,
        color: 'white',
        textShadow: '1px 1px 0 #000'
      },
      children: resultCount
    }
  } : null

  const elements = [...slots, outputSlot]
  if (outputCountNode) elements.push(outputCountNode)

  // 画像自体のサイズは 232x108 程度
  // Satoriオブジェクト形式でUIを構築
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          width: '100%',
          height: '100%',
          backgroundImage: `url(${CRAFTING_3X3_SCALE2_B64})`,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          position: 'relative',
          fontFamily: 'Roboto'
        },
        children: elements
      }
    },
    {
      width: 232,
      height: 108,
      fonts: [
        {
          name: 'Roboto',
          data: font,
          weight: 400,
          style: 'normal',
        },
      ],
    }
  )

  const resvg = new Resvg(svg, {
    background: 'rgba(0,0,0,0)',
    fitTo: {
      mode: 'width',
      value: 232,
    },
  })
  
  const pngData = resvg.render()
  return pngData.asPng()
}
