# ── Build stage ─────────────────────────────────────────────────
# Node 22 LTS only. Node 20 reached end-of-life on 2026-04-30 and is no
# longer receiving security patches.
#
# infra: base image pinned to a specific minor version
# (`node:22.23.2-alpine`) instead of the moving `node:22-alpine` tag.
# Self-hosters who want a fully immutable build should replace this
# with `node:22.23.2-alpine@sha256:<digest>`: pull
# `node:22.23.2-alpine` locally and grab the digest via
# `docker images --digests node:22.23.2-alpine`.
FROM node:22.23.2-alpine AS builder

WORKDIR /app

# Accept build arguments for client-side env vars
ARG NEXT_PUBLIC_APP_URL
# Client components can only read NEXT_PUBLIC_* values, and Next.js inlines
# them at build time, so a self-hoster must pass this at build to get their
# own support address into the UI (server-side email uses SUPPORT_EMAIL at
# runtime and needs no rebuild).
ARG NEXT_PUBLIC_SUPPORT_EMAIL
# Community and extension-store links. The shipped defaults in
# lib/config/config-values.ts are VulnRadar's own listings, and they end up in
# the JSON-LD Organization node's sameAs array, which is an assertion of
# identity rather than a link. A fork or rebranded deployment passes its own
# here, or passes an empty string to drop the link entirely (the consumers
# filter out empty values).
ARG NEXT_PUBLIC_DISCORD_INVITE_URL
ARG NEXT_PUBLIC_CHROME_WEB_STORE_URL
ARG NEXT_PUBLIC_FIREFOX_ADDON_URL
# Turnstile and Stripe, both of which were documented as configurable and
# could not work on this image. Next.js inlines NEXT_PUBLIC_* at build time, so
# passing them only as runtime env (which is what docker-compose.yml did) gets
# them into the container and never into the browser bundle. The effect was
# that Turnstile could not be enabled at all through the supported compose
# path, and a self-hoster who configured Stripe correctly still got
# loadStripe(undefined) and a checkout that could not initialise.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

# Install dependencies first (better layer caching).
#
# infra: --ignore-scripts means NO install script runs during the image
# build, and nothing whitelists any back in. The comment that used to sit
# here claimed .npmrc held an allow-list read by "npm's allow-scripts
# mechanism"; npm has no such mechanism (`allowScripts` is @lavamoat's key,
# and pnpm's equivalent is pnpm.onlyBuiltDependencies), and .npmrc holds
# only audit-level, fund and update-notifier. Nothing was being allowed
# through.
#
# That turns out not to matter, for a different reason than the old comment
# gave: nothing in the production tree needs an install script. sharp 0.35
# ships its binaries as @img/* optional dependencies rather than building at
# install time, and the Next SWC binaries are prebuilt the same way. The
# only three lockfile entries with hasInstallScript are core-js (a donation
# banner), fsevents (macOS-only, optional) and unrs-resolver (dev-only, for
# eslint, and this build never lints).
#
# If a future dependency genuinely needs its install script, add a targeted
# `npm rebuild <pkg>` after this line. Do not drop --ignore-scripts.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --silent --ignore-scripts

# Copy source code
COPY . .

# Set production env for build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_SUPPORT_EMAIL=${NEXT_PUBLIC_SUPPORT_EMAIL}
ENV NEXT_PUBLIC_DISCORD_INVITE_URL=${NEXT_PUBLIC_DISCORD_INVITE_URL}
ENV NEXT_PUBLIC_CHROME_WEB_STORE_URL=${NEXT_PUBLIC_CHROME_WEB_STORE_URL}
ENV NEXT_PUBLIC_FIREFOX_ADDON_URL=${NEXT_PUBLIC_FIREFOX_ADDON_URL}
# An ARG is only visible to RUN steps that reference it; Next.js reads these
# from the process environment during `npm run build`, so they have to be
# promoted here or the build inlines an empty string and the ARG achieves
# nothing.
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}

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

# infra: drop the build-only tree before the runner stage copies node_modules.
#
# The install above deliberately includes devDependencies (the build needs
# typescript, the tailwind toolchain and the Next plugins), and the runner
# stage below copies /app/node_modules verbatim. Without this line the
# published image shipped ~89 MB of build tooling into a long-lived network
# service: typescript, prettier, eslint and its plugin set, lightningcss's
# native binary, axe-core. None of it is reachable from `next start`, and all
# of it is attack surface a self-hoster exposes to the internet.
#
# `prune` rather than a second `npm ci --omit=dev` in the runner stage: it
# needs no network round trip and no lockfile in the final image, and it
# cannot resolve a different tree than the one the build was verified
# against. --ignore-scripts for the same reason as the install above.
#
# One caveat worth naming: `vitest` and `@vitest/coverage-v8` are declared
# under `dependencies` rather than `devDependencies` (AUDIT-013#deps-02), so
# prune keeps them and their ~43 MB rolldown/vite subtree. Moving those two
# entries requires regenerating package-lock.json on Linux, which is a
# separate change; this line is correct either way and gets bigger once they
# move.
RUN npm prune --omit=dev --ignore-scripts

# infra: cosign binary, pulled from Sigstore's own distroless
# image rather than curl+checksum-verified by hand -- the standard
# multi-stage COPY pattern for bundling cosign into another image.
# Pinned to v2.4.1, the exact version .github/workflows/release.yml
# signs releases with, so verify-blob's bundle format always matches
# what was signed. Without cosign on PATH, lib/updater/cosign.ts soft-
# skips signature verification entirely (checksum verification still
# runs and is a hard gate either way) -- this is what makes real
# signature verification actually happen by default in the published
# image, instead of only for someone who happened to install cosign
# themselves.
FROM gcr.io/projectsigstore/cosign:v3.1.3 AS cosign

# ── Production stage ───────────────────────────────────────────
FROM node:22.23.2-alpine AS runner

LABEL org.opencontainers.image.source="https://github.com/VulnRadar/vulnradar.dev"
LABEL org.opencontainers.image.description="VulnRadar - Website Security Scanner"
LABEL org.opencontainers.image.licenses="GPL-3.0"

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

# infra: scripts/ is REQUIRED at runtime, not a build-time convenience.
# `npm run db:create` and `npm run db:migrate` are the documented way to
# initialise and upgrade a self-hosted database, the admin Backup button
# shells out to scripts/backup-db.mjs (lib/backup/run-backup.ts), and the
# self-updater runs the migrator (lib/updater/apply.ts). Without this the
# container tells the operator to run a script that is not in the image.
# It is also why postgresql-client is installed below.
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# infra: lib/ carries data files the app reads from disk at runtime, not
# just code Next.js bundles into .next. app/api/v3/ai/context/route.ts
# reads lib/ai/*-knowledge.md through process.cwd() and returns an empty
# string when the file is missing, so /docs, /changelog, /checks and
# /legal silently answer with no context in a published image.
COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib

# cosign binary for the self-updater's release signature verification
# (lib/updater/cosign.ts) -- see the cosign build stage above for why.
# /usr/local/bin is on Alpine's default PATH already.
COPY --from=cosign /ko-app/cosign /usr/local/bin/cosign

# Install wget for health checks, tini for proper PID 1 signal handling
# (npm as PID 1 does not forward SIGTERM to the Node worker on
# container shutdown), and postgresql-client for pg_dump -- scripts/
# migrate/migrate.mjs backs up the database to databases/ before
# applying any schema changes; without this package that step warns and
# skips instead of hard-failing the migration (see _lib.backup.mjs),
# but a self-hosted deploy using this image gets the real thing.
RUN apk add --no-cache wget tini postgresql-client

# infra: HEALTHCHECK gives orchestrators (k8s, ECS, compose) a real
# signal of app readiness. /api/v3/health checks database connectivity;
# /api/version only checks GitHub's releases API, so a container with a
# dead database would report healthy forever on that endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v3/health || exit 1

# infra: the app writes to two directories that are not in the image, and
# could not be created at runtime either. WORKDIR /app is created by root and
# the COPY --chown flags above only chown the children they copy, so /app
# itself stays root:root and the uid-1001 process gets EACCES from
# `mkdir -p`. That silently broke both the admin Backup button and
# scripts/backup-db.mjs (BACKUP_DIR defaults to <cwd>/backups) and the legacy
# avatar import (<cwd>/data/avatars). Create them here, owned by the runtime
# user, so a named volume mounted over either path also inherits that
# ownership. docker-compose.yml mounts both so the contents survive the
# `docker compose pull && docker compose up -d` upgrade.
RUN mkdir -p /app/backups /app/data/avatars && \
    chown -R nextjs:nodejs /app/backups /app/data

USER nextjs

EXPOSE 3000

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# infra: run under tini so SIGTERM is forwarded to the Node worker
# and in-flight requests drain cleanly on container shutdown.
# (schema auto-creates via instrumentation.ts on startup)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
