# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 4.0.x   | :white_check_mark: |
| < 4.0   | :x:                |

Only the latest minor line receives security fixes. When a new minor ships,
this table moves with it.

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

We take all security reports seriously. To report a vulnerability:

1. **Email**: Send details to **security@vulnradar.dev**.
2. **Subject line**: `[SECURITY] <short description>`
3. **Response time**: We acknowledge within 48 hours and aim to provide an
   initial assessment within 5 business days.

### What to include

- Description of the vulnerability and its impact
- Steps to reproduce or a proof-of-concept
- Affected version(s) and commit SHA(s)
- Your name/handle (for credit in the changelog entry for the fix, if you
  want it)
- Whether you want public disclosure coordination

### What to expect

| Phase              | Timeframe                                    |
| ------------------ | -------------------------------------------- |
| Acknowledgment     | < 48 hours                                   |
| Initial assessment | < 5 business days                            |
| Patch development  | depends on severity                          |
| Public disclosure  | coordinated with reporter, typically 90 days |

### Scope

In scope:

- Authentication, authorization, and session management
- Cross-site scripting (XSS), SQL injection, SSRF, and other injection attacks
- Information disclosure (PII, API keys, scan results)
- Rate limiting bypasses
- Billing / Stripe integration bugs
- Scanner engine correctness (false negatives in security checks)
- Self-hosted deployment security (Docker, environment variables)

Out of scope:

- Denial of service via large/expensive scan requests (we have rate limits)
- Issues in third-party services we don't control (e.g. Stripe itself)
- Reports from automated scanners without proof of impact
- Theoretical issues without a concrete attack path
- Self-hosted deployments that skip the hardening steps in the
  [Security Checklist](https://vulnradar.dev/docs/self-hosting#security):
  in particular running without TLS, with a weak or missing
  `API_KEY_ENCRYPTION_KEY`, or with the Content-Security-Policy disabled

## Hall of Fame

We credit security researchers who responsibly disclose valid issues, in the
[changelog](https://vulnradar.dev/changelog) entry for the fix. The
`Acknowledgments:` field in our security.txt points at the same place.

## Encrypted reports

We do not currently publish a PGP key, so `security.txt` carries no
`Encryption:` field and there is nothing to encrypt to. Send the report
unencrypted, or email us first and we will agree a channel. Do not include
live credentials or personal data in the report body.

## Security.txt

Our machine-readable policy is at:
https://vulnradar.dev/.well-known/security.txt

## How the code and the releases are checked

What runs on every change, and what a release has to pass, so you can judge
the process and not only the result. The checks are in the repository, the
tests that hold them to what is written here are in `tests/repo`, and
`CONTRIBUTING.md` lists each one with what fails it.

- **CodeQL** runs as GitHub's default setup for JavaScript, TypeScript and
  GitHub Actions, with the extended query suite.
- **Dependabot** covers the app and extension npm trees, the package that pins
  the extension linter, the Dockerfiles (including the pinned CI tool images), the compose
  files and every GitHub Action, weekly.
- **Dependency review** blocks a pull request that adds or bumps a dependency
  with a known high advisory. A daily audit also covers every dependency tree
  with its dev dependencies, which a pull request check does not see, and
  checks the registry signatures of each.
- **Secret scanning** is GitHub's push protection, plus gitleaks over the
  commits of every pull request and push (redacted, because this repository's
  logs are public), a repository test for VulnRadar's own key shapes, and a
  weekly scan of the whole history.
- **Workflow rules**, enforced by `tests/repo/workflow-hardening.test.ts` over
  every workflow file: no permissions at the top level and each job's own, a
  timeout and a concurrency group on every workflow, every action pinned to a
  full commit and named by its exact release, no checkout that keeps its token,
  no expression pasted into a script, no `pull_request_target`, and no cache
  read or written by a job that signs or publishes. actionlint, shellcheck,
  zizmor and hadolint run on every pull request.
- **Attack suites.** Unit tests cover SSRF, CSRF and authorization. A
  cross-tenant suite runs against a real PostgreSQL. A black-box suite sends
  every state-changing route of the booted image a cross-site request and
  expects a refusal, and the application scans its own public pages with its
  own scanner and fails on any finding it has not accepted with a reason.
- **ZAP** runs a passive baseline on pull requests and an active scan weekly,
  against the image the job builds and nothing else, on a Docker network with no
  route out. A step proves the network has no egress before the scan starts.
- **Image scans.** Fixed vulnerabilities in the image are reported on pull
  requests, and the published image is scanned weekly for amd64 and arm64.
- **Live check.** Weekly, one request to https://vulnradar.dev/ and one TLS
  handshake check the response headers, the certificate chain, the negotiated
  protocol and the days left before expiry. It reads no page and probes no
  protocol version.
- **Release gates.** A release is built only from a commit whose CI passed,
  for every way it can be started. Each package's version is checked against
  what shipped before it, and the CLI against the bytes already on npm. Every
  signature is verified in the pipeline, with the identities in the next
  section, right after it is made. The publish jobs read no cache, run on a
  pinned BuildKit, and the arm64 image has to boot before it joins a release
  tag.
- **Rulesets.** The branch and tag rulesets are committed in
  `.github/rulesets`, but a ruleset is repository configuration, so it
  protects `main` and the release tags only once an owner has imported it. Until
  then these checks report and do not block.

## Verifying a Release

Every tagged release on GitHub is accompanied by:

- **Source tarball** (`vulnradar-vX.Y.Z.tar.gz`): a git-archive of the
  tagged commit
- **Browser extension packages** (`vulnradar-chrome-vE.E.E.zip` and
  `vulnradar-firefox-vE.E.E.zip`): built from the same tag. These carry the
  extension's own version, which is not the app version, so do not assume
  `vX.Y.Z` here
- **CLI package** (`vulnradar-cli-vC.C.C.tgz`): the npm tarball for the
  `vulnradar` CLI, packed from the same tag. Like the extension zips it
  carries its own version, not the app version. npm is the primary install
  path (`npx vulnradar`); this is here so a registry-pinned or airgapped
  consumer can take exactly what a given tag shipped and verify it
- **`sha256sums.txt`** (lowercase, exactly): checksums for every release
  artifact, i.e. the tarball, both extension zips, the CLI package, and both
  SBOMs. The updater looks this file up by exact name, so the case matters
- **CycloneDX SBOMs**: `vulnradar-vX.Y.Z.sbom.cdx.json` for the app image and
  `vulnradar-extension-vE.E.E.sbom.cdx.json` for the browser extension. Neither
  is individually signed; both are covered by their entry in `sha256sums.txt`
- **Cosign signature bundles**, two of them, keyless via Sigstore Fulcio +
  Rekor and in cosign's unified bundle format (certificate, signature, and
  Rekor entry in one file):
  - `vulnradar-vX.Y.Z.tar.gz.cert` over the source tarball
  - `sha256sums.txt.cert` over the checksum file itself. This one is the
    anchor for everything else: on its own, `sha256sums.txt` is an unsigned
    manifest served from the same host as the artifacts it describes, so
    anyone who could replace a release asset could replace it too. Verify
    this bundle first, then every hash in the file means something,
    including the extension zips and the SBOMs

  The matching Docker image is signed with `cosign sign` in the same release.

### Release flow

```
tag vX.Y.Z pushed
    ↓
docker-publish.yml: build + sign + push image + generate SBOM
    ↓
release.yml: attach SBOM + tarball + sha256sums + cosign sig to release
    (idempotent: attaches to existing release or creates one)
```

You can publish the release either way:

- **Auto:** push the tag, then publish the release from the GitHub UI
  (it will already have the artifacts attached).
- **Manual:** create + publish the release first, then push the tag
  (release.yml will attach artifacts as docker-publish completes).

To verify a release, run the commands below as written. The identities are
anchored regular expressions that name the exact workflow and ref that
signs each artifact: a looser one such as the repository URL alone also
accepts a signature from any other workflow in the repository, on any
branch. The release pipeline runs these same commands, with these same
identities, right after it signs, and stops when they refuse a signature it
just made.

```bash
# 1. Verify sha256sums.txt itself, FIRST. Skipping this step leaves you
# comparing artifacts against a manifest fetched from the same host that
# served them, which proves nothing about tampering.
curl -sLO https://github.com/VulnRadar/vulnradar.dev/releases/download/vX.Y.Z/sha256sums.txt
curl -sLO https://github.com/VulnRadar/vulnradar.dev/releases/download/vX.Y.Z/sha256sums.txt.cert
cosign verify-blob \
  --bundle sha256sums.txt.cert \
  --certificate-identity-regexp '^https://github[.]com/VulnRadar/vulnradar[.]dev/[.]github/workflows/release[.]yml@refs/(heads/main|tags/v[0-9]+[.][0-9]+[.][0-9]+(-[0-9A-Za-z.-]+)?)$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  sha256sums.txt

# 2. Now the hashes can be trusted. sha256sums.txt lists every release
# artifact (tarball, both extension zips, both SBOMs), so --ignore-missing is
# required: without it sha256sum reports the artifacts you did not download
# as failures and exits non-zero on a perfectly good release, which is
# indistinguishable from a real tamper signal. Drop the flag only if you
# downloaded the full asset set.
sha256sum --ignore-missing -c sha256sums.txt

# 3. Verify the source tarball's own signature (keyless, tied to the GitHub
# Actions OIDC). Step 2 already covers the tarball via its hash, so this is
# belt and braces rather than a second requirement.
cosign verify-blob \
  --bundle vulnradar-vX.Y.Z.tar.gz.cert \
  --certificate-identity-regexp '^https://github[.]com/VulnRadar/vulnradar[.]dev/[.]github/workflows/release[.]yml@refs/(heads/main|tags/v[0-9]+[.][0-9]+[.][0-9]+(-[0-9A-Za-z.-]+)?)$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  vulnradar-vX.Y.Z.tar.gz

# 4. Verify the Docker image. The amd64 image is signed by
# docker-publish.yml on the tag; the multi-arch index every tag resolves to
# once arm64 is merged in is signed by docker-publish-arm64.yml, which runs
# from the default branch. The identity accepts exactly those two.
cosign verify \
  --certificate-identity-regexp '^https://github[.]com/VulnRadar/vulnradar[.]dev/[.]github/workflows/(docker-publish[.]yml@refs/tags/v[0-9]+[.][0-9]+[.][0-9]+(-[0-9A-Za-z.-]+)?|docker-publish-arm64[.]yml@refs/heads/main)$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vulnradar/vulnradar:vX.Y.Z
```

## Periodic Cleanup

Sensitive data (password-reset tokens, email-verification tokens,
email-2fa codes, sessions, rate-limit rows, device-trust entries,
subdomain cache, security alerts) has a TTL baked into the schema.
`lib/database/cleanup.ts::performDatabaseCleanup` expires and
deletes stale rows.

**Long-lived deployments** (Node, Docker, self-hosted): the in-process
`setInterval` registered in `instrumentation.ts` runs cleanup every
5 minutes. The shortest meaningful user-facing TTL is
`email_2fa_codes` (10 min), so 5-minute cadence keeps stale entries
from lingering more than halfway through their next run.

**Serverless deployments** (Vercel, Cloudflare Pages, AWS Lambda):
the in-process interval doesn't tick because the process is
short-lived. Staff can force a cleanup from the admin UI by
calling `POST /api/v3/admin/cleanup` (staff session auth).
The cleanup endpoint can also be triggered from outside via
`curl -X POST -H "Cookie: <staff-session>" https://app/api/v3/admin/cleanup`,
e.g. from a Cloudflare Cron Trigger if you want serverless + cron.
