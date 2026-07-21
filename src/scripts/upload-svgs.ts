/**
 * @fileoverview `render_out` ディレクトリ内のSVGファイルを R2 バケットにアップロードするスクリプト。
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'mp-recipe-images';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID as string,
    secretAccessKey: SECRET_ACCESS_KEY as string,
  },
  requestHandler: new NodeHttpHandler({
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 5 })
  }),
  maxAttempts: 5 // リトライ設定を追加
});

/**
 * 実行メイン処理。`render_out` ディレクトリからすべてのSVGファイルを読み込み、R2へアップロードします。
 */
async function run() {
    const dir = path.join(process.cwd(), 'render_out');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.svg'));
    
    console.log(`Found ${files.length} SVGs to upload...`);
    
    let successCount = 0;
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const localPath = path.join(dir, file);
        const svg = fs.readFileSync(localPath);
        
        const uploadPath = `assets/minecraft/textures/render/${file}`;
        
        try {
            await s3.send(new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: uploadPath,
                Body: svg,
                ContentType: 'image/svg+xml'
            }));
            successCount++;
            if (i % 50 === 0) {
                console.log(`Uploaded ${i}/${files.length}`);
            }
        } catch (e) {
            console.error(`Failed to upload ${file}:`, e);
            // TLS接続や制限を考慮して、次のリクエストを送信する前に少し待機します
            await new Promise(r => setTimeout(r, 1000));
        }
        
        // レート制限を避けるための短い遅延
        await new Promise(r => setTimeout(r, 20));
    }
    
    console.log(`Successfully uploaded ${successCount}/${files.length} SVGs.`);
}

run();
