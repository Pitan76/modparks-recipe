import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';
import * as unzipper from 'unzipper';
import dotenv from 'dotenv';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { renderModelToSvg } from '../utils/model-parser';

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
  requestHandler: new NodeHttpHandler({
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 })
  })
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
  /^assets\/minecraft\/models\/block\/.*\.json$/,
  /^assets\/minecraft\/items\/.*\.json$/
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
    
    const tempFilePath = path.join(process.cwd(), 'client.jar');
    const fileStream = fs.createWriteStream(tempFilePath);
    const nodeWebStream = Readable.fromWeb(response.body as any);
    
    console.log("Saving client JAR to disk...");
    await new Promise<void>((resolve, reject) => {
        nodeWebStream.pipe(fileStream)
            .on('finish', () => resolve())
            .on('error', reject);
    });

    const nodeStream = fs.createReadStream(tempFilePath);

    let count = 0;
    let promises: Promise<any>[] = [];

    console.log("Starting extraction and upload...");

    const modelsCache = new Map<string, any>();
    const itemsCache = new Map<string, any>();
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
                    if (fileName.startsWith('assets/minecraft/items/')) {
                        itemsCache.set(fileName.replace('assets/minecraft/items/', ''), JSON.parse(buffer.toString('utf-8')));
                    } else {
                        modelsCache.set(fileName.replace('assets/minecraft/models/', ''), JSON.parse(buffer.toString('utf-8')));
                    }
                } catch(e) {}
            }
            if (fileName.endsWith('.png')) {
                texturesCache.set(fileName.replace('assets/minecraft/textures/', ''), `data:image/png;base64,${buffer.toString('base64')}`);
            }

            // Skip uploading raw files to R2 to avoid SSL handshake rate limits,
            // we only need them in cache to render the SVGs.
            entry.autodrain();
            
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
              let name = id;
              if (name.startsWith('minecraft:')) name = name.replace('minecraft:', '');
              if (!name.endsWith('.json')) name += '.json';
              return modelsCache.get(name);
          };
          const getTextureBase64 = async (id: string) => {
              const name = id.replace('minecraft:', '') + '.png';
              return texturesCache.get(name) || null;
          };

          let renderCount = 0;
          
          // Legacy: Render all item models (which link to block models if they are blocks)
          for (const [key, modelData] of modelsCache.entries()) {
              if (key.startsWith('item/')) {
                  const modelId = 'minecraft:' + key.replace('.json', '');
                  try {
                      const svg = await renderModelToSvg(modelId, getModelJson, getTextureBase64);
                      if (svg) {
                          const itemName = key.replace('item/', '').replace('.json', '');
                          const localPath = path.join(process.cwd(), 'render_out', `${itemName}.svg`);
                          fs.writeFileSync(localPath, svg, 'utf-8');
                          renderCount++;
                      }
                  } catch(e) {
                      console.error(`Failed to render legacy ${modelId}`, e);
                  }
              }
          }
          
          // Modern (1.21.2+): Render all item definitions
          for (const [key, itemData] of itemsCache.entries()) {
              const itemName = key.replace('.json', '');
              let modelId = itemData.model?.model;
              if (!modelId) {
                  // Fallback if no model is explicitly defined, guess the item model
                  modelId = `minecraft:item/${itemName}`;
              }
              try {
                  const svg = await renderModelToSvg(modelId, getModelJson, getTextureBase64);
                  if (svg) {
                      const localPath = path.join(process.cwd(), 'render_out', `${itemName}.svg`);
                      fs.writeFileSync(localPath, svg, 'utf-8');
                      renderCount++;
                  }
              } catch(e) {
                  console.error(`Failed to render item ${itemName} with model ${modelId}`, e);
              }
          }
          
          console.log(`Rendered and saved ${renderCount} SVGs locally.`);
          
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
