# Backend + bot + admin panel (+ built-in Mini App fallback) in one container. Used by Railway.
FROM node:24-slim

# Prisma's query engine needs OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (cached unless manifests change).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/web-core/package.json packages/web-core/
RUN npm ci --include=dev --no-audit --no-fund

COPY . .

# Generate the Prisma client (a placeholder URL is enough at build time) and build the frontends.
RUN DATABASE_URL="mongodb://build-placeholder:27017/x" npx prisma generate \
  && npm run build

ENV NODE_ENV=production
EXPOSE 3000
# Ensures indexes + seed data (both idempotent), then starts API + bot (webhook) + scheduler.
CMD ["npm", "run", "start:prod"]
