# Contributing to VulnRadar

Thanks for your interest in contributing! This document covers the essentials.

## Development setup

```bash
npm install --legacy-peer-deps
cp .env.example .env.local
npm run dev
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with `--fix` |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run format` | Format with Prettier |

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

- **TypeScript** strict — no `any`, prefer `unknown` + narrowing
- **ESLint** flat config in `eslint.config.mjs`
- **Prettier** for formatting
- Avoid `// eslint-disable` unless absolutely necessary

## Pull requests

- One feature/fix per PR
- Reference any related issues
- Ensure `npm run build` and `npm run lint` pass locally
- Squash-merge is the default
