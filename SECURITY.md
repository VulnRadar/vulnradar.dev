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
