import satori from 'satori'
import { Resvg, initWasm } from '@resvg/resvg-wasm'

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
 * レシピJSONデータからPNG画像(Uint8Array)を生成する共通関数
 * ブラウザでもWorkerでも動作します
 */
export async function renderRecipeToPng(recipe: any): Promise<Uint8Array> {
  await initResvgWasm()
  const font = await getFont()

  // Satoriオブジェクト形式でシンプルなUIを構築
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#c6c6c6', // マイクラ風のグレー背景
          padding: '20px',
          border: '2px solid #555',
          fontFamily: 'Roboto'
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                fontSize: 20,
                marginBottom: 20,
                color: '#333'
              },
              children: `Type: ${recipe.type || 'Unknown'}`
            }
          },
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                width: 200,
                height: 100,
                backgroundColor: '#8b8b8b',
                border: '4px solid #373737',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: 14,
                textAlign: 'center',
                padding: '10px'
              },
              // outputの中身を無理やり文字列化
              children: JSON.stringify(recipe.result || recipe.output || 'No output')
            }
          }
        ]
      }
    },
    {
      width: 400,
      height: 250,
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
      value: 400,
    },
  })
  
  const pngData = resvg.render()
  return pngData.asPng()
}
