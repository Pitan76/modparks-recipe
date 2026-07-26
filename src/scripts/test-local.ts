import * as r2 from './r2';
import fs from 'fs';

// R2のモック
(r2 as any).getFromR2 = async (key: string) => {
  console.log(`[Mock R2] getFromR2 called for key: ${key}`);
  if (key === 'index/recipes.json' && fs.existsSync('test-recipes.json')) {
    return fs.readFileSync('test-recipes.json');
  }
  return null;
};

(r2 as any).uploadToR2 = async (key: string, body: Buffer) => {
  console.log(`[Mock R2] uploadToR2 called for key: ${key}`);
  if (key === 'index/recipes.json') {
    fs.writeFileSync('test-recipes.json', body);
    console.log('[Mock R2] Saved index/recipes.json to test-recipes.json');
  }
};

// runPool を何もしないモックにする（誤って他の処理が走った場合のR2接続を防ぐ）
(r2 as any).runPool = async () => {
  console.log('[Mock R2] runPool called (no-op)');
};

// 本来の fetch-mc-data.ts をインポートして実行する
// このインポートにより fetch-mc-data.ts 内の `run()` が自動実行される。
import './fetch-mc-data';
