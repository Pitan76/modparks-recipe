import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'public',
    emptyOutDir: false // 既存のCDNアセット(ui.jsなど)を消さないように
  }
})
