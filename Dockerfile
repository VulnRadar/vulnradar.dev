# ── Build stage ─────────────────────────────────────────────────
# Node 22 LTS only. Node 20 reached end-of-life on 2026-04-30 and is no
# longer receiving security patches.
#
# infra: base image pinned to an exact patch instead of the moving
# `node:22-alpine` tag. The patch lives in three places that must agree: the
# two FROM node lines in this file, .nvmrc and .node-version. CI and
# tests/repo/ci-node-pin.test.ts fail when they drift, so bump them together.
#
# security: and to a digest, because a tag can be republished and a build
# pinned only by tag is not reproducible from this repository. The digest is
# the multi-architecture index, so one value serves the amd64 and arm64 builds.
# Dependabot's docker ecosystem moves the tag and the digest together
# (.github/dependabot.yml); tests/repo/dockerfile-pins.test.ts fails on a FROM
# line without one.
FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS builder

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
# install time, and the Next SWC binaries are prebuilt the same way. Five
# lockfile entries have hasInstallScript, and
# tests/repo/package-deps-guard.test.ts fails when that list changes:
#   @parcel/watcher (under next-intl): prebuilt binaries as optional
#     dependencies; the script only compiles on request
#   @swc/core (nested under next-intl): prebuilt the same way; the script
#     checks that a binding loads
#   core-js: a donation banner
#   fsevents: macOS only, optional
#   unrs-resolver: dev only, for eslint, and this build never lints
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
# here. lib/config/env.ts requires exactly 64 hex characters at startup; a
# placeholder fails closed and forces operators to inject a real key
# via docker-compose env / Kubernetes secret / etc.

RUN npm run build

# The webpack cache is the build's own working state and the largest thing in
# .next. Nothing at run time reads it, and the runner's chown of .next/cache
# below would otherwise store a second copy of it in the image.
RUN rm -rf .next/cache

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
RUN npm prune --omit=dev --ignore-scripts

# ── Production stage ───────────────────────────────────────────
FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS runner

LABEL org.opencontainers.image.source="https://github.com/VulnRadar/vulnradar.dev"
LABEL org.opencontainers.image.description="VulnRadar - Website Security Scanner"
LABEL org.opencontainers.image.licenses="GPL-3.0"

WORKDIR /app

# Don't run as root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy necessary files from builder.
#
# security: root-owned, every one of them. The server runs as uid 1001, and
# code that uid owns turns any write primitive in the app into code execution
# for the life of the container. What the app does need to write is handed
# over below, directory by directory.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/server.mjs ./server.mjs

# infra: scripts/ is REQUIRED at runtime, not a build-time convenience.
# `npm run db:create` and `npm run db:migrate` are the documented way to
# initialise and upgrade a self-hosted database, the admin Backup button
# shells out to scripts/backup-db.mjs (lib/backup/run-backup.ts), and the
# self-updater runs the migrator (lib/updater/apply.ts). Without this the
# container tells the operator to run a script that is not in the image.
# It is also why postgresql-client is installed below.
COPY --from=builder /app/scripts ./scripts

# infra: lib/ carries data files the app reads from disk at runtime, not
# just code Next.js bundles into .next. app/api/v3/ai/context/route.ts
# reads lib/ai/*-knowledge.md through process.cwd() and returns an empty
# string when the file is missing, so /docs, /changelog, /checks and
# /legal silently answer with no context in a published image.
COPY --from=builder /app/lib ./lib

# Install wget for health checks, tini for proper PID 1 signal handling
# (npm as PID 1 does not forward SIGTERM to the Node worker on
# container shutdown), and postgresql-client for pg_dump -- scripts/
# migrate/migrate.mjs backs up the database to BACKUP_DIR/pre-migration
# (/app/backups/pre-migration here, on the backup_data volume) before
# applying any schema changes. A host without pg_dump falls back to the
# built-in JavaScript dumper rather than skipping the backup (see
# _lib.backup.mjs), but this image gets the real thing.
RUN apk add --no-cache wget tini postgresql-client

# infra: HEALTHCHECK gives orchestrators (k8s, ECS, compose) a real
# signal of app readiness. /api/v3/health checks database connectivity;
# /api/version only checks GitHub's releases API, so a container with a
# dead database would report healthy forever on that endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v3/health || exit 1

# infra: everything the server writes, and nothing else. .next/cache is Next's
# image and fetch cache; this build has no ISR route, so nothing writes under
# .next/server at run time.
#
# The other two are not in the image and could not be created at runtime
# either: WORKDIR /app and everything copied above is root:root, so the
# uid-1001 process gets EACCES from `mkdir -p`. That silently broke both the
# admin Backup button and
# scripts/backup-db.mjs (BACKUP_DIR defaults to <cwd>/backups), the dump
# db:migrate takes first (it used to go to <cwd>/databases, which nothing
# created, and now goes to BACKUP_DIR/pre-migration) and the legacy
# avatar import (<cwd>/data/avatars). Create them here, owned by the runtime
# user, so a named volume mounted over either path also inherits that
# ownership. docker-compose.yml mounts both so the contents survive the
# `docker compose pull && docker compose up -d` upgrade.
RUN mkdir -p /app/.next/cache /app/backups /app/data/avatars && \
    chown -R nextjs:nodejs /app/.next/cache /app/backups /app/data

USER nextjs

EXPOSE 3000

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# Node's four default threadpool threads also serve dns.lookup, file reads and
# zlib, so the scanner's DNS queued behind password hashing. libuv reads this
# once at the first threadpool job, which is why it is set here and not in app
# code. It does not raise hashing memory: the scrypt limiter in
# lib/auth/password-hash.ts stays at 2 x 128 MiB however many threads exist
# (see the note above CONFIG_DB_POOL_MAX).
ENV UV_THREADPOOL_SIZE=16
# NEXT_PUBLIC_APP_URL is deliberately not carried over from the builder. The
# OAuth redirects (lib/config/server-app-url.ts) fall back to the origin of the
# request only when neither APP_URL nor NEXT_PUBLIC_APP_URL is set at runtime,
# so a value baked in here would become every container's origin. The published
# image is built with it empty for the same reason.
# Reset, verification, invite and unsubscribe links are built from the same
# runtime variables and otherwise fall back to CONFIG_APP_URL, which is the
# upstream origin too, so set APP_URL or NEXT_PUBLIC_APP_URL when the
# container starts; the compose files pass it from .env.

# infra: this image updates by being replaced, not by rewriting itself. The
# updater cannot see that on its own: it can tell whether /app is writable,
# and being told "yes" here (someone runs as root, or bind-mounts /app) would
# not make an in-place update stick, because the writable layer goes away with
# the next `docker compose pull`. So the image says so, and the updater shows
# that instead of a button. It is also why this image has no cosign binary:
# the updater is the only thing that would run one.
#
# Only this image sets it. A source install running inside a container, which
# is how the Pterodactyl and Pelican eggs run, has a real persistent app
# directory and updates in place exactly as a bare-metal one does.
ENV VULNRADAR_UPDATER_DISABLED=true

# infra: run under tini so SIGTERM is forwarded to the Node worker
# and in-flight requests drain cleanly on container shutdown. Node directly
# rather than `npm start`, which is the same server.mjs behind npm and a shell:
# tini signals its one child, and the drain only runs if that child is node.
# (schema auto-creates via instrumentation.ts on startup)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.mjs"]
