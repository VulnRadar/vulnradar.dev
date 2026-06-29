# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.3.x   | :white_check_mark: |
| 2.2.x   | :x:                |
| 2.1.x   | :x:                |
| 2.0.x   | :x:                |
| < 2.0   | :x:                |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

We take all security reports seriously. To report a vulnerability:

1. **Email**: Send details to **security@vulnradar.dev** (PGP key below).
2. **Subject line**: `[SECURITY] <short description>`
3. **Response time**: We acknowledge within 48 hours and aim to provide an
   initial assessment within 5 business days.

### What to include

- Description of the vulnerability and its impact
- Steps to reproduce or a proof-of-concept
- Affected version(s) and commit SHA(s)
- Your name/handle (for credit in the Acknowledgments section of
  `public/.well-known/security.txt`, if you want it)
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
- Self-hosted deployments that don't follow our hardening guide

## Hall of Fame

We credit security researchers who responsibly disclose valid issues.
See `public/.well-known/security.txt` for the latest list.

## PGP Key

We accept reports encrypted to the PGP key published in
`public/.well-known/security.txt`. If you need the key fingerprint
separately, request it via email reply.

## Security.txt

Our machine-readable policy is at:
https://vulnradar.dev/.well-known/security.txt

## Verifying a Release

Every tagged release on GitHub is accompanied by:

- **Source tarball** (`vulnradar-vX.Y.Z.tar.gz`) — a git-archive of the
  tagged commit
- **SHA256SUMS.txt** — checksums for every release artifact
- **CycloneDX SBOM** (`vulnradar-vX.Y.Z.sbom.cdx.json`) — full
  software bill of materials
- **Cosign signature** (`vulnradar-vX.Y.Z.tar.gz.sig` +
  `.cert`) — keyless signature via Sigstore Fulcio + Rekor. The
  matching Docker image is signed with `cosign sign` in the same
  release.

### Release flow

```
tag vX.Y.Z pushed
    ↓
docker-publish.yml: build + sign + push image + generate SBOM
    ↓
release.yml: attach SBOM + tarball + sha256sums + cosign sig to release
    (idempotent — attaches to existing release or creates one)
```

You can publish the release either way:

- **Auto:** push the tag, then publish the release from the GitHub UI
  (it will already have the artifacts attached).
- **Manual:** create + publish the release first, then push the tag
  (release.yml will attach artifacts as docker-publish completes).

To verify a release:

```bash
# Verify the tarball
curl -sL https://github.com/VulnRadar/vulnradar.dev/releases/download/vX.Y.Z/sha256sums.txt | \
  sha256sum -c -

# Verify the cosign signature (keyless, tied to the GitHub Actions OIDC)
cosign verify-blob \
  --bundle vulnradar-vX.Y.Z.tar.gz.cert \
  --signature vulnradar-vX.Y.Z.tar.gz.sig \
  --certificate-identity-regexp 'https://github.com/VulnRadar/vulnradar.dev' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  vulnradar-vX.Y.Z.tar.gz

# Verify the Docker image
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
