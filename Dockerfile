# ── Build stage ─────────────────────────────────────────────────
# Node 22 LTS only. Node 20 reached end-of-life on 2026-04-30 and is no
# longer receiving security patches.
#
# SECURITY-AUDIT-2026-06-28 / H-8: base image pinned to a specific
# minor version (`node:22.11.0-alpine`) instead of the moving
# `node:22-alpine` tag. Self-hosters who want a fully immutable build
# should replace this with `node:22.11.0-alpine@sha256:<digest>` —
# pull `node:22.11.0-alpine` locally and grab the digest via
# `docker images --digests node:22.11.0-alpine`.
FROM node:22.11.0-alpine AS builder

WORKDIR /app

# Accept build arguments for client-side env vars
ARG NEXT_PUBLIC_APP_URL

# Install dependencies first (better layer caching).
# SECURITY-AUDIT-2026-06-28 / supply-chain: --ignore-scripts prevents
# transitive postinstall scripts from running during image build.
# Native deps (sharp, esbuild, unrs-resolver, core-js) are whitelisted
# in .npmrc so they DO run via npm's `allow-scripts` mechanism.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --silent --ignore-scripts

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
# NOTE: API_KEY_ENCRYPTION_KEY placeholder is intentionally NOT set
# here. lib/config/env.ts validates the key length at startup; a 68-char
# placeholder fails closed and forces operators to inject a real key
# via docker-compose env / Kubernetes secret / etc.

RUN npm run build

# ── Production stage ───────────────────────────────────────────
FROM node:22.11.0-alpine AS runner

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

# Install wget for health checks + tini for proper PID 1 signal handling
# (npm as PID 1 does not forward SIGTERM to the Node worker on
# container shutdown).
RUN apk add --no-cache wget tini

# SECURITY-AUDIT-2026-06-28 / build: HEALTHCHECK gives orchestrators
# (k8s, ECS, compose) a real signal of app readiness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/version || exit 1

USER nextjs

EXPOSE 3000

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the app under tini so SIGTERM is forwarded to the Node worker
# and in-flight requests are allowed to drain cleanly.
# (schema auto-creates via instrumentation.ts on startup)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
