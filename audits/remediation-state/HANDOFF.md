# Remediation handoff

**Stopped for the night at ~90% usage, deliberately, not because anything broke.**
The repo is left green: `npx tsc --noEmit` exits 0 and the full suite passes.

---

## Where things stand

Everything ships as **one release, 3.8.0**. There is a single changelog block
in `lib/changelog/data.ts`; the compiled AI copy is regenerated.

|                                |          |
| ------------------------------ | -------- |
| Findings open at session start | **802**  |
| Closed                         | **~275** |
| Remaining                      | **~527** |

Exact remaining counts by severity are recomputed by the snippet at the bottom
of this file. Do not trust a number quoted from memory: several audits are old
and later work closed things without updating the record, so the only honest
count comes from re-checking.

---

## How the work is organised

Two rounds of parallel agents, each owning a disjoint set of file paths so no
two could edit the same file.

- `AGENT-RULES-round1.md` and `AGENT-RULES.md` are the exact briefs the agents
  were given. Reuse them verbatim; they encode the rules that kept this safe.
- `schema.json`, `frontend.json`, `scanner.json`, `backend.json`, `config.json`,
  `misc.json`, `admin.json`, `docs.json`, `email-ext.json` are the per-bucket
  finding lists. **These were generated before round 2 ran**, so they still
  contain findings that round 2 closed. Regenerate them (snippet below) rather
  than working from them directly.
- `changelog-*.json` are the per-agent changelog fragments. Everything in them
  has already been merged into `lib/changelog/data.ts`; they are kept only as a
  record.

### Why the buckets exist

Eight agents editing one repo will collide on two things: the same source file,
and `lib/changelog/data.ts`. The buckets solve the first (explicit ownership,
with agents told an out-of-boundary edit will be lost). Fragment files solve the
second: agents never touch the changelog, they write a fragment and the
coordinator merges with validation (icon must be imported, category must be in
the enum, no em dashes, duplicate labels dropped).

---

## Round 2 was interrupted mid-flight

Six agents were stopped part-way. Their completed work is kept; the partial work
was left in place **only where it typechecks and tests pass**. Two files needed
repair afterwards, both done:

1. **`instrumentation.ts`** was left mid-edit adding a boot-time advisory lock
   (`migrate-11`: two instances booting at once both run schema creation). The
   logic was sound; it failed to compile because `pg` types `connect` with both
   a promise and a callback overload and `ReturnType` picks the callback one,
   which returns `void`. Fixed by naming the client type explicitly.

2. **Two test files** asserted behaviour that had legitimately changed:
   - `tests/scripts/migrate/versions/2.0.0-to-3.0.0.test.ts` asserted the
     upgrade adds **18** tables. The schema agent added the missing ones, so it
     is now **31**. That is the `migration-01` fix working, not a regression.
   - `tests/app/api/v3/auth/2fa/backup-codes/route.test.ts` broke because
     re-auth moved into `lib/auth/reauth.ts`, which runs its own
     `SELECT password_hash`. Added both query branches to the mock rather than
     mocking the module, so the real re-auth logic stays under test.

   Neither assertion was weakened.

---

## What to do next session

1. **Regenerate the buckets** (snippet below), then re-launch agents with the
   same briefs. Round 2's buckets are stale.
2. **Finish `migration-01`.** The schema agent added the missing tables but was
   stopped before completing the second half, which matters more: the guard is
   still a hand-maintained `expect.arrayContaining` list that never reads
   `instrumentation.ts`. AUDIT-009 rated this critical, a comment in
   `scripts/migrate/versions/2.0.0-to-3.0.0.mjs:57` claims it was closed "for
   good", and AUDIT-013 found it re-opened at ~3x the size. **It will drift
   again unless the guard is derived from `instrumentation.ts` itself.** Same
   applies to `create-fresh-db` silently omitting tables from its data copy.
3. **Verify before fixing, every time.** Round 1 found 21 scanner findings and
   7 backend findings already correct. Two of the seven "remaining criticals"
   turned out to be already fixed, and one (`ck-01`) turned out to be a live
   billing bug that the audit had described accurately but nobody had actioned.

---

## Blocked on you, not on code

- **`ci-02` / `ci-03`**: `main` has no branch protection and no required status
  checks, so the `selfhost` CI job added this session reports but cannot block,
  and dependabot auto-merge can land unreviewed. This is a GitHub repository
  setting needing admin. Until it is set, nothing mechanically stops a
  regression.
- **`AUDIT-014#doc-02`**: the origin IP was replaced with an RFC 5737
  documentation address at your direction. The real value is still in git
  history. The durable fix is firewalling the origin to Cloudflare's published
  ranges, which makes the disclosure moot.
- **Extension store screenshots** still claim "700+ checks" against a real 797.
  No source file exists to regenerate them.

---

## Regenerating the remaining-findings buckets

`audits/merged-findings.json` is the machine-readable source (843 findings from
14 audits, normalised). To recompute what is genuinely open, cross-check each
candidate against the current code rather than trusting the record: the fastest
honest approach is to re-run the bucketing, hand each bucket to an agent, and
require the agent to verify at the cited `file:line` before acting. That is what
produced the "already correct" counts above, and it is why the numbers here are
approximate rather than exact.

The bucketing predicate used both rounds:

```
instrumentation.ts | scripts/migrate | scripts/create-fresh-db | lib/database  -> schema
app/docs | README | CONTRIBUTING | SECURITY | AGENTS | CLAUDE | SUPPORT        -> docs
lib/scanner | lib/api/openapi-spec                                            -> scanner
app/admin | components/admin | app/api/v3/admin                               -> admin
lib/email | lib/reports | extension                                           -> email-ext
lib/config | .env | Dockerfile | docker-compose | .github | *.config          -> config
app/api | lib/                                                                -> backend
app/ | components/ | middleware                                               -> frontend
```

---

## Standing rules, do not lose these

- **Never run a writing npm command.** `npm install`, `ci`, `update`,
  `audit fix`, `dedupe`, `prune`, and every `pnpm`/`yarn` command. A
  Windows-regenerated `package-lock.json` strips the Linux native bindings and
  breaks CI and the Docker build. `npm run <script>` is fine.
- **`.claude/worktrees/agent-ad8a7d09dcde23fcc/`** is a stale duplicate checkout
  and should be deleted. Six audits have now recorded it.
- The test suite has a completeness guard
  (`scripts/vitest-completeness-reporter.mjs`): a run that collects fewer test
  files than exist on disk now fails instead of passing quietly. It has already
  caught several silent short runs. Do not disable it. If a run reports
  `INCOMPLETE TEST RUN`, re-run rather than trusting the result.
