FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/rndc-api/package.json apps/rndc-api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/rndc-core/package.json packages/rndc-core/package.json

RUN npm ci

COPY tsconfig.json tsconfig.base.json ./
COPY apps/rndc-api apps/rndc-api
COPY packages/rndc-core packages/rndc-core

RUN npx tsc -b packages/rndc-core/tsconfig.json --force
RUN npx tsc -b apps/rndc-api/tsconfig.json --force

FROM node:22-bookworm-slim AS production-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/rndc-api/package.json apps/rndc-api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/rndc-core/package.json packages/rndc-core/package.json

RUN npm ci --omit=dev
RUN cd apps/rndc-api && node -e "Promise.all([import('express'), import('convex/browser')])"
RUN cd packages/rndc-core && node -e "Promise.all([import('pdfkit'), import('qrcode')])"

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3017
ENV RNDC_MODE=dry-run
ENV RNDC_OUTPUT_DIR=/app/data/runs
ENV RNDC_PDF_DIR=/app/data/pdf
ENV RNDC_LOCAL_DATA_DIR=/app/data/local/rndc-masters

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/packages/rndc-core/node_modules ./packages/rndc-core/node_modules
COPY --from=build --chown=node:node /app/apps/rndc-api/package.json ./apps/rndc-api/package.json
COPY --from=build --chown=node:node /app/apps/rndc-api/dist ./apps/rndc-api/dist
COPY --from=build --chown=node:node /app/packages/rndc-core/package.json ./packages/rndc-core/package.json
COPY --from=build --chown=node:node /app/packages/rndc-core/dist ./packages/rndc-core/dist

RUN mkdir -p /app/data/runs /app/data/pdf /app/data/local/rndc-masters && chown -R node:node /app/data

USER node

EXPOSE 3017

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3017') + '/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "apps/rndc-api/dist/index.js"]
