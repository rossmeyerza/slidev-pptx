#!/usr/bin/env bash
set -e

echo "==> Building server and web before starting dev..."
npm run build:server
npm run build:web

SERVER_PORT="${PORT:-4321}"

exec npx concurrently -k \
  -n server,web,sync \
  -c cyan,green,magenta \
  "nodemon --watch apps/server/src --ext ts --exec 'npm run build:server && node apps/server/dist/index.js'" \
  "vite build --watch --config apps/web/vite.config.js" \
  "sleep 3 && npx browser-sync start --proxy 'http://127.0.0.1:${SERVER_PORT}' --files 'apps/web/dist/**' --no-open"
