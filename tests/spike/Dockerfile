# The spike fixture in the shape of the production image (../../Dockerfile).
#
# It is not a standalone build and the real image is not either: next.config.mjs
# has no `output: "standalone"`, and the runner stage copies .next, node_modules,
# package.json, next.config.mjs, server.mjs and lib, then runs `node server.mjs`.
# Everything the spike is about (how that server builds request.url, which
# hostname it binds, how Next behind it treats a middleware rewrite) depends on
# that, so it is reproduced line for line and scripts/spike/selftest.mjs fails
# if the two files drift on the lines that matter.
#
# The build context is the scratch directory scripts/spike/run.mjs prepares: the
# fixture sources, the repository's own server.mjs and lib/server/http-front.mjs,
# and a generated package.json that pins next, react and react-dom to the
# versions in the root package.json.
FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --silent --ignore-scripts --no-audit --no-fund --no-package-lock

COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Production stage ───────────────────────────────────────────
FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/server.mjs ./server.mjs
COPY --from=builder /app/lib ./lib

RUN apk add --no-cache tini

RUN mkdir -p /app/.next/cache && chown -R nextjs:nodejs /app/.next/cache

USER nextjs

EXPOSE 3000

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.mjs"]
