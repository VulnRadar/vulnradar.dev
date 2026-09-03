# AUDIT-012 — Plan

**Created:** 2026-08-28
**Title:** Correctness, SSRF and scan abuse, performance, error handling and observability
**Status:** in_progress (batch 2 of N)
**Batch:** sections 1, 2, 9, 17. Requested by the product owner, and the batch
AUDIT-011's closing note recommended.

---

## Why these four

They share one reading path. Sections 1, 2, 9 and 17 are all answered by walking
`lib/` and `app/api/` and asking four different questions of the same code, in the
same way AUDIT-011's batch shared one walk through `app/` and `components/`. Auditing
them together costs far less than auditing any two of them separately.

AUDIT-011 deliberately skipped 1 and 2 on the grounds that ten prior audits had
already worked that ground. That reasoning was sound, and it is why this run was
scoped to _verify the prior fixes still hold_ before looking for anything new. They
do: see "Prior fixes verified" below. What this run found is mostly ground the
earlier audits never reached, because they were looking for classic web
vulnerabilities and the remaining defects are resource-exhaustion, metering, and
observability problems.

---

## Repo shape (measured, not assumed)

| Area             | Size                                 |
| ---------------- | ------------------------------------ |
| `app/`           | 314 files, 60,517 lines              |
| `lib/`           | 252 files, 80,242 lines (29 subdirs) |
| `components/`    | 313 files, 65,147 lines              |
| `tests/`         | 362 files, 89,192 lines              |
| `extension/src/` | 25 files, 7,048 lines                |
| `scripts/`       | 58 files, 13,161 lines               |
| API routes       | 155 `route.ts` under `app/api/`      |
| Pages            | 71 `page.tsx`                        |

191 commits have landed since AUDIT-010 shipped (`c58d0481`).

---

## How this run was executed

Nine subagents in parallel, each given a disjoint file scope so no two agents read
the same code for the same purpose:

| Agent   | Section | Scope                                                                                                                    |
| ------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `authz` | 1       | authn/authz across all 155 routes, IDOR, tenant isolation, mass assignment, staff-2FA gates                              |
| `inj`   | 1       | SQLi, XSS through attacker-controlled scan output, path traversal, command injection, ReDoS, secrets placement           |
| `logic` | 1       | credit/quota atomicity, Stripe webhook idempotency, share links, teams, schedules, account lifecycle, TOCTOU             |
| `auth`  | 1       | session lifecycle, password and reset, 2FA, OAuth state and account linking, CSRF, API keys, crypto primitives           |
| `ssrf`  | 2       | the guard layer, encodings, redirect re-validation, DNS rebinding, caps, and every other outbound fetch                  |
| `abuse` | 2       | rate-limit store and IP derivation, server-side quota per scan entry point, worker exhaustion, amplification, cost paths |
| `perf`  | 9       | scan-path budget, N+1s, missing indexes, unbounded queries, per-request work that should be cached                       |
| `fe`    | 9       | `"use client"` audit, bundle imports, waterfalls, images and CLS, polling, route caching                                 |
| `obs`   | 17      | swallowed catches, fire-and-forget promises, internals leaking to users, error-shape consistency, logging and monitoring |

Every agent was required to read prior findings in its area before filing, and to
confirm each finding at a live `file:line` in the current tree. All output was then
machine-validated: schema keys, enum values, duplicate ids, severity sort order, and
the existence of every cited file and line.

---

## Section status, as delivered

114 findings: 1 critical, 25 high, 53 medium, 31 low, 4 info. Sorted
severity-descending as the brief requires. 80 distinct files cited.
Effort split: 81 small, 29 medium, 4 large.

| #   | Section                               | This run  | Status       | Findings       |
| --- | ------------------------------------- | --------- | ------------ | -------------- |
| 1   | Correctness and security              | yes       | **COMPLETE** | 37             |
| 2   | SSRF and scan abuse                   | yes       | **COMPLETE** | 22             |
| 3   | Client-visible breakage               | AUDIT-011 | complete     | 38             |
| 4   | UI fixes, mobile and desktop          | AUDIT-011 | complete     | 27             |
| 5   | Design consistency                    | AUDIT-011 | **PARTIAL**  | 6              |
| 6   | The scanning page                     | AUDIT-011 | **PARTIAL**  | 8              |
| 7   | UI quality of life                    | AUDIT-011 | **PARTIAL**  | 4              |
| 8   | Backend / frontend capability drift   | AUDIT-011 | complete     | 26             |
| 9   | Performance                           | yes       | **COMPLETE** | 44             |
| 10  | Tests                                 | no        | outstanding  | 1 (incidental) |
| 11  | Dependencies                          | no        | outstanding  | 1 (incidental) |
| 12  | Database and migrations               | no        | outstanding  | 3 (incidental) |
| 13  | Build and deploy                      | no        | outstanding  | none           |
| 14  | Documentation                         | no        | outstanding  | none           |
| 15  | Hardcoded values                      | no        | outstanding  | none           |
| 16  | Consistency and dead code             | no        | outstanding  | none           |
| 17  | Error handling and observability      | yes       | **COMPLETE** | 11             |
| 18  | Accessibility and states              | no        | outstanding  | none           |
| 19  | Discoverability and marketing surface | no        | outstanding  | none           |
| 20  | Competitive gaps                      | no        | outstanding  | none           |

"Incidental" means the finding surfaced while auditing a section in this batch and is
typed to its true subject. Those sections remain fully outstanding.

**Sections still outstanding after this run: 10, 11, 12, 13, 14, 15, 16, 18, 19, 20,
plus the unfinished halves of 5, 6 and 7 from AUDIT-011.**

---

## Prior fixes verified as still holding

This mattered more than finding new issues, and it is recorded so a future run does
not re-verify it. Confirmed present and correct in the current tree:

- **SSRF guard:** `redirect: "manual"` with per-hop `validateScanTarget`
  re-validation and cross-host rejection; DNS fail-closed; decimal, octal, hex,
  userinfo, trailing-dot and IDN encodings all normalise before the check;
  IPv4-mapped and NAT64 IPv6 canonicalisation; 301/302/303 method downgrade;
  session credentials dropped off-origin. `port-scan` and `tls.ts` pin the resolved
  IP more strictly than the fetch layer does.
- **Auth:** TOTP replay (counter keyed on the matched value under `FOR UPDATE`),
  the email-2FA race and its N+1, the HMAC-signed pending-2FA cookie, the Bearer CSRF
  bypass, the billing-code per-row salt, the password re-auth bucket, the
  oauth-disconnect race, the webhook CSRF path narrowing, and the OAuth login-CSRF
  nonce on the `/api/v3/auth/oauth/` flow. scrypt at N=2^17 with `timingSafeEqual`.
  No `Math.random`, no `createCipher`, no homegrown crypto, no hardcoded IVs.
- **Authorization:** `getTeamResourceAccess` applied consistently across history,
  webhooks, schedules and domains; the 404-vs-403 anti-enumeration rule is uniform;
  API-key scoping enforced per method; team role ceilings hold in both directions.
  **No classic IDOR and no mass assignment was found in any of the 155 routes.**
- **Rate limiting:** Postgres-backed, so it survives deploys and multi-instance, and
  fail-closed. The atomic bucket UPSERT and the daily-counter guard hold.
  AUDIT-009#dup-01's split-brain is fixed and structurally prevented.
- **Billing:** all three credit ledgers are single-statement data-modifying CTEs with
  `ON CONFLICT` guard-inserts and `refunded_at` NULL-guards, so credit and reverse
  are atomic and exactly-once. The Stripe webhook verifies signatures, dedupes on
  `processed_stripe_events`, and rolls the idempotency marker back on handler error.
- **Injection:** all dynamic SQL is whitelist-derived; only three
  `dangerouslySetInnerHTML` sites exist and all are config-derived or escaped;
  `safeHref` is used at every sink that needs it. No reachable path traversal,
  command injection, `eval`, or prototype pollution. No secrets in the client bundle.
- **Observability:** AUDIT-010's `prodready-07` (health check) and `prodready-08`
  (push alerting) are both genuinely fixed. This run's `obs-02`/`obs-03` are about
  that alerting mechanism provably not firing, not about its absence.

Two stale notes corrected: `safeFetch` is no longer untested (18 tests, 231 lines),
and `apiRequestsPerDay: -1` does not brick Elite API keys (both the create and rotate
routes remap `-1` to `999999`).

---

## Assumptions recorded

Decisions made without asking, per instruction:

1. **`n` = 012.** `registry.json` had `nextId: 12` and `AUDIT-001..011` exist.

2. **Schema follows the brief, matching AUDIT-011.** `findings.json` is a wrapper
   object (`auditId`, `schemaNote`, `sectionsCovered`, `sectionsComplete`,
   `sectionsPartial`, `dedupeNote`, `findings`) whose `findings` array uses the
   brief's exact twelve keys. This mirrors AUDIT-011 so the eventual merged
   `report.html` is uniform across the two.

3. **Ids stay readable `<scope>-NN`,** not globally sequential, so code comments can
   reference `ref: AUDIT-012#inj-01`. Ids are unique within this audit.

4. **Two findings were merged, and their twins deliberately do not appear.** Two
   agents working different angles independently found the same two defects.
   `logic-01` was merged into `abuse-04` (unmetered scheduled scans) and `logic-02`
   into `abuse-02` (unmetered API-key crawls), keeping the section-2 id because the
   brief files quota enforcement under scan abuse. The merged findings carry the
   strongest evidence from both. `logic-01` and `logic-02` are absent by design; this
   is recorded in `findings.json`'s `dedupeNote` so the gap does not read as data
   loss.

5. **Corroboration was kept as separate findings where the consequence differs.**
   `ssrf-01` and `perf-02` are the same root cause (`lib/scanner/safe-fetch.ts:687`
   detaching the abort signal once headers arrive), found independently by two agents.
   They are filed separately because one is a hang and memory-exhaustion vector and
   the other is scan-path latency, and the fixes are judged against different budgets.
   Three agents reached that line by three different routes, which is the strongest
   evidence in this audit.

6. **Severity is judged by demonstrated consequence,** not by category. Agents were
   told to downgrade any `critical` they could not demonstrate end to end. That is
   why there is exactly one: the ReDoS chain was reproduced with measured timings, and
   nothing else in this batch could be driven to that bar.

7. **Quota bypasses are filed as `high`, not `critical`.** They cost money and defeat
   plan tiering but do not cross a tenant boundary or corrupt data.

8. **`fe-01` argues against a deliberate decision, and says so.** The root layout's
   `await headers()` carries a comment calling per-request rendering "required, not
   incidental". The finding accepts that the stated reason is real and argues the
   premise has an alternative (a sha256 CSP for a build-time-constant inline script).
   It is a proposal to revisit a decision, not a report of an oversight.

9. **Effort sizing matches AUDIT-011:** `small` = under an hour, one file.
   `medium` = a few files, half a day. `large` = a rebuild or a cross-cutting change.

10. **Read-only was taken literally.** No agent edited a file, and none were permitted
    to run `git stash` or any destructive git command. Every finding describes a fix;
    none were applied. Nothing outside `audits/` was changed.

11. **`.claude/worktrees/agent-ad8a7d09dcde23fcc/` was excluded from every search,**
    along with `node_modules/` and `.next/` source. The stale worktree holds a second
    copy of the repo at a different revision and would double-count every file. This
    was AUDIT-011's assumption 11 and it still applies. **It is still present and
    should be deleted.**

12. **Measurements come from static reading plus standalone reproduction, not from a
    running app.** No agent could deploy or execute the product. The ReDoS timings in
    `inj-01` were reproduced by running the exact regexes standalone under Node 22 and
    independently re-measured during the merge (20k chars 746ms, 40k 3.3s, 80k 16.2s,
    120k 35.8s: clean quadratic, times 74 detectors, and the detector count was
    verified as exactly 74). `inj-02`'s curve was measured the same way and completed
    after the first write of this file: 3 wildcards 1ms, 5 wildcards 45ms, 6 273ms,
    7 1.5s, 8 9.0s, and 10 wildcards against a 61-character path **2,100,597ms, 35
    minutes**, in a single `matchesRobotsRule` call. The frontend byte counts come
    from the committed `.next/`
    build dated 2026-08-25, two days behind HEAD, so they are indicative rather than
    exact for HEAD, though every mechanism was re-verified against current source.

---

## BLOCKER for the eventual report.html

**`audits/AUDIT-002/findings.json` does not parse.** Bad control character in a string
literal at line 161, column 124. Every other audit file parses cleanly
(001:20, 003:12, 004:14, 005:4, 006:6, 007:9, 008:38, 009:27, 010:41, 011:117,
012:114). The brief requires `report.html` to merge _every_
`audits/AUDIT-*/findings.json`, so AUDIT-002 must be repaired first or its 19
findings will be silently missing. It was left untouched here rather than edited,
because repairing another audit's record is the owner's call.

The merge will also need to normalise two schemas: AUDIT-001 through 010 use the
older repo-local shape (`scope`/`summary`/`files`/`fix`), while AUDIT-011 and 012 use
the brief's twelve-key shape.

---

## Recommended next batch

**Sections 12, 11, 10, 16**, the database / dependencies / tests / dead-code cluster.
They share a reading path the way this batch did: 12 and 16 both walk the schema and
the query layer, 10 and 11 both walk `package.json` and `tests/`. This batch already
produced three incidental section-12 findings (missing indexes) and one section-10
finding (a coverage gap) that a dedicated pass should extend rather than rediscover.

Sections 13, 14, 15, 18, 19, 20 would then close the brief, together with the
unfinished halves of 5, 6 and 7 from AUDIT-011.
