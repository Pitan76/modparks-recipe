#!/bin/bash
set -e


cd ../../

echo "=== Step 1: Re-generate SVGs from client.jar ==="
rm -rf render_out/*.svg
npx tsx src/scripts/fetch-mc-data.ts

echo ""
echo "=== Step 2: Convert 3D SVGs to PNGs via Puppeteer ==="
rm -rf render_out_png/*
node src/scripts/convert-svgs-to-pngs.js

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
