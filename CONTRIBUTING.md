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
| `npm run lint`            | Run Oxlint, then ESLint                            |
| `npm run lint:fix`        | The same two with `--fix`                          |
| `npm run typecheck`       | Generate route types, then run `tsc --noEmit`      |
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
- **Oxlint** (`.oxlintrc.json`) then **ESLint** (`eslint.config.mjs`); `npm run lint` runs both, and a rule lives in only one of them
- **Prettier** for formatting
- Avoid disable comments unless absolutely necessary, and give the reason after `--`. Use `oxlint-disable` for a rule Oxlint owns and `eslint-disable` for one ESLint owns

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
  `lib/ai/`, `lib/config/check-stats.generated.ts` and
  `lib/seo/check-page-ids.generated.ts`**. CI regenerates them
  and fails on `git diff --exit-code`, so a PR that edits any of those sources
  without committing the regenerated output goes red on a step whose error
  message does not explain itself. This is the single most common surprise
  failure in this repo.
- **`cli/`:** `cd cli && npm test && npm pack --dry-run`. Use the package
  script, not a bare `node --test`: the script adds
  `--experimental-test-coverage`, and that is what CI runs, so a bare
  invocation reports a pass without telling you what fraction of the CLI it
  actually covered. `npm pack --dry-run` lists what the published package
  holds: a new module that is not in `files` in `cli/package.json` passes every
  test and ships a package that fails on its first run.
- **`extension/`:** `cd extension && npm ci && npm run typecheck && npm run format:check && npm run build`, which is the command CI runs. `build:chrome` and `build:firefox` skip the packaging step, so a break in packaging shows only under `build`. A new permission, host or content-script match also needs `extension/manifest/permissions.allowlist.json` changed in the same PR: a code owner reviews that file, and `node scripts/verify-dist.mjs`, run in `extension/` after the build, checks the built manifests against it.

`npm audit --audit-level=high --omit=dev` also gates a PR, so a dependency
change that introduces a high-severity advisory will fail even if everything
above passes.

## What CI checks

Every pull request, every push to `main` and `v4/**`, and every merge queue
run goes through `.github/workflows/ci.yml`. `.github/rulesets/main.json` is
the ruleset that makes twelve of its checks required. It is committed so it can
be reviewed here, and it only takes effect once an owner imports it under
Settings, Rules, Rulesets. Until then a red check is advisory.

**Web app**

| Check                | What fails it                                                                                                                                                                                                                                                 | Required | Run it locally                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| Lint                 | oxlint or ESLint errors, Prettier drift, a lockfile that lost its Linux native bindings (glibc or musl) or a `pnpm-lock.yaml`                                                                                                                                 | yes      | `npm run lint && npm run format:check`                                                   |
| Typecheck            | a type error, the Node pins disagreeing, a high advisory in a runtime dependency, generated knowledge files out of date                                                                                                                                       | yes      | `npx tsc --noEmit`, `npm audit --audit-level=high --omit=dev`, `npm run build:knowledge` |
| Test                 | a failing unit test, a coverage threshold, a rule in `tests/repo`, the CLI's own tests                                                                                                                                                                        | yes      | `npm run test:coverage`                                                                  |
| Integration          | a query, schema or constraint that does not hold on a real PostgreSQL, a dump `psql` cannot import                                                                                                                                                            | yes      | see "Before you open a PR"                                                               |
| Build                | `next build` fails, or a server secret's sentinel value reaches `.next/static`                                                                                                                                                                                | yes      | `npm run build`                                                                          |
| Self-host smoke test | the image does not build or boot on an empty database, a missing file, a writable code path, the self-scan finding something not in `tests/selfscan`'s accepted list, a cross-site write the app accepts, or a sitemap page or link that breaks the SEO rules | yes      | `docker build` the image and follow the compose quick start in `docker-compose.yml`      |
| Dependency review    | a pull request adds or bumps a dependency with a high advisory                                                                                                                                                                                                | yes      | not locally                                                                              |
| Secret scan          | gitleaks finds a secret in the commits the event adds                                                                                                                                                                                                         | yes      | build the `gitleaks` stage of `.github/tools/Dockerfile` and run it over your range      |

**Docker image**

| Check                        | What fails it                                                                                                                           | Required          | Run it locally                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------- |
| Self-host smoke test         | see above (amd64)                                                                                                                       | yes               | as above                         |
| ARM64 image builds and boots | the image does not build or boot on a native ARM runner. It runs only on pull requests that change what goes into the image, and weekly | no, path-filtered | `docker build` on an ARM machine |
| Site checks, image job       | reports fixed vulnerabilities in the image in the job summary and never fails                                                           | no, report only   | not locally                      |

**Browser extension**

| Check     | What fails it                                                                                                                                                                                                                                                                                                                                                                                                         | Required | Run it locally                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| Extension | the lockfile guard, an advisory, a type error, formatting, a build or packaging error, a permission, host or content-script match that `extension/manifest/permissions.allowlist.json` does not record (and a recorded one the manifests dropped), a CSP that allows eval or remote script, an API key anywhere in `dist-*`, a store zip over its size budget, or an error from `web-ext lint` on the Firefox package | yes      | `cd extension && npm ci && npm run typecheck && npm run format:check && npm run build && node scripts/verify-dist.mjs` |

**CLI**

| Check            | What fails it                                                                                                                                                                                                                   | Required        | Run it locally                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| CLI              | any leg of the matrix: the suite on Linux, Windows and macOS, each on the `.nvmrc` Node, the `engines` floor and the current LTS, then the packed tarball installed into an empty project and run with `--version` and `--help` | yes             | `cd cli && npm test && npm pack --dry-run`                                     |
| Package versions | a pull request that changes a package's shipped files without bumping its version, as a warning only. The release build fails on the same thing                                                                                 | no, report only | `node scripts/ci/package-versions.mjs --mode pr --ref HEAD --base origin/main` |

**Scan gate action**

| Check            | What fails it                                                                                                                                          | Required | Run it locally                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| Scan gate action | `uses: ./.github/actions/scan-gate` failing to pass a clean scan or to fail a bad one, on Linux, macOS or Windows, against a stand-in API on 127.0.0.1 | yes      | `npx vitest run tests/repo/scan-gate-parity.test.ts tests/repo/scan-gate-mock.test.ts` |

**Workflows and Dockerfiles**

| Check                                            | What fails it                                                                                                                                                                                                                          | Required          | Run it locally                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Workflow and Dockerfile lint                     | actionlint (with shellcheck) on a workflow, shellcheck on the scan-gate action's script, zizmor at medium severity, hadolint at error level                                                                                            | yes               | build the `actionlint`, `zizmor` and `hadolint` stages of `.github/tools/Dockerfile` and run them as the job does |
| `tests/repo/workflow-hardening.test.ts`, in Test | a workflow without its own permissions, a timeout or a concurrency group, an action not pinned to a full commit with its release tag, a checkout that keeps its token, an expression inside a script, a publish job that reads a cache | yes (inside Test) | `npx vitest run tests/repo`                                                                                       |

**Site checks** (`.github/workflows/site-checks.yml`) run a ZAP baseline against
the image the job builds, on a Docker network with no route out, and Lighthouse
on the public pages. They run only when a pull request touches app, image or
tooling paths, and weekly, so they are not required: a required check that does
not run blocks the merge. Lighthouse's accessibility, SEO and best-practices
floors in `.github/lighthouse/lighthouserc.json` are set to each group's
measured median on its first green run and are never lowered after that. Nothing in this repository's CI is pointed at a site that is
not VulnRadar's own, and `tests/repo/external-targets.test.ts` fails on a host
it does not list.

**Scheduled reports** (`.github/workflows/scheduled.yml`) run daily and
weekly. Each result lives in one open issue titled "Scheduled report: ...",
edited in place: the dependency audit, the outdated packages and waiting pull
requests, the live headers and TLS check of vulnradar.dev, the published image's
vulnerabilities and the secret scan of the whole history.

### Exceptions carry a reason, and a stale one fails

Each check that can be wrong about something true today has one named file for
its exceptions. Every entry names what it excuses and why, and an entry that
matches nothing fails the check, so the list shrinks when the problem is fixed.
A pull request adds an entry only with its reason.

| Check                     | Where its exceptions live                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Per-job write permissions | `WRITE_GRANTS` in `tests/repo/workflow-hardening.test.ts`. A new write scope fails until a row with a reason is added |
| actionlint                | `.github/actionlint.yaml`                                                                                             |
| zizmor                    | `.github/zizmor.yml`                                                                                                  |
| hadolint                  | `.hadolint.yaml`                                                                                                      |
| Secret scan               | the allowlists in `.gitleaks.toml`, and fingerprints in `.gitleaksignore`                                             |
| Extension permissions     | `extension/manifest/permissions.allowlist.json` (a code owner reviews it)                                             |
| `web-ext lint`            | `.github/tools/web-ext/lint-exceptions.json`                                                                          |
| ZAP                       | the `IGNORE` rows of `.github/zap/baseline.conf` and `full.conf`                                                      |
| Lighthouse                | the floors in `.github/lighthouse/lighthouserc.json`                                                                  |
| Sitemap SEO and links     | `.github/site-checks/baseline.json`, which can only shrink                                                            |
| Dependency audit          | `.github/audit-exceptions.json`                                                                                       |
| Published image scan      | `.grype.yaml`                                                                                                         |
| The self-scan             | `ACCEPTED` in `tests/selfscan`                                                                                        |

Two rules are written into tests, with their reasons next to them. The CLI job
may name a Node version in `setup-node`, in that one job and only while it keeps
an `.nvmrc` leg and a leg equal to the `engines` floor, because it proves the
package's supported range and every other job runs on the image's Node
(`tests/repo/ci-node-pin.test.ts`). And a workflow that needs a write permission
gets a row in `WRITE_GRANTS` with the reason, not a wider default.

### Dependabot

A patch bump from Dependabot is merged by `dependabot-auto-merge.yml` only after
every check on its exact head commit is green, and it then starts CI on `main`
for the merge commit, which a push made with the workflow token never does.
Minor and major bumps wait for a person, and the `dependabot-merge-ignore`
label opts a pull request out.

## Translations

The app speaks more than one language, and the wording lives under
`lib/i18n/messages`. Every language carries every English key, and
`tests/lib/i18n/key-parity.test.ts` fails when one is missing, so start a
translation by copying the `en` folder, translate what you can and leave the
rest in English until someone gets to it.
[`lib/i18n/README.md`](lib/i18n/README.md) covers how a reader's language is
chosen, what must never be translated (finding IDs, header names, code, URLs),
and how to write a string so it survives translation.

## Pull requests

- One feature/fix per PR
- Reference any related issues
- Squash-merge is the default
