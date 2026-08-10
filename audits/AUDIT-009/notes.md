# Pre-v3.0.0-release comprehensive audit

**ID:** AUDIT-009
**Created:** 2026-08-10T04:11:52.974Z
**Status:** draft
**Scopes:** auth, session, crypto, ssrf, csrf, idor, secrets, db, migration, scanner, billing, webhooks, api, extension, misc

## Summary

Final pre-publish audit before tonight's v3.0.0 GitHub release and production DB migration. Covers all new surface area added this session (webhooks, API scoping, regression alerts, exact-URL reputation, admin settings wiring, billing fixes, extension QOL, scripts) that hasn't been through a dedicated security pass yet, plus migration correctness for the real production cutover.

## Findings

_run `node scripts/audit/add-finding.mjs AUDIT-009 ...` to append findings._
