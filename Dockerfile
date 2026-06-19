# ── Build stage ─────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Accept build arguments for client-side env vars
ARG NEXT_PUBLIC_APP_URL

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --silent

# Copy source code
COPY . .

# Set production env for build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

# Provide dummy environment variables for build-time compatibility
# These are only used during the build phase and don't affect runtime behavior
# The real values are injected at runtime via docker-compose or docker run
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV STRIPE_SECRET_KEY="placeholder"
ENV STRIPE_WEBHOOK_SECRET="placeholder"
ENV STRIPE_PUBLISHABLE_KEY="placeholder"
ENV API_KEY_ENCRYPTION_KEY="00000000000000000000000000000000000000000000000000000000000000000000"

RUN npm run build

# ── Production stage ───────────────────────────────────────────
FROM node:20-alpine AS runner

LABEL org.opencontainers.image.source="https://github.com/VulnRadar/vulnradar.dev"
LABEL org.opencontainers.image.description="VulnRadar - Website Security Scanner"
LABEL org.opencontainers.image.licenses="AGPL-3.0"

WORKDIR /app

# Don't run as root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs

# Install wget for health checks
RUN apk add --no-cache wget

USER nextjs

EXPOSE 3000

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the app (schema auto-creates via instrumentation.ts on startup)
CMD ["npm", "start"]
