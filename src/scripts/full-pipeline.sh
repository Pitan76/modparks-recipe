#!/bin/bash
set -e

cd "$(dirname "$0")/../.."

echo "=== Step 1: Download client.jar & generate data ==="
npx tsx src/scripts/fetch-mc-data.ts

echo ""
echo "=== Step 2: Render 3D block PNGs (node-canvas, no browser needed) ==="
rm -rf render_out_png/*
npx tsx src/scripts/render-blocks.ts

echo ""
echo "=== Step 3: Upload PNGs to R2 ==="
cd render_out_png
find . -name "*.png" | sed 's/^\.\///' | xargs -I {} -P 5 npx wrangler r2 object put "mp-recipe-images/assets/minecraft/textures/render/{}" --file "{}" --content-type "image/png"
cd ..

echo ""
echo "=== Step 4: Deploy Worker ==="
npm run deploy

echo ""
echo "=== DONE ==="
