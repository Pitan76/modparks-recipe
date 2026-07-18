#!/bin/bash
set -e

cd "$(dirname "$0")/../.."

echo "=== Step 1: Download client.jar & generate basic UI assets ==="
npx tsx src/scripts/fetch-mc-data.ts

echo ""
echo "=== Step 2: Render 3D block PNGs (node-canvas) ==="
rm -rf render_out_png/*
npx tsx src/scripts/render-blocks.ts

echo ""
echo "=== Step 3: Clean old files & Upload PNGs to R2 ==="
echo "Cleaning old files in R2..."
curl -s "https://mp-recipe.ptms76.workers.dev/admin/clean/minecraft/render3d?secret=modparks-clean-123"
echo ""
./src/scripts/upload-pngs-wrangler.sh

echo ""
echo "=== Step 4: Deploy Worker ==="
npm run deploy

echo ""
echo "=== DONE ==="
