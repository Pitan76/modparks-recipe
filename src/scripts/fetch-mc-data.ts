import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as unzipper from 'unzipper';
import dotenv from 'dotenv';
import { Readable } from 'stream';

// Load environment variables from .env
dotenv.config();

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'mp-recipe-images';

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  console.error("Missing R2 credentials in environment variables.");
  console.error("Please create a .env file with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.");
  process.exit(1);
}

// Initialize S3 Client pointing to Cloudflare R2
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';

// Define the target paths we want to extract
const TARGET_PATHS = [
  /^assets\/minecraft\/textures\/item\/.*\.png$/,
  /^assets\/minecraft\/textures\/block\/.*\.png$/,
  /^data\/minecraft\/tags\/items\/.*\.json$/,
  /^data\/minecraft\/tags\/blocks\/.*\.json$/,
  /^data\/minecraft\/recipe.*\.json$/ // matches recipe/ and recipes/
];

async function fetchLatestVersionUrl(): Promise<string> {
  console.log("Fetching version manifest...");
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.statusText}`);
  const data = await res.json() as any;
  const latestRelease = data.latest.release;
  console.log(`Latest release: ${latestRelease}`);

  const versionData = data.versions.find((v: any) => v.id === latestRelease);
  if (!versionData) throw new Error("Could not find latest release data.");

  console.log("Fetching version details...");
  const versionRes = await fetch(versionData.url);
  if (!versionRes.ok) throw new Error(`Failed to fetch version details: ${versionRes.statusText}`);
  const versionJson = await versionRes.json() as any;
  return versionJson.downloads.client.url;
}

function shouldExtract(path: string): boolean {
  return TARGET_PATHS.some((regex) => regex.test(path));
}

async function run() {
  try {
    const clientJarUrl = await fetchLatestVersionUrl();
    console.log(`Downloading client JAR from ${clientJarUrl}...`);
    
    const response = await fetch(clientJarUrl);
    if (!response.body) throw new Error("Failed to get response body");
    
    // Convert Node.js Web stream to Node Readable stream
    const nodeStream = Readable.fromWeb(response.body as any);

    let count = 0;
    let promises: Promise<void>[] = [];

    console.log("Starting extraction and upload...");

    await new Promise<void>((resolve, reject) => {
      nodeStream.pipe(unzipper.Parse())
        .on('entry', async (entry: unzipper.Entry) => {
          const fileName = entry.path;
          
          if (entry.type === 'File' && shouldExtract(fileName)) {
            const buffer = await entry.buffer();
            const contentType = fileName.endsWith('.png') ? 'image/png' : 'application/json';
            
            const p = s3.send(new PutObjectCommand({
              Bucket: BUCKET_NAME,
              Key: fileName,
              Body: buffer,
              ContentType: contentType
            })).catch(err => {
              console.error(`Failed to upload ${fileName}`, err);
            });
            
            promises.push(p);
            count++;

            // Batch size of 100 concurrent uploads to avoid overloading network/memory
            if (promises.length >= 100) {
              entry.pause();
              await Promise.all(promises);
              promises = [];
              entry.resume();
            }
          } else {
            entry.autodrain();
          }
        })
        .on('finish', async () => {
          console.log('Finished reading zip file.');
          if (promises.length > 0) {
            await Promise.all(promises);
          }
          resolve();
        })
        .on('error', reject);
    });

    console.log(`Successfully extracted and uploaded ${count} files to R2.`);
  } catch (error) {
    console.error("Error during execution:", error);
    process.exit(1);
  }
}

run();
