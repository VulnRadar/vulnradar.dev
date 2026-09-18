# Contributing to VulnRadar

Thanks for your interest in contributing! This document covers the essentials.

## Development setup

```bash
npm ci
cp .env.example .env
npm run dev
```

Requires **Node 22** (the `engines` field is `>=22.0.0 <23.0.0`, so 20 and
anything from 23 up are both rejected; see `.nvmrc`).

### Use npm, and do not regenerate the lockfile

Install with `npm ci`, which installs exactly what `package-lock.json`
specifies. Avoid `npm install` unless you are deliberately adding or upgrading
a dependency, and never delete `package-lock.json` to fix a broken install.

The lockfile carries platform-specific native binaries (`@next/swc-*`,
`lightningcss-*`, `sharp`). Regenerating it on macOS or Windows resolves only
that platform's entries and silently drops the Linux ones, so your machine
works while CI and the Docker build fail with a missing native binding. If you
do intentionally change dependencies, check the diff for removed
`@next/swc-linux-*` / `lightningcss-linux-*` entries before committing.

`pnpm` and `yarn` produce the same breakage in this repo. Stick to npm.

## Scripts

| Script                    | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `npm run dev`             | Start dev server                                   |
| `npm run build`           | Production build                                   |
| `npm run lint`            | Run ESLint                                         |
| `npm run lint:fix`        | Run ESLint with `--fix`                            |
| `npm run typecheck`       | Run `tsc --noEmit`                                 |
| `npm run format`          | Format with Prettier                               |
| `npm run format:check`    | Check formatting without writing. CI runs this one |
| `npm test`                | Vitest suite                                       |
| `npm run build:knowledge` | Regenerate the AI knowledge files under `lib/ai/`  |

The full script list is in `package.json`; `npm run db:*` covers database
creation, migration, backup, restore, and the diagnose/repair tooling.

## Reviewing a production build locally, over plain HTTP

`npm run dev` is fine for writing code and wrong for reviewing it: the dev
server does not run the production CSS pipeline, the lazy-loaded chunks or the
prerendered pages, so what you are looking at is not what a visitor gets.

A production build served on plain `http://localhost` is what you want. One
thing is in the way: `middleware.ts` redirects any request whose
`x-forwarded-proto` says `http` to `https`, and Next fills that header in for
direct requests, so `http://localhost:3000` 301s to an address nothing is
listening on. `ALLOW_INSECURE_HTTP=1` is the documented opt-out for a
deployment with no TLS at all, and it is exactly right here.

```bash
npm run build
ALLOW_INSECURE_HTTP=1 PORT=3001 npm start
```

Then open `http://localhost:3001`. Port 3001 rather than 3000 so it can sit
beside a `npm run dev` you already have running, and the two do not fight over
the port or the `.next` directory.

On Windows PowerShell, `ALLOW_INSECURE_HTTP=1 PORT=3001 npm start` is not
valid syntax; set them first:

```powershell
$env:ALLOW_INSECURE_HTTP = "1"; $env:PORT = "3001"; npm start
```

To review a specific commit without disturbing your working tree, build it in a
worktree:

```bash
git worktree add ../vulnradar-build --detach <sha>
cd ../vulnradar-build && npm ci && npm run build
ALLOW_INSECURE_HTTP=1 PORT=3001 npm start
```

Two things that have bitten us there: if `node_modules` in the worktree is a
junction or symlink to the main checkout, `npm ci` empties the main one, so
check it is a real directory first; and stopping the terminal that started
`npm start` does not always stop the server, so if the port is still busy, find
the owner (`Get-NetTCPConnection -LocalPort 3001 -State Listen`) and stop that
process before starting another.

## Commit signing

All commits to `main` must be GPG-signed. Configure your signing key once:

```bash
git config user.signingkey <YOUR_GPG_KEY_ID>
git config commit.gpgsign true
```

You can verify a commit signature locally with:

```bash
git log --show-signature -1 <commit-sha>
```

On GitHub, signed commits display a "Verified" badge on the commit and
count toward the branch's required-signing-checks status (if enabled).

## Code style

- **TypeScript** strict: no `any`, prefer `unknown` + narrowing
- **ESLint** flat config in `eslint.config.mjs`
- **Prettier** for formatting
- Avoid `// eslint-disable` unless absolutely necessary

## Before you open a PR

CI gates on more than a build and a lint. Run the local equivalent of the
whole pipeline:

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```

`npm test` deliberately excludes `tests/integration`, so none of the above
runs a single line of real SQL. If you changed a query, a schema file, or a
constraint, run the integration tier too, against a throwaway database:

```bash
INTEGRATION_DATABASE_URL=postgresql://... \
  npx vitest run --config tests/integration/vitest.config.ts
```

It skips itself silently when that variable is unset, which is why a green
`npm test` proves nothing about SQL. See `tests/README.md`.

Then, depending on what you touched:

- **Docs pages, changelog data, check definitions, or legal pages:** run
  `npm run build:knowledge` and **commit the regenerated files under
  `lib/ai/` and `lib/config/check-stats.generated.ts`**. CI regenerates them
  and fails on `git diff --exit-code`, so a PR that edits any of those sources
  without committing the regenerated output goes red on a step whose error
  message does not explain itself. This is the single most common surprise
  failure in this repo.
- **`cli/`:** `cd cli && npm test`. Use the package script, not a bare
  `node --test`: the script adds `--experimental-test-coverage`, and that is
  what CI runs, so a bare invocation reports a pass without telling you what
  fraction of the CLI it actually covered.
- **`extension/`:** `cd extension && npm ci && npm run typecheck && npm run format:check && npm run build:chrome && npm run build:firefox`

`npm audit --audit-level=high --omit=dev` also gates a PR, so a dependency
change that introduces a high-severity advisory will fail even if everything
above passes.

## Pull requests

- One feature/fix per PR
- Reference any related issues
- Squash-merge is the default
