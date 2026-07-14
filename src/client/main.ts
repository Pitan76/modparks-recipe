import { parseJarForRecipes } from '../core/parser'
import { renderRecipeToPng } from '../core/renderer'

const dropZone = document.getElementById('drop-zone')!
const fileInput = document.getElementById('file-input') as HTMLInputElement
const resultsDiv = document.getElementById('results')!

dropZone.addEventListener('click', () => fileInput.click())

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropZone.classList.add('hover')
})

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('hover')
})

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault()
  dropZone.classList.remove('hover')
  
  const file = e.dataTransfer?.files[0]
  if (file) {
    await handleFile(file)
  }
})

fileInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    await handleFile(file)
  }
})

async function handleFile(file: File) {
  resultsDiv.innerHTML = '<p>解析中...</p>'
  try {
    const arrayBuffer = await file.arrayBuffer()
    const startTime = performance.now()
    
    // クライアントサイドでのコアロジック呼び出し
    const recipes = await parseJarForRecipes(arrayBuffer)
    
    // 最初の5件だけ画像化してみる（デモ用）
    const demoRecipes = recipes.slice(0, 5)
    let imagesHtml = ''
    
    for (const r of demoRecipes) {
      try {
        const pngBytes = await renderRecipeToPng(r.recipe)
        // Uint8ArrayからBlob URLを作成
        const blob = new Blob([pngBytes], { type: 'image/png' })
        const url = URL.createObjectURL(blob)
        imagesHtml += `
          <div style="margin-bottom: 20px;">
            <h4>${r.path}</h4>
            <img src="${url}" alt="Recipe" style="border: 1px solid #444;" />
          </div>
        `
      } catch (e: any) {
        imagesHtml += `<p style="color: red;">Failed to render ${r.path}: ${e.message}</p>`
      }
    }

    const timeTaken = (performance.now() - startTime).toFixed(2)

    resultsDiv.innerHTML = `
      <h2>解析結果 (${recipes.length} 件のレシピを ${timeTaken}ms で取得)</h2>
      <p>※サーバーへの通信を一切行わず、ブラウザ内で完結してPNG画像を生成しました。</p>
      <div style="display: flex; flex-wrap: wrap; gap: 20px;">
        ${imagesHtml}
      </div>
      <hr style="margin: 20px 0; border-color: #444;" />
      <h3>JSONデータの一部</h3>
      <pre><code>${JSON.stringify(demoRecipes, null, 2)}</code></pre>
    `
  } catch (error: any) {
    resultsDiv.innerHTML = `<p style="color: red;">エラー: ${error.message}</p>`
  }
}
