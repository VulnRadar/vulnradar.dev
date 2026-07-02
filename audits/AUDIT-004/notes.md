# Deferred security items — DB migrations, CI/CD, and code hardening

**ID:** AUDIT-004
**Created:** 2026-07-02T06:00:00Z
**Status:** open
**Scopes:** auth, crypto, secrets, rate-limit, idor, headers, scanner, ci, infra, misc

## Summary

Items discovered during AUDIT-003 that could not be applied immediately because they require:
- **DB schema migrations** (totp_last_counter, share_token_hash, billing_verification_codes salt)
- **CI/CD workflow changes** (GitHub Actions SHA pinning — carry-over from AUDIT-002#ci-01)
- **Further design decisions** (BrowserBase session ownership store, AI chat rate limiting strategy)
- **Follow-up from AUDIT-003 partial fixes** (next.config.mjs CSP still has bare https:)

## Priority order

| Priority | ID | Why |
|---|---|---|
| 1 | auth-01 | TOTP replay — active 2FA bypass window |
| 2 | rate-01 | AI chat cost amplification — unbounded spend |
| 3 | auth-02 | 2FA enrollment without password — session hijack enables 2FA takeover |
| 4 | rate-02 | Admin brute-force window — password gate without lockout |
| 5 | ci-01 | Supply chain — mutable GH Actions tags |
| 6 | idor-01 | BrowserBase session IDOR |
| 7 | headers-01 | next.config.mjs CSP still wide open |
| 8 | secrets-01 | Share token hashing (schema migration) |
| 9 | secrets-02 | billing_verification_codes salt (schema migration) |
| 10+ | misc-01, misc-02, audit-01, scanner-01, scanner-02 | Low severity / low exploitability |

## Migration notes

The three DB migrations can be bundled into a single migration script (v3.x → v3.x+1):

```sql
-- AUDIT-004#auth-01
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_counter BIGINT;

-- AUDIT-004#secrets-01
ALTER TABLE scan_history ADD COLUMN IF NOT EXISTS share_token_hash TEXT;
-- (backfill: UPDATE scan_history SET share_token_hash = encode(sha256(share_token::bytea), 'hex') WHERE share_token IS NOT NULL)

-- AUDIT-004#secrets-02
ALTER TABLE billing_verification_codes ADD COLUMN IF NOT EXISTS salt TEXT;
```
