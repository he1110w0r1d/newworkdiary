# ── Stage 1: Build frontend ──────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Production runtime ─────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Install runtime dependencies. The server currently runs TypeScript through tsx.
COPY package.json package-lock.json ./
RUN npm ci

# Copy compiled frontend assets
COPY --from=builder /app/dist ./dist

# Copy server source (runs via tsx in production for simplicity,
# swap to pre-compiled JS if performance becomes critical)
COPY server ./server
COPY src/types.ts ./src/types.ts
COPY src/data ./src/data
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# The API serves the built frontend via express.static when
# NODE_ENV=production (see server/index.ts)
ENV NODE_ENV=production
ENV API_PORT=3000

EXPOSE 3000

# Health check for orchestrators
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["sh", "docker-entrypoint.sh"]
