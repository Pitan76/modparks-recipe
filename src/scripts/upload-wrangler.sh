#!/bin/bash
cd /home/user/workspace/modparks-recipe/render_out

# List all files and run wrangler r2 object put in parallel
find . -name "*.svg" | sed 's/^\.\///' | xargs -I {} -P 5 npx wrangler r2 object put "mp-recipe-images/assets/minecraft/textures/render/{}" --file "{}" --content-type "image/svg+xml"
