# syntax=docker/dockerfile:1
FROM node:22.22.3-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# Workspace manifests and sources are needed for npm workspace links.
COPY apps ./apps
COPY packages ./packages
COPY examples ./examples
COPY tests ./tests
COPY tsconfig.json angular.json vitest.config.ts playwright.config.ts ./
RUN npm ci --legacy-peer-deps
RUN npm run build
RUN npm prune --omit=dev --legacy-peer-deps

FROM node:22.22.3-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/server ./apps/server
COPY --from=build --chown=node:node /app/apps/mcp ./apps/mcp
COPY --from=build --chown=node:node /app/apps/web/package.json ./apps/web/package.json
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/examples ./examples
COPY --from=build --chown=node:node /app/dist/web ./dist/web
COPY --chown=node:node docker/healthcheck.mjs ./docker/healthcheck.mjs
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000 4840
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "docker/healthcheck.mjs"]
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
