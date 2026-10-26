# The spike fixture in the shape of the production image (../../Dockerfile).
#
# It is not a standalone build and the real image is not either: next.config.mjs
# has no `output: "standalone"`, and the runner stage copies .next, node_modules,
# package.json and next.config.mjs, then runs `npm start`. Everything the spike
# is about (how `next start` builds request.url, which hostname it binds, how it
# treats a middleware rewrite) depends on that, so it is reproduced line for
# line and scripts/spike/selftest.mjs fails if the two files drift on the lines
# that matter.
#
# The build context is the scratch directory scripts/spike/run.mjs prepares: the
# fixture sources plus a generated package.json that pins next, react and
# react-dom to the versions in the root package.json.
FROM node:22.23.4-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --silent --ignore-scripts --no-audit --no-fund --no-package-lock

COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Production stage ───────────────────────────────────────────
FROM node:22.23.4-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs

RUN apk add --no-cache tini

USER nextjs

EXPOSE 3000

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
