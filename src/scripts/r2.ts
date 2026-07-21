import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';
import dotenv from 'dotenv';

// Shared Cloudflare R2 (S3-compatible) client + helpers used by the data-fetch
// and block-render pipeline scripts. Uploading through one long-lived Node
// process with bounded concurrency is far faster than spawning `wrangler` once
// per file, and needs only the R2 S3 credentials (no CLOUDFLARE_API_TOKEN).

dotenv.config();

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

export const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'mp-recipe-images';

export function hasR2Credentials(): boolean {
  return !!(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

// Built on first use, not at import time: scripts that upload over the HTTP
// write API instead of S3 can import this module without any R2 credentials.
let client: S3Client | null = null;

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

function contentTypeFor(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

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

/** Runs async tasks with a bounded concurrency to avoid R2 rate limits. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      await worker(items[index++]);
    }
  });
  await Promise.all(runners);
}
