# AUDIT-013 — Plan

**Created:** 2026-08-28
**Title:** Database and migrations, dependencies, tests, consistency and dead code
**Status:** in_progress (batch 3 of N)
**Batch:** sections 12, 11, 10, 16, the batch AUDIT-012's closing note recommended.

---

## Why these four

They share a reading path, the way the previous two batches did. Sections 12 and 16
both walk the schema and the query layer; 10 and 11 both walk `package.json`, the CI
config and `tests/`. Auditing them together costs far less than auditing any two of
them apart.

This batch is also the first to look at the project's *safety net* rather than its
product surface. Sections 1, 2, 9 and 17 (AUDIT-012) asked whether the code is
correct. This one asks whether anything would catch it if it stopped being correct.
The answer, in several places, is no, and that is the theme running through the
findings.

---

## How this run was executed

Eight subagents in parallel, each with a disjoint file scope:

| Agent | Section | Scope |
|---|---|---|
| `schema` | 12 | all tables in `instrumentation.ts`: FKs and `ON DELETE`, nullability, UNIQUE/CHECK, types, full index audit |
| `migrate` | 12 | migration runner, the three schema sources, populated-DB failure, rollback, boot concurrency, repair and backup tooling |
| `deps` | 11 | root manifest: CVE reachability, outdated, abandoned, unused, misplaced, install weight, supply-chain posture |
| `subdeps` | 11 | `cli/`, `extension/`, `marketing/`, cross-manifest drift, tracked-artifact check |
| `cov` | 10 | a real coverage run, untested paths ranked by failure cost, regression tests for prior audit fixes |
| `tq` | 10 | tests that assert nothing, tests that pass with the feature removed, over-mocking, flaky patterns, CI wiring |
| `dead` | 16 | import graph, unused exports, unreachable branches, built-but-unreachable features, TODOs |
| `dup` | 16 | already-drifted duplicate logic, duplicate UI primitives, error and success shape inventory, config surfaces |

Every agent read prior findings in its area first and was required to confirm each
finding at a live `file:line`. Output was machine-validated: schema keys, enum values,
duplicate ids, severity sort, and the existence of every cited file and line. Fifteen
headline claims were then re-verified by hand at the merge step (see assumption 8).

---

## Section status, as delivered

114 findings: 0 critical, 15 high, 41 medium, 47 low, 11 info. Sorted
severity-descending. 72 distinct files cited.

| # | Section | This run | Status | Findings |
|---|---|---|---|---|
| 1 | Correctness and security | AUDIT-012 | complete | 37 |
| 2 | SSRF and scan abuse | AUDIT-012 | complete | 22 |
| 3 | Client-visible breakage | AUDIT-011 | complete | 38 |
| 4 | UI fixes, mobile and desktop | AUDIT-011 | complete | 27 |
| 5 | Design consistency | AUDIT-011 | **PARTIAL** | 6 |
| 6 | The scanning page | AUDIT-011 | **PARTIAL** | 8 |
| 7 | UI quality of life | AUDIT-011 | **PARTIAL** | 4 |
| 8 | Backend / frontend capability drift | AUDIT-011 | complete | 26 |
| 9 | Performance | AUDIT-012 | complete | 44 |
| 10 | Tests | yes | **COMPLETE** | 30 |
| 11 | Dependencies | yes | **COMPLETE** | 28 |
| 12 | Database and migrations | yes | **COMPLETE** | 30 |
| 13 | Build and deploy | no | outstanding | 2 (incidental) |
| 14 | Documentation | no | outstanding | 2 (incidental) |
| 15 | Hardcoded values | no | outstanding | none |
| 16 | Consistency and dead code | yes | **COMPLETE** | 26 |
| 17 | Error handling and observability | AUDIT-012 | complete | 11 |
| 18 | Accessibility and states | no | outstanding | none |
| 19 | Discoverability and marketing surface | no | outstanding | none |
| 20 | Competitive gaps | no | outstanding | none |

**Sections still outstanding: 13, 14, 15, 18, 19, 20, plus the unfinished halves of
5, 6 and 7 from AUDIT-011.** Fourteen of twenty sections are now complete.

---

## The theme of this batch

Three independent agents, looking at different things, arrived at the same structural
conclusion: **the test suite is large, disciplined, and green, and it is not
load-bearing where it matters most.**

- 10,158 tests pass in 89 seconds with 79.35% statement coverage on the measured set.
- But `vitest.config.ts:31` measures only `lib/**/*.ts` and `app/**/*.ts`, which
  matches no `.tsx`, so 419 React files and roughly 95,000 lines are outside the
  denominator entirely, and `environment: "node"` means no component could render
  even if someone wrote a test for one.
- The SSRF guard and the access blocklist are hard-stubbed permanently permissive in
  all three scan-route suites (`tests/app/api/v3/scan/route.test.ts:72` and its
  siblings). Deleting `validateScanTarget` from the route source leaves the suite
  green. Verified by hand at merge.
- Not one of the 10,158 tests bounds execution time or input size, and no test
  asserts that a scan path charges quota. Those are precisely the two bug classes
  AUDIT-012 found: the critical ReDoS and all four unmetered scan paths shipped green.
- The per-file coverage thresholds exist, `tests/README.md` tells contributors they
  fail the build, and no CI job runs them. The gate command is also currently red.

That is a coherent story rather than a list of complaints: the suite was built to
cover pure helpers, and the integration seams where this product's real defects live
are structurally outside it.

The second theme is **the schema has three sources that disagree**, which reopens a
prior critical (see below).

---

## Notable: a prior critical has regressed

`AUDIT-009#migration-01` was rated **critical**: "Versioned v3.0.0 upgrade path is
missing 4 tables and ~25 columns that instrumentation.ts creates." The fix carries a
comment at `scripts/migrate/versions/2.0.0-to-3.0.0.mjs:57` reading "Added below to
close that gap for good" (verified verbatim at merge).

It has re-opened at roughly three times the original table count. `migrate-01` finds
the versioned upgrade path now reaches 52 app tables while boot-time
`instrumentation.ts` creates 63: **11 tables and 8 columns exist only on the boot
path**, and the migration still stamps `schema_version=3.0.0` on completion. The
mechanism is that the guard is a hand-maintained `expect.arrayContaining` list that
never reads `instrumentation.ts`, and the registry's documented post-migration
fingerprint verification does not exist in code.

It is filed `high` rather than `critical` because boot-time catch-up masks it for any
instance that actually boots the app, so no user data is lost in the normal path. The
recommendation is to replace the hand-maintained list with a check derived from
`instrumentation.ts` itself, so the two cannot drift again.

---

## Verified-good, recorded so a future run does not redo it

- **Zero known vulnerabilities.** `npm audit` reports 0 findings at every severity
  across 813 root packages and 0 in the extension's 194. Nothing is deprecated, every
  `resolved` URL is registry.npmjs.org, and only three packages in the tree have
  install scripts. Section 11's risk here is weight and inert config, not CVEs.
- **The extension is clean on the things that matter for an extension:** no `eval`,
  no `new Function`, no `innerHTML`, no CDN references, no remote code, no CSP
  override, and all six declared permissions have real call sites. `fetch` targets
  only `https://vulnradar.dev`, matching `host_permissions` exactly.
- **The CLI is dependency-free** and does not reach into the app runtime.
- **`marketing/` is standalone and not deployed**, so its large Remotion tree carries
  no production risk. Stated explicitly because it changes the severity of everything
  found there.
- **Test hygiene is genuinely good:** zero `.only`, `.skip`, `.todo` or `xit` anywhere
  in 4,494 test blocks, zero snapshots, zero live third-party hostnames, zero
  swallowing try/catch in a test body, zero self-mocking suites, and exactly one
  assertion-free block (a deliberate smoke test). Env mutation is save/restored.
- **Dead code is a small surface.** All 157 API routes have a caller, all 754
  `checks-data` ids can fire, all five periodic workers are registered, and every one
  of the 252 `lib/` files reaches an entry point. Exactly one fully orphaned source
  file exists. There are **zero** actionable TODO/FIXME/HACK markers (all 14 matches
  are the scanner's own detection patterns or `XXXXX` display placeholders) and **no**
  commented-out code anywhere.
- **No config split-brain.** The four config surfaces have zero duplicated exports and
  all 271 registry defaults derive from `CONFIG_*` constants, so `AUDIT-009#dup-01`
  has not recurred. All seven paginated routes share one `page`/`limit` convention.
- **No `ADD COLUMN NOT NULL` without a default** anywhere in the migration steps, and
  every step is idempotent, so re-running a failed migration is safe.
- Auth coverage is genuinely strong (most of `lib/auth/` at 88 to 100 percent), and
  DNS rebinding, TOTP replay and credit reversal all have real regression tests.

---

## Assumptions recorded

1. **`n` = 013.** `registry.json` had `nextId: 13` and `AUDIT-001..012` exist.

2. **Schema follows the brief, matching AUDIT-011 and AUDIT-012.** Wrapper object with
   `auditId`, `schemaNote`, `sectionsCovered`, `sectionsComplete`, `sectionsPartial`,
   `dedupeNote`, `findings`; the array uses the brief's exact twelve keys.

3. **Two findings were merged and their twins deliberately do not appear.**
   `migrate-16` was merged into `dead-04` (the unreachable legacy migrator) and
   `tq-02` into `cov-08` (the unenforced coverage gate), keeping whichever id carried
   the stronger evidence and folding in the other's distinct proof. Recorded in
   `findings.json`'s `dedupeNote` so the gap does not read as data loss.

4. **A line count was corrected during the merge.** Two agents reported
   `_legacy-original.mjs` as 872 and 871 lines. It is 871, verified with `wc -l`. The
   merged finding says 871.

5. **My own pre-flight count was wrong and the agent's is authoritative.** I told the
   agents `instrumentation.ts` holds 72 `CREATE TABLE`; a raw grep counts 66 and the
   real number of `CREATE TABLE IF NOT EXISTS` statements is 63 to 64 depending on
   whether commented mentions are included. The schema agent derived 64 and the
   migration agent 63 (app tables, excluding a system table). Findings use the agents'
   derived numbers, not my grep.

6. **Severity is judged by demonstrated consequence.** There is no `critical` in this
   batch. The strongest candidate, the migration schema drift, is masked by boot-time
   catch-up in the normal path, so it is `high`. Dead code is `low` unless actively
   misleading.

7. **Deletions are inventoried, never applied or presumed approved.** The dead-code
   agent proposes 1,341 lines across six items, each itemized by file and line range
   so they can be approved or rejected individually. The product owner has previously
   required explicit approval before deletions and that rule was passed to the agent.

8. **Fifteen headline claims were re-verified by hand at the merge step** rather than
   taken on trust: the unclaimed `npm view vulnradar` 404 and its `/docs/cli`
   advertisement, the `staff_invites` DDL running outside the schema file, the "close
   that gap for good" comment, `vitest.config.ts`'s `.ts`-only coverage include, the
   permissive `validateScanTarget` stub with no negative case, the eight streaming
   reader copies and their guard counts, the `_legacy-original.mjs` line count and its
   broken `./_lib.mjs` import, the underscore filter in `listVersionFiles`, and the
   genuinely-unused AI SDK and `jsonwebtoken` (both `jsonwebtoken` hits are scanner
   detection strings, not imports).

9. **Read-only was taken literally for repo files.** No agent edited anything. The
   coverage agent ran `vitest run --coverage`, which is allowed because `coverage/` is
   gitignored and the run does not dirty the tree; that produced the real numbers used
   throughout section 10. No writing npm command was run by any agent, per the
   lockfile landmine below.

10. **The npm lockfile landmine was a hard rule.** `npm install`, `ci`, `update`,
    `audit fix`, `dedupe`, `prune` and every `pnpm`/`yarn` command were forbidden by
    name, because a Windows-regenerated `package-lock.json` strips the Linux native
    bindings and breaks CI and deploy in this repo. Only `npm audit`, `outdated`,
    `ls` and `view` were permitted. No agent reported running a writing command and
    `git status` is unchanged apart from `audits/`.

11. **`.claude/worktrees/agent-ad8a7d09dcde23fcc/` was excluded from every search,**
    along with `node_modules/` (including `marketing/node_modules/`), `.next/`,
    `coverage/` and `graphify-out/`. The stale worktree is **still present and should
    be deleted**; this is the third audit in a row to record it.

12. **The `/checks` pages were protected from the dead-code sweep by explicit
    instruction.** The ~750 SEO pages are deliberate and were listed as
    do-not-delete, along with `marketing/`, `audits/`, and the intentional
    `2.0.0-to-1.0.0` downgrade path, so the agent would not propose removing the SEO
    surface. The agent independently confirmed all 754 check ids can fire.

13. **One prior finding's stated mechanism was corrected, not re-filed.**
    `AUDIT-012#fe-13` said `vitest` in `dependencies` bloats the production install
    via `--omit=dev`. The deps agent found `Dockerfile:24` never passes `--omit=dev`
    and `Dockerfile:77` copies the whole tree, so dev dependencies ship regardless.
    The correction lives in `deps-02`, which cites and supersedes the mechanism.

14. **Nothing outside `audits/` was changed.**

---

## Still blocking the eventual report.html

**`audits/AUDIT-002/findings.json` still does not parse** (bad control character at
line 161, column 124). Every other audit file parses: 001:20, 003:12, 004:14, 005:4,
006:6, 007:9, 008:38, 009:27, 010:41, 011:117, 012:114, 013:114. The brief requires
`report.html` to merge every `audits/AUDIT-*/findings.json`, so AUDIT-002 must be
repaired first or its 19 findings will be silently missing. Left untouched again,
because repairing another audit's record is the owner's call.

The merge will also need to normalize two schemas: AUDIT-001 through 010 use the older
repo-local shape (`scope`/`summary`/`files`/`fix`), while 011, 012 and 013 use the
brief's twelve-key shape.

---

## Recommended next batch

**Sections 13, 14, 15** plus **18**: build/deploy, documentation, hardcoded values,
and accessibility. The first three share a reading path through the Dockerfile, CI
config, `lib/config/`, and `docs/`, and this batch already left four incidental
findings there (two deploy, two docs) that a dedicated pass should extend. Section 13
in particular has a concrete falsifiable claim to test, exactly like section 6 did:
the brief asks whether a clean self-host actually works from a fresh checkout with
just the Dockerfile and a Postgres string, and `migrate-02` (db:create omits 33 of 63
tables) suggests the answer may be no.

That would leave only 19 and 20, plus the unfinished halves of 5, 6 and 7, before
`report.html` can be built.
