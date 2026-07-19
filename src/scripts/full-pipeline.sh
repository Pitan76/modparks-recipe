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
# Load environment variables (like ADMIN_SECRET) if .env exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "$ADMIN_SECRET" ]; then
  echo "Error: ADMIN_SECRET is not set in .env"
  exit 1
fi

echo "=== Step 3: Upload PNGs to R2 ==="
echo "Uploading new files to R2 (overwriting existing ones)..."
./src/scripts/upload-pngs-wrangler.sh

echo ""
echo "=== Step 4: Deploy Worker ==="
npm run deploy

echo ""
echo "=== DONE ==="
