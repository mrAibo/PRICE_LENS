# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/product-matcher/package.json packages/product-matcher/package.json

RUN npm install --global npm@11 \
 && npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY packages/core/tsconfig.json packages/core/tsconfig.json
COPY packages/core/src packages/core/src
COPY packages/product-matcher/tsconfig.json packages/product-matcher/tsconfig.json
COPY packages/product-matcher/tsconfig.build.json packages/product-matcher/tsconfig.build.json
COPY packages/product-matcher/src packages/product-matcher/src

RUN npm run build -w @price-lens/contracts \
 && npm run build -w product-matcher \
 && npm run build -w @price-lens/core \
 && npm run build -w @price-lens/api \
 && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules

COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist

COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist

COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist

COPY --from=build /app/packages/product-matcher/package.json ./packages/product-matcher/package.json
COPY --from=build /app/packages/product-matcher/dist ./packages/product-matcher/dist

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
