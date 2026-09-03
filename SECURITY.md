# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 3.8.x   | :white_check_mark: |
| < 3.8   | :x:                |

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

To verify a release:

```bash
# 1. Verify sha256sums.txt itself, FIRST. Skipping this step leaves you
# comparing artifacts against a manifest fetched from the same host that
# served them, which proves nothing about tampering.
curl -sLO https://github.com/VulnRadar/vulnradar.dev/releases/download/vX.Y.Z/sha256sums.txt
curl -sLO https://github.com/VulnRadar/vulnradar.dev/releases/download/vX.Y.Z/sha256sums.txt.cert
cosign verify-blob \
  --bundle sha256sums.txt.cert \
  --certificate-identity-regexp 'https://github.com/VulnRadar/vulnradar.dev' \
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
  --certificate-identity-regexp 'https://github.com/VulnRadar/vulnradar.dev' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  vulnradar-vX.Y.Z.tar.gz

# 4. Verify the Docker image
cosign verify \
  --certificate-identity-regexp 'https://github.com/VulnRadar/vulnradar.dev/.github/workflows/docker-publish.yml' \
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
