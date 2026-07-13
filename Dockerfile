FROM node:22-bookworm-slim AS builder

WORKDIR /app

# The runtime stage ships browsers via the Playwright base image, so the
# builder never needs Playwright to download chromium during npm ci.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:server && npm run build:web

FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    SKIP_ENV_LOCAL=true

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/apps/server/public ./apps/server/public
COPY --from=builder /app/runtime ./runtime
COPY --from=builder /app/themes ./themes
COPY --from=builder /app/packages/db-schema ./packages/db-schema
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

RUN mkdir -p .data && chown pwuser:pwuser .data

USER pwuser

EXPOSE 4321

# Use node (always present) rather than curl (not guaranteed in the base image).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node","-e","const p=process.env.PORT||4321;require('http').get('http://127.0.0.1:'+p+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

CMD ["node", "apps/server/dist/index.js"]
