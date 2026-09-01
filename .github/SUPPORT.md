# Support Policy

## Node.js version

VulnRadar requires **Node.js 22 LTS**. Node 20, odd-numbered releases (21, 23), and any pre-22 build are **not supported**.

This is not a stylistic preference. The binding constraint is VulnRadar's own `package.json`, whose `engines` field is `"node": ">=22.0.0"` (Node 20 fails that check). Several upstream dependencies pin the field further:

- `vitest@4`: `^20.0.0 || ^22.0.0 || >=24.0.0` (excludes odd releases)
- `balanced-match@4`, `brace-expansion@5`, `minimatch@10`: `18 || 20 || >=22`

We cannot override these on the consumer side. The fix is to switch Node to 22, not to weaken the engines requirement.

## Bug reports

Before opening a bug report:

1. Confirm `node --version` is **v22.11.0** (use `nvm use` in the repo root;
   `.nvmrc` and `.node-version` are pinned to the exact patch the Dockerfile
   builds on and every CI job runs, so a local reproduction is on the same
   runtime as the published image). Any 22.x satisfies `engines`; the pin is
   what makes "works on my machine" mean something.
2. Reinstall dependencies with `rm -rf node_modules && npm ci`.

   > **Do not delete `package-lock.json`, and do not use `npm install` to
   > "fix" a broken install.** Regenerating the lockfile resolves it for
   > whatever machine you are on, which drops the platform-specific native
   > binaries (`@next/swc-*`, `lightningcss-*`, `sharp`) that Linux CI and the
   > Docker build need. The result is a green local run and a broken build for
   > everyone else. `npm ci` installs exactly what the committed lockfile
   > says and never rewrites it, which is what you want here.
   >
   > Use `pnpm` or `yarn` in this repo and you will get the same class of
   > breakage. Stick to npm.

3. Run `npm run typecheck && npm run lint && npm test && npm run build` and confirm all four pass.
4. Search the existing issues for the same symptom.

**Bug reports on Node versions other than 22 LTS will be closed without investigation.** The error will be `npm warn EBADENGINE` or an equivalent engine-mismatch failure, and the fix is `nvm use`, not a code change. We do not have the bandwidth to bisect the dependency graph for every Node version.

If a real bug exists on Node 22 LTS, it will reproduce there too. Open the report against 22 and we will look at it.

## Self-hosted installations

Self-hosters must use Node 22 LTS on the host that runs `npm install && npm run build && npm run start`. If your Pterodactyl / Docker / hosting image only ships Node 21 or earlier, you have two options:

1. **Override the Docker image** to `node:22-bookworm-slim` (or `node:22-alpine` for a smaller image).
2. **Install Node 22 via the startup command** before the `npm install` step (e.g. `curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs && npm install && npm run build && npm run start`).

The official Pterodactyl Node.js egg (`ghcr.io/parkervcp/yolks:nodejs_*`) only goes up to Node 21, none of which satisfy the `>=22` requirement. Override the image to `node:22-bookworm-slim` (or `node:22-alpine`), or install Node 22 via the startup command as shown above.

## Security advisories

For private vulnerability reports, use [GitHub Security Advisories](https://github.com/VulnRadar/vulnradar.dev/security/advisories/new); do not file a public issue.
