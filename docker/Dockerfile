FROM node:22.22.3-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps ./apps
COPY packages ./packages
COPY examples ./examples
COPY scripts ./scripts
COPY tests ./tests
COPY tsconfig.json angular.json vitest.config.ts playwright.config.ts ./
RUN npm ci --legacy-peer-deps
RUN npm run build
FROM node:22.22.3-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
EXPOSE 3000 4840
CMD ["npm","start"]
