#!/bin/bash
cd "$(dirname "$0")/../../render_out_png"

# List all files and run wrangler r2 object put with retries
find . -name "*.png" | sed 's/^\.\///' | while read file; do
  echo "Uploading $file..."
  success=false
  for i in {1..3}; do
    if npx wrangler r2 object put "mp-recipe-images/assets/minecraft/textures/render3d/$file" --file "$file" --content-type "image/png" > /dev/null 2>&1; then
      success=true
      break
    else
      echo "Failed to upload $file (attempt $i/3), retrying..."
      sleep 1
    fi
  done
  if [ "$success" = false ]; then
    echo "FAILED completely to upload $file"
  fi
done
