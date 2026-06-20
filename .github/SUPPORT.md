# Support Policy

## Node.js version

VulnRadar supports **Node.js 22 LTS** (primary) and **Node.js 20 LTS** (secondary). Odd-numbered releases (21, 23) and any pre-20 build are **not supported**.

This is not a stylistic preference — the dependency graph has explicit `engines` constraints that exclude other versions:

- `vitest@4`: `^20.0.0 || ^22.0.0 || >=24.0.0`
- `balanced-match@4`: `18 || 20 || >=22`
- `brace-expansion@5`: `18 || 20 || >=22`
- `minimatch@10`: `18 || 20 || >=22`

These come from upstream packages. We cannot override them on the consumer side. The fix is to switch Node, not to weaken the engines requirement.

## Bug reports

Before opening a bug report:

1. Confirm `node --version` is **v22.x.x** (use `nvm use` in the repo root — `.nvmrc` is pinned to 22).
2. Delete `node_modules` and `package-lock.json`, then `npm install` from scratch.
3. Run `npm run typecheck && npm run lint && npm test && npm run build` and confirm all four pass.
4. Search the existing issues for the same symptom.

**Bug reports on Node versions other than 22 LTS will be closed without investigation.** The error will be `npm warn EBADENGINE` or an equivalent engine-mismatch failure, and the fix is `nvm use` — not a code change. We do not have the bandwidth to bisect the dependency graph for every Node version.

If a real bug exists on Node 22 LTS, it will reproduce there too. Open the report against 22 and we will look at it.

## Self-hosted installations

Self-hosters must use Node 22 LTS on the host that runs `npm install && npm run build && npm run start`. If your Pterodactyl / Docker / hosting image only ships Node 21 or earlier, you have two options:

1. **Override the Docker image** to `node:22-bookworm-slim` (or `node:22-alpine` for a smaller image).
2. **Install Node 22 via the startup command** before the `npm install` step (e.g. `curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs && npm install && npm run build && npm run start`).

The official Pterodactyl Node.js egg (`ghcr.io/parkervcp/yolks:nodejs_*`) only goes up to Node 21. Use Node 20 (`ghcr.io/parkervcp/yolks:nodejs_20`) as a fallback, or override the image entirely.

## Security advisories

For private vulnerability reports, use [GitHub Security Advisories](https://github.com/VulnRadar/vulnradar.dev/security/advisories/new) — do not file a public issue.
