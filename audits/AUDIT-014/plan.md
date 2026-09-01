# AUDIT-014 — Plan

**Created:** 2026-08-28
**Title:** Closing batch: build/deploy, documentation, hardcoded values, accessibility
and states, discoverability, competitive gaps, plus the unfinished halves of design,
the scanning page, and quality of life
**Status:** **COMPLETE.** This audit closes the twenty-section brief.

---

## What this run covered

Nine sections in one audit: **5, 6, 7, 13, 14, 15, 18, 19, 20.** Sixteen agents,
307 findings after dedupe.

Sections 5, 6 and 7 were left PARTIAL by AUDIT-011 when its second wave was cancelled
mid-run. Sections 13, 14, 15, 18, 19 and 20 had never been touched. All nine are now
complete, and **all twenty sections of the brief are done.**

---

## How this run was executed

**Two passes.** The first dispatched sixteen agents and was halted by the owner after
one completed. The remaining fifteen were re-dispatched from briefs preserved verbatim
in `agent-briefs/`, which is why the restart was exact rather than approximate.

| Agent | Section | Scope | Findings |
|---|---|---|---|
| `host` | 13 | self-host verification, Dockerfile, compose, first-run | 12 |
| `ci` | 13 | pipeline secrets, gating, auto-merge, release and publish | 19 |
| `apidoc` | 14 | 155 routes vs docs vs openapi, every code sample | 33 |
| `doc` | 14 | README, CONTRIBUTING, SECURITY, env vars, dead links | 22 |
| `hc` | 15 | domains, emails, ports, paths, third-party ids | 15 |
| `magic` | 15 | timeouts, limits, expiries, flags, copy strings | 21 |
| `a11y` | 18 | labels, keyboard, focus, ARIA, computed contrast | 19 |
| `state` | 18 | empty, loading, error and forbidden states | 19 |
| `seo` | 19 | metadata inventory, canonicals, sitemap, JSON-LD, previews | 24 |
| `mkt` | 19 | value prop, copy, CTAs, screenshots, README | 15 |
| `comp` | 20 | two ranked lists against a verified competitor set | 18 |
| `dsn` | 5 | conformance of 71 app pages against the design language | 22 |
| `dsnx` | 5 | emails, report renderers, extension, error pages, docs | 15 |
| `scanui` | 6 | timer removal, replacement proposal, page rebuild | 10 |
| `qols` | 7 | admin restructure, information hierarchy | 18 |
| `qolf` | 7 | flows, shortcuts, confirmation, feedback, mobile density | 33 |

---

## Results

**307 findings: 3 critical, 45 high, 154 medium, 86 low, 19 info.** 159 distinct files
cited. Sorted severity-descending as the brief requires.

| Section | Findings |
|---|---|
| 5 Design consistency | 37 |
| 6 The scanning page | 10 |
| 7 UI quality of life | 49 |
| 13 Build and deploy | 31 |
| 14 Documentation | 54 |
| 15 Hardcoded values | 36 |
| 18 Accessibility and states | 35 |
| 19 Discoverability and marketing | 37 |
| 20 Competitive gaps | 18 |

### The three criticals are one story

All three are section 13, and together they mean **a self-host cannot be stood up at
all**, at three independent layers:

1. **`ci-01`** `docker-compose.yml:53` pins `ghcr.io/vulnradar/vulnradar:3.0.0`, but
   `docker-publish.yml:40` tags from `${GITHUB_REF_NAME}`, so every published tag is
   `v`-prefixed. There is no bare `3.0.0` in GHCR. `docker compose up -d` fails on
   `manifest unknown` before anything else is reached.
2. **`host-01`** If the image did pull, `instrumentation.ts:105` finds no row in
   `vulnradar_schema_meta` on an empty database and calls `process.exit(1)` at `:143`,
   before the 2,900 lines of `CREATE TABLE` at `:279`. The only two writers of that row
   are `scripts/create-fresh-db/create-fresh-db.mjs:302` and
   `scripts/migrate/_meta.mjs:69`. With `restart: unless-stopped` it crash-loops.
   Four docs pages assert schema auto-creation.
3. **`host-02`** The documented recovery, `docker compose exec app npm run db:create`,
   cannot work either: `Dockerfile:75-79` copies exactly five paths and `scripts/` is
   not one of them. **The container tells the operator to run a script that is not in
   the container.** The same omission breaks `db:migrate`, the admin Backup button
   (`lib/backup/run-backup.ts:33`) and the self-updater's migrate step
   (`lib/updater/apply.ts:353`). `hc-04` adds that `lib/` is not copied either, so the
   AI context routes read `.md` files absent from every published image.

`ci-04` explains how all three shipped: **nothing in CI ever builds the Dockerfile or
boots against Postgres.** `ci-02` explains why nothing stopped them: `main` is
unprotected, `required_status_checks.enforcement_level` is `off`, and not one CI job
is a required check, so every "must block merges" comment in `ci.yml` is false.

### Findings that stand out below critical

- **`magic-02` (high), a data-loss bug.** `/history`'s delete-all confirmation states
  `scans.length`, which the API caps at 100 (`CONFIG_HISTORY_LIST_MAX_ROWS`), while the
  handler runs an unbounded `DELETE FROM scan_history WHERE user_id = $1`. A user with
  400 scans is told 100 and irreversibly loses 400.
- **`state-01` (high).** `ScanResult.incomplete` is computed, persisted, typed and
  threaded to every surface, and **rendered by nothing**. Its own doc comment states
  the contract the UI breaks. A timed-out DNS or TLS branch makes a scan print
  "Nothing exploitable found". `state-02` shows the upstream half: a *rejected* branch
  is recorded as complete at full confidence. On a security product, a partial scan
  displayed as a clean bill of health is the worst failure mode available.
- **`qols-10` (medium).** The dashboard's headline risk number is
  `SUM((summary->>'critical')::int)` across every scan, so fixing a vulnerability and
  rescanning makes the number go up.
- **`qols-09` (medium).** `cvssScore` and `cvssVector` are computed and stored on every
  finding and rendered in zero places repo-wide, so the report cannot say what to fix
  first past the severity band.
- **`apidoc-01` (high).** Commit `d0c815f7` removed the `probes` request field and
  touched no docs. It is still the headline example in the API reference, both code
  samples, the OpenAPI spec and the compiled AI knowledge. Its replacement,
  `portScan`, is documented nowhere.
- **`mkt-01` (high).** No visitor can scan their own URL: `app/demo/page.tsx:38`
  hardcodes `window.location.origin` while the endpoint accepts any URL, and roughly
  780 SEO pages funnel their only CTA into that demo.
- **`seo-01` (high).** `robots.txt` disallows `/shared/` and `/host/` for
  `User-agent: *` with no exemption group, so Twitterbot, facebookexternalhit and
  Slackbot refuse to fetch a shared report and it unfurls with no preview at all, on a
  product whose sharing is a core feature.
- **`dsn-01` / `a11y-01` (high).** Light and dark share one value per accent token, so
  the medium severity badge measures 1.66:1 in light mode and every severity label
  fails AA, while `/legal/accessibility` publishes a WCAG 2.1 AA claim. Separately
  `--ring` is byte-identical to `--primary` and the only focus indicator is
  `ring-inset`, so keyboard focus on every primary CTA is a 1.00:1 ring on its own
  fill.
- **`hc-01` (high).** All 29 `tier: "build"` admin settings are written to
  `system_settings` and read by nothing, while the admin banner promises they apply
  "after the next build and deploy".
- **`doc-01` (high).** Four docs pages tell a fresh self-hoster to run
  `UPDATE users SET role = 'admin'`, which *demotes* the auto-provisioned
  `super_admin` created at `lib/auth/auth.ts:284`, and no UI can restore it.
- **`doc-04` (high).** `.github/SUPPORT.md:19` tells bug reporters to delete
  `package-lock.json` and run `npm install`, which is exactly the operation that
  strips the Linux native bindings and breaks CI and the Docker build. No doc warns
  about it.

### Section 20's verdict

The two verifications requested in the agent brief both **inverted** the salvaged
research's conclusions, which is the clearest argument for the verify-before-filing
rule in this audit. SARIF export already exists and is complete
(`lib/reports/sarif-report.ts`), as does a six-framework compliance crosswalk, and
authenticated scanning already exists in three modes. Had those been taken from the
research at face value, section 20 would have shipped two false headline gaps. Five of
the seven gaps hypothesised in a previous session are closed in `comp-18`.

The agent takes a deliberate position in `comp-17`: **do not compete on agentic
pentesting**, because it would cost the product its own headline claim ("no model in
the detection path", `landing-features.tsx:26`) and needs unattended exploitation
infrastructure this codebase has structurally refused. `comp-16` records container,
IaC, cloud, IAST and an internal scanning agent as permanent non-goals with reasons.

---

## Assumptions recorded

1. **`n` = 014**, continuing from `registry.json`'s `nextId`.

2. **Schema follows the brief**, matching AUDIT-011 through 013: a wrapper object whose
   `findings` array uses the brief's exact twelve keys.

3. **Eight ids are intentionally absent.** Seven defects were each found independently
   by two agents and merged into whichever finding carried stronger evidence:
   `a11y-02` and `a11y-03` into `dsn-01`, `a11y-04` into `dsn-02`, `mkt-12` into
   `dsnx-12`, `mkt-03` into `comp-01`, `qols-15` into `qolf-01`, `qols-05` into
   `qolf-28`, and `doc-18` into `ci-16`. Each survivor carries the other's distinct
   evidence, and this is recorded in `findings.json`'s `dedupeNote`.

4. **Four findings were re-typed.** `mkt-14`, `mkt-15`, `state-17` and `state-19`
   arrived with `type: "info"`, which is a severity, not a member of the brief's type
   enum. They were remapped by subject to `seo`, `design`, `ux` and `ux`. Their
   severities were untouched.

5. **Independent corroboration was kept as evidence, not merged away, where the
   consequence differs.** Two agents computed light-mode contrast with separate
   calculators and both arrived at 1.66:1 for the medium severity badge; that agreement
   is recorded inside `dsn-01` rather than discarded. `a11y-01` stays separate from
   `dsn-01` because the focus-ring defect has a different mechanism and a different fix.

6. **Fifteen headline claims were re-verified by hand at merge**, not taken on trust:
   the three criticals (compose tag versus published tags, the `process.exit(1)` before
   table creation, the five-path `COPY` list), the unbounded history DELETE against the
   100-row display cap, `incomplete` having zero render sites, `cvssScore` having zero
   `.tsx` hits, the dashboard `SUM`, the deleted `probes` field with commit `d0c815f7`
   confirmed, `--primary` and `--ring` byte-identical in both theme blocks, the
   `/shared/` and `/host/` disallow with no social-crawler exemption, the demo page's
   hardcoded origin, the landing FAQ's extension claim against live store URLs, the PDF
   font declared with no `/Encoding`, the 29 build-tier settings, and SARIF plus
   authenticated scanning already existing.

7. **One agent claim was softened at merge.** `hc-01` stated that not one of the 157
   runtime-resolved keys is build-tier; `APP_URL` has one `getSetting` call site. The
   substance holds for `APP_NAME`, `LOGO_URL` and `FOOTER_TEXT`, which have none.

8. **One error in my own agent brief is recorded here.** The brief told agents the
   product has "~310 checks", taken from CLAUDE.md's illustrative
   `TOTAL_CHECKS_LABEL` value. The real figure is `EXACT_CHECK_COUNT = 797`
   (`lib/config/check-stats.generated.ts:6`), auto-generated into
   `CONFIG_TOTAL_CHECKS_LABEL`, so the app's own label is correct and no finding
   depends on the wrong number. `seo-19`, `dsnx-12` and `mkt-12` independently found
   surfaces that state stale counts.

9. **Severity means user-facing damage in the proposal sections**, per AUDIT-011's
   assumption 6. A page unusable on mobile is `high`; ugly but usable is `low`. A
   proposal for something that does not exist yet is `medium` at most, typed `gap` or
   `opportunity`, unless its absence actively costs the business today.

10. **Nothing could be executed.** `docker` and `psql` are absent and no build was
    permitted, so every claim is derived from reading source, config, lockfiles, the
    committed `.next` output and git history. Where an agent used the network it was
    read-only and is stated in the finding. The self-host verdict in particular is a
    static trace, and says so.

11. **Read-only was preserved.** No agent edited a repo file. Nothing outside
    `audits/` was changed by this run.

12. **`.claude/worktrees/agent-ad8a7d09dcde23fcc/` is still present and should be
    deleted.** Fifth consecutive audit to record it.

13. **`doc-02`, the origin-IP disclosure, was remediated during the run at the owner's
    direction, and is the one exception to assumption 11.** The owner chose to replace
    the address rather than rotate the origin. `SECURITY-POSTURE.md:131` and `:163` now
    carry `203.0.113.10`, an RFC 5737 documentation address, labelled in place as an
    example and explicitly not the real origin. **That edit is the only change this
    audit made outside `audits/`, and it was explicitly requested.** The finding was
    downgraded from `high` to `low` and retained rather than deleted, because the real
    address is still recoverable from git history and from every existing clone and
    fork: the edit removes the signpost, not the exposure. The recommendation was
    rewritten to the fix that does not depend on secrecy and makes the history
    exposure moot, which is restricting the origin firewall to Cloudflare's published
    ranges or fronting it with a Tunnel. Rewriting history to drop the original commit
    was offered and deliberately not done: a force push to a public repository breaks
    every existing clone and fork while the value survives in those copies anyway.

---

## The brief is now complete

All twenty sections are done across four audits.

| Audit | Sections | Findings |
|---|---|---|
| AUDIT-011 | 3, 4, 8 complete; 5, 6, 7 partial | 117 |
| AUDIT-012 | 1, 2, 9, 17 | 114 |
| AUDIT-013 | 10, 11, 12, 16 | 114 |
| AUDIT-014 | 5, 6, 7, 13, 14, 15, 18, 19, 20 | 307 |
| **Total** | **all 20** | **652** |

---

## BLOCKER before report.html can be built

**`audits/AUDIT-002/findings.json` still does not parse.** Bad control character in a
string literal at line 161, column 124. Every other file parses: 001:20, 003:12,
004:14, 005:4, 006:6, 007:9, 008:38, 009:27, 010:41, 011:117, 012:114, 013:114,
014:307. The brief requires `report.html` to merge **every**
`audits/AUDIT-*/findings.json`, so AUDIT-002 must be repaired first or its 19 findings
will be silently missing from a report that claims to be complete.

It has been left untouched across three audits because repairing another audit's record
is the owner's call. **This is now the only thing standing between this work and the
final report.**

The merge will also need to normalize two schemas: AUDIT-001 through 010 use the older
repo-local shape (`scope`/`summary`/`files`/`fix`), while 011 through 014 use the
brief's twelve-key shape. The brief's spec for the report: a single self-contained
page, colour-coded by severity, grouped by type with filter buttons, showing file:line
refs and a summary count broken out per type and per section, with the merged JSON
inlined rather than fetched.
