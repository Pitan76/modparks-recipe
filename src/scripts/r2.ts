/**
 * @fileoverview データ取得およびブロックレンダリングパイプラインのスクリプトで使用される、共有の Cloudflare R2 (S3互換) クライアントとヘルパー。
 * ファイルごとに毎回 `wrangler` コマンドを実行する代わりに、同時実行数制限を設けた1つの長期稼働Nodeプロセス経由でアップロードを行う方が遥かに高速です。
 * 必要なのは R2 S3 認証情報のみです（CLOUDFLARE_API_TOKEN は不要）。
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

export const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'mp-recipe-images';

/**
 * 環境変数に R2 の認証情報が存在するかどうかを判定します。
 */
export function hasR2Credentials(): boolean {
  return !!(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

// インポート時ではなく、最初の使用時にビルドされます。これにより、S3の代わりにHTTP書き込みAPI経由でアップロードを行うスクリプトは、
// R2の認証情報を持たなくてもこのモジュールをインポートできます。
let client: S3Client | null = null;

/**
 * S3Client のインスタンスを取得（または作成）します。
 */
export function getS3(): S3Client {
  if (!client) {
    if (!hasR2Credentials()) {
      console.error('Missing R2 credentials in environment variables.');
      console.error('Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY (.env for local runs).');
      process.exit(1);
    }
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID!, secretAccessKey: SECRET_ACCESS_KEY! },
      requestHandler: new NodeHttpHandler({
        httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
      }),
    });
  }
  return client;
}

/**
 * キー名（ファイルパス）の拡張子から、Content-Typeヘッダーの値を返します。
 * @param key ファイルパスまたはキー名
 */
function contentTypeFor(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

/**
 * バイナリデータ（Buffer）を R2 バケットの指定したキーにアップロードします。
 * @param key アップロード先のオブジェクトキー
 * @param body アップロードするバイナリデータ
 */
export async function uploadToR2(key: string, body: Buffer): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentTypeFor(key),
    })
  );
}

/**
 * R2 のレート制限を避けるため、同時実行数を制限して非同期タスクを実行します。
 * @param items 処理するアイテムの配列
 * @param limit 同時実行制限数
 * @param worker 各アイテムを処理する非同期関数
 */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      await worker(items[index++]);
    }
  });
  await Promise.all(runners);
}
