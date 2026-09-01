# Contributing to VulnRadar

Thanks for your interest in contributing! This document covers the essentials.

## Development setup

```bash
npm ci
cp .env.example .env
npm run dev
```

Requires **Node 22** (the `engines` field is `>=22`; see `.nvmrc`).

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

Then, depending on what you touched:

- **Docs pages, changelog data, check definitions, or legal pages:** run
  `npm run build:knowledge` and **commit the regenerated files under
  `lib/ai/` and `lib/config/check-stats.generated.ts`**. CI regenerates them
  and fails on `git diff --exit-code`, so a PR that edits any of those sources
  without committing the regenerated output goes red on a step whose error
  message does not explain itself. This is the single most common surprise
  failure in this repo.
- **`cli/`:** `cd cli && node --test`
- **`extension/`:** `cd extension && npm ci && npm run typecheck && npm run format:check && npm run build:chrome && npm run build:firefox`

`npm audit --audit-level=high --omit=dev` also gates a PR, so a dependency
change that introduces a high-severity advisory will fail even if everything
above passes.

## Pull requests

- One feature/fix per PR
- Reference any related issues
- Squash-merge is the default
