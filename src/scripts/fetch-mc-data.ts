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
  /^data\/minecraft\/tags\/items?\/.*\.json$/,
  /^data\/minecraft\/tags\/blocks?\/.*\.json$/,
  /^data\/minecraft\/recipe.*\.json$/ // matches recipe/ and recipes/
];

const MODEL_PATHS = [
  /^assets\/minecraft\/models\/item\/.*\.json$/,
  /^assets\/minecraft\/models\/block\/.*\.json$/
];

function shouldExtract(path: string): boolean {
  return TARGET_PATHS.some((regex) => regex.test(path));
}
function isModelPath(path: string): boolean {
  return MODEL_PATHS.some((regex) => regex.test(path));
}

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

async function run() {
  try {
    const clientJarUrl = await fetchLatestVersionUrl();
    console.log(`Downloading client JAR from ${clientJarUrl}...`);
    
    const response = await fetch(clientJarUrl);
    if (!response.body) throw new Error("Failed to get response body");
    
    // Convert Node.js Web stream to Node Readable stream
    const nodeStream = Readable.fromWeb(response.body as any);

    let count = 0;
    let promises: Promise<any>[] = [];

    console.log("Starting extraction and upload...");

    const modelsCache = new Map<string, any>();
    const texturesCache = new Map<string, string>(); // base64 strings

    await new Promise<void>((resolve, reject) => {
      nodeStream.pipe(unzipper.Parse())
        .on('entry', async (entry: unzipper.Entry) => {
          const fileName = entry.path;

          const extractData = shouldExtract(fileName);
          const extractModel = isModelPath(fileName);

          if (entry.type === 'File' && (extractData || extractModel)) {
            const buffer = await entry.buffer();
            
            if (extractModel) {
                try {
                    modelsCache.set(fileName.replace('assets/minecraft/models/', ''), JSON.parse(buffer.toString('utf-8')));
                } catch(e) {}
            }
            if (fileName.endsWith('.png')) {
                texturesCache.set(fileName.replace('assets/minecraft/textures/', ''), `data:image/png;base64,${buffer.toString('base64')}`);
            }

            if (extractData) {
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

                // Batch size of 10 concurrent uploads to avoid overloading network/memory/SSL handshakes
                if (promises.length >= 10) {
                  entry.pause();
                  await Promise.all(promises);
                  promises = [];
                  entry.resume();
                }
            } else {
                entry.autodrain(); // Drain if we only needed the buffer for cache (which we already consumed)
            }
          } else {
            entry.autodrain();
          }
        })
        .on('finish', async () => {
          console.log('Finished reading zip file. Rendering blocks...');
          if (promises.length > 0) {
            await Promise.all(promises);
          }
          promises = [];

          // Render step
          const getModelJson = async (id: string) => {
              const name = id.replace('minecraft:', '') + '.json';
              return modelsCache.get(name);
          };
          const getTextureBase64 = async (id: string) => {
              const name = id.replace('minecraft:', '') + '.png';
              return texturesCache.get(name) || null;
          };

          // Render all item models (which link to block models if they are blocks)
          let renderCount = 0;
          for (const [key, modelData] of modelsCache.entries()) {
              if (key.startsWith('item/')) {
                  const modelId = 'minecraft:' + key.replace('.json', '');
                  try {
                      const svg = await renderModelToSvg(modelId, getModelJson, getTextureBase64);
                      if (svg) {
                          const itemName = key.replace('item/', '').replace('.json', '');
                          const uploadPath = `assets/minecraft/textures/render/${itemName}.svg`;
                          const p = s3.send(new PutObjectCommand({
                              Bucket: BUCKET_NAME,
                              Key: uploadPath,
                              Body: Buffer.from(svg, 'utf-8'),
                              ContentType: 'image/svg+xml'
                          })).catch(err => console.error(`Failed to upload SVG ${uploadPath}`, err));
                          
                          promises.push(p);
                          renderCount++;
                          if (promises.length >= 10) {
                              await Promise.all(promises);
                              promises = [];
                          }
                      }
                  } catch(e) {
                      console.error(`Failed to render ${modelId}`, e);
                  }
              }
          }
          if (promises.length > 0) {
              await Promise.all(promises);
          }
          console.log(`Rendered and uploaded ${renderCount} SVGs.`);
          
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
