# AUDIT-001 — Auth, session, and scanner hardening

**ID:** AUDIT-001
**Created:** 2026-06-28T14:35:00Z
**Closed:** 2026-06-28T15:10:00Z
**Status:** shipped
**Ship commit:** bcc9e86
**Scopes:** auth, session, crypto, ssrf, csrf, headers, rate-limit, db, secrets, scanner

## Summary

Closed 1 critical (SSRF via open redirect), 8 high (server-action
IDOR, password-change session invalidation, plaintext TOTP / Discord
tokens, prod CSP escape hatch, CSRF gap, API-key rate-limit race,
mutable Docker base + `:latest` tag), and 11 medium findings across
the stack.

## Findings

Run `node scripts/audit/show.mjs AUDIT-001` for the structured list.

## Code references

Code comments cite findings as `ref: AUDIT-001#<scope>-NN`, e.g.
`ref: AUDIT-001#ssrf-01` for the SSRF fix in `lib/scanner/safe-fetch.ts`.
The reference is the audit ID + the finding's slug. Use
`node scripts/audit/show.mjs AUDIT-001 --json` to dump the full
structured payload.
