# Audit remediation tracker

Working through the 802 open findings from `audits/report.html`
(`audits/merged-findings.json` is the machine-readable source).

**Method.** Fix in priority order, in batches that make a coherent release.
Every batch: fix, typecheck, run the affected tests, add a changelog entry per
user-visible change, `npm run changelog:compile`, bump the version.

**Never** run a writing npm command (`npm install`, `ci`, `update`, `audit fix`,
`dedupe`, `prune`, or any `pnpm`/`yarn`). A Windows-regenerated lockfile strips
the Linux native bindings and breaks CI and the Docker build. `npm run <script>`
is fine.

---

## Progress

Everything ships as **one release, 3.8.0**, with a single changelog entry. The
batches below are working order, not separate versions.

| Batch | Findings closed | Status |
|---|---|---|
| 1. Self-host + result honesty | 8 | **done** |
| 2. ReDoS family + CI gap | 4 | **done** |
| 3. Quota and metering | 4 | **done** |
| 4. Honest numbers | 3 | **done** |
| 5. Contrast, focus, skip link | 4 | **done** |
| 6. Documentation truth | 3 | **done** |
| 7. Marketing surface | 3 | **done** |
| 8. Test-suite flakes (both root-caused) | 2 | **done** |
| 9. Silent failures + confirmation | 5 | **done** |
| 10. Scanning-page timer | 1 | **done** |
| 11. Incomplete-run guard | 1 | **done** |
| 12. Docs vs enforced limits | 2 | **done** |
| 13. Self-host env, email, support address | 4 | **done** |
| 14. Eight parallel agents, partitioned by file scope | 204 | **done** |
| 15. Six parallel agents, round 2 (interrupted at 90% usage) | ~27 | **partial** |

**Open: ~527 of 802.** See  for the
restart plan, the preserved agent briefs, and the exact state of the
interrupted round-2 work. All criticals that are code-fixable are closed.

---

## Batch 1 (v3.8.0) — closed

The three criticals were one story: a self-host could not be stood up at all,
failing at three independent layers. Fixed together with the two findings that
let a scan or a confirmation dialog tell the user something untrue.

| Finding | Severity | What changed |
|---|---|---|
| `AUDIT-014#ci-01` | critical | `docker-compose.yml` pinned `:3.0.0`, a tag never published. The publish workflow tags from `github.ref_name`, so every real tag carries a leading `v`. Pinned to `v3.8.0` and documented the naming. |
| `AUDIT-014#host-01` | critical | `instrumentation.ts` exited before creating any table on an empty database. Now distinguishes an empty database (first boot: stamp the meta row and create the schema) from a populated one with no meta row (still refuses, still points at the migrator). |
| `AUDIT-014#host-02` | critical | `Dockerfile` runtime stage never copied `scripts/`, so `db:create`, `db:migrate`, the admin Backup button and the self-updater's migrate step were all absent from the image. Now copied. |
| `AUDIT-014#hc-04` | high | Same root cause: `lib/` was not copied either, so `app/api/v3/ai/context/route.ts` read its knowledge files from `process.cwd()` and silently got nothing. Now copied. |
| `AUDIT-014#host-05` | high | The app service declared no build context, so the documented `docker compose build app` upgrade was a silent no-op. Added. |
| `AUDIT-014#magic-02` | high | `/history` delete-all confirmation counted the capped page (100) while the DELETE is unbounded, so an account with 400 scans was told 100 and lost 400. GET now returns the true `total`; the header and the confirmation both use it. |
| `AUDIT-014#state-01` | high | `ScanResult.incomplete` was computed, stored and rendered by nothing, so a timed-out scan printed "Nothing found" and "Every enabled check ran". Now names the unfinished areas and asks for a rescan. |
| `AUDIT-014#state-02` | high | Upstream half: a check branch that *threw* was recorded as `timedOut: false`, i.e. completed, so it never reached the warning above. Now reported as not checked, and the error is logged instead of swallowed. |

Tests: added `total` / `truncated` assertions to the history GET suite. The
count query degrades to the page size on failure rather than 500ing the page.

Full suite after batch 1: **10,157 of 10,158 passing.** The single failure is
`tests/lib/billing/stripe.test.ts`, which passes in isolation (206/206) and
fails only in a full run. It is untouched by this batch and its own last commit
reads "cap vitest fork pool to stop worker-start flakes; harden stripe test
isolation", so it is a known-flaky isolation problem, an instance of
`AUDIT-013#tq-09`. Worth fixing properly in a later batch rather than papering
over here.

---

## Batch 2 (v3.8.1) — closed

The whole ReDoS family, plus the CI gap that let batch 1's criticals ship.

| Finding | Severity | What changed |
|---|---|---|
| `AUDIT-012#inj-01` | **critical** | `maskPlaceholderSecrets` wrapped its marker alternation in a greedy `[A-Za-z0-9_-]*`, so it retried from every offset (quadratic), and the detector wrapper ran it once per each of 74 detectors. Rewritten to find markers directly and expand outward: **30.6s to <1ms** at 120k chars, verified byte-identical output on 15 cases, plus a one-entry cache so it runs once per body rather than 74 times. |
| `AUDIT-012#inj-02` | high | `matchesRobotsRule` compiled each `*` to `.*`, exponential on a crafted rule from the *scanned site's own* robots.txt. Replaced with a non-backtracking greedy glob walk: **33.7s to 1ms** at 7 wildcards, and all 442 path/rule/anchor combinations match the old behaviour. |
| `AUDIT-012#inj-03` | high | The team's own documented bound (`[^>]* -> [^>]{0,2000}`) had been applied in two files and missed in seven. Applied to all 16 remaining multi-gap patterns. 6,370 scanner tests pass unchanged, so detection is identical. |
| `AUDIT-014#ci-04` | high | Added a `selfhost` CI job that builds the real image, asserts the files the docs tell operators to run are actually inside it, boots it against an empty Postgres, and fails unless the app goes healthy and the full schema is created. **Every batch-1 critical would have failed this job.** |

Equivalence was checked before/after for both rewrites rather than assumed;
the timing figures above are measured on this machine, not estimated. All 93
bounded regex literals were separately compiled and diffed against their
unbounded originals on realistic input: 0 invalid, 0 behaviour changes.

Full suite after batch 2: **356 files, 10,158 tests, all passing**, and the
`stripe.test.ts` flake from batch 1 did not recur. One intermediate run
collected only 353 files; re-running gave the full 356, confirming that is the
known vitest worker-start flakiness (`AUDIT-013#tq-09`) rather than anything in
these changes. Worth fixing properly: an intermittently under-collecting suite
silently reduces coverage and is indistinguishable from a green run.

---

## Batch 3 — closed

All four unmetered paths. Each defeated plan tiering and billed real compute
and third-party egress to nobody, while the usage figure the account saw read
zero.

| Finding | Severity | What changed |
|---|---|---|
| `AUDIT-012#abuse-02` | high | `execute-crawl-scan.ts` fabricated an allow-everything quota for API-key callers. The justification (the key's own limit was already checked) was wrong twice: a key limit counts *requests*, not pages, and the POST gate calls `canMakeRequest`, which only reads. Nothing incremented, so it always reported under quota. Free key: 25 crawls x 25 pages against a 25/day cap. Now charges uniformly. |
| `AUDIT-012#abuse-04` | high | Scheduled runs never checked or charged `dailyScans`. Added the charge (over quota reschedules rather than deactivating, matching the plan gate) plus a run-time `checkAccessRules` call, so a target blocklisted *after* the schedule was created stops being scanned. |
| `AUDIT-012#abuse-01` | high | `/scan/discover` was bounded only by an hourly rate limit while `forceRefresh` runs a 191-prefix DNS brute force plus up to 1000 resolutions plus probing. A forced refresh now charges one scan; a cache hit stays free since it does no outbound work. Blocklist check added. |
| `AUDIT-012#abuse-03` | high | `isContextBlock` was `content.startsWith("<context")`, forgeable by typing that literal, moving any message onto a 700k budget on a path the code calls free. Now requires the exact `<context cmd="NAME">` shape the slash commands emit, with NAME validated against `SLASH_COMMANDS`. |

**Tests added.** `AUDIT-013#cov-05` found that *no test anywhere* asserted a
scan path charges quota, which is precisely why these shipped. Three regression
tests now cover it: the quota is charged with the right arguments, an over-quota
run is skipped and rescheduled without deactivating the schedule, and a
blocklisted target is refused before any charge. They assert the call happens,
so reverting the fix fails them.

---

## Batch 4 — closed

Three places the product showed a number that was not true.

| Finding | Severity | What changed |
|---|---|---|
| `AUDIT-014#qols-10` | medium | The dashboard's "Critical and high" was `SUM(...) FROM scan_history` across every scan ever, a lifetime tally that could only grow: rescanning after a fix ADDED the new findings on top of the old, so the headline number rose as posture improved and could never reach zero. Now sums the latest scan per distinct target (`DISTINCT ON (url) ... ORDER BY url, scanned_at DESC`), so it reflects current posture and falls as issues are fixed. Response shape unchanged. |
| `AUDIT-014#qols-09` | medium | The findings list tie-broke on title within a severity band, so an actively-exploited CVE ranked no higher than a theoretical one. Now ranks KEV, then EPSS, then CVSS, then title. Also surfaced the CVSS base score in the finding detail beside the existing KEV/EPSS signals: it was computed for every finding, carried in the API response and the SARIF export, and rendered in zero places in the app. |
| `AUDIT-014#qolf-01` | high | **Partially closed.** The wrong-count half is fixed (batch 1 added the true `total`). The search half now states plainly when it is filtering a truncated list rather than silently returning "no match" for a scan that is still inside retention. **Server-side search remains open** and is the real fix; see below. |

---

## Next batches, in intended order

**Batch 4b — carried forward.** `AUDIT-014#qolf-01`'s remaining half:
history search and tag filtering still run client-side over the loaded page.
The page no longer lies about it, but finding an older scan by URL requires
server-side search, which needs a new query parameter on `GET /api/v3/history`
and pagination that works against the filtered set rather than the loaded
array. Sized `medium`, worth doing with the other history work.

## Batch 5 — closed

| Finding | Severity | What changed |
|---|---|---|
| `AUDIT-014#dsn-01` / `#a11y-02` / `#a11y-03` | high | Light and dark shared one value per accent token, tuned for the dark ground. As text on light surfaces: medium severity **1.56:1**, high 2.19, critical 2.98, links 1.99, against a published AA claim at `/legal/accessibility`. Light mode now has its own severity, warning, success, muted and link values. **Hue and saturation unchanged**, lightness lowered only as far as needed: all now clear 4.5:1, and severity fills carry white text at 6.1 to 7.1:1. Dark mode already passed and is untouched. |
| `AUDIT-014#a11y-01` | high | `--ring` was byte-identical to `--primary` and the only focus style is `ring-inset`, so focus on Sign in / Sign up / Start scan was a **1.00:1** ring on its own fill. Rather than move the whole app to an offset ring (deliberately abandoned earlier, because offset rings bleed past clipped dropdown edges), filled buttons now re-point `--ring` at `--primary-foreground`, the colour already guaranteed legible on that fill in both themes. Light `--ring` also darkened to 5.97:1 against the page. |
| `AUDIT-014#dsn-02` / `#a11y-04` | high | The global skip link targeted `#main-content`, which three shared shells never rendered: the docs shell, the SEO shell (~750 `/checks` pages, `/tools`, `/alternatives`) and the public page shell (`/host`, `/shared`). All three now carry it. |

**`--primary` deliberately unchanged.** It is a button *fill*, paired with a
near-black `--primary-foreground` at 7.06:1: a working light-blue-button
design. Darkening it would have fixed text and broken the buttons, so text got
its own `--primary-text` token, applied through a single `.text-primary`
override. That fixes ~478 call sites without touching a single fill, border or
ring. This is what `dsn-01` itself recommended.

Values were **computed, not eyeballed**: a WCAG relative-luminance calculator
reads the real tokens out of `globals.css` and reports both themes, so the
check reflects the file rather than a copy of it.

---

## Batches 6 to 8 — closed

**Batch 6, documentation truth.**

| Finding | Severity | What changed |
|---|---|---|
| `AUDIT-014#apidoc-01` | high | Commit `d0c815f7` removed the `probes` array from the scan API and updated no docs. It was still the headline example on the API reference, in the request sample, in `openapi-spec.ts` and in the compiled AI knowledge, while its replacement `portScan` appeared nowhere. All four now document `portScan`, including its verified-domain gate. |
| `AUDIT-014#doc-01` | high | Four pages told a fresh self-hoster to run `UPDATE users SET role = 'admin'`. The first account is auto-provisioned `super_admin` (`lib/auth/auth.ts:284`), a *higher* level, so the documented step demoted the only admin and no UI can restore it. All three code blocks now say the first account needs no SQL and scope the command to a later colleague. |
| `AUDIT-014#doc-04` | high | `.github/SUPPORT.md` told bug reporters to delete `package-lock.json` and `npm install`: precisely the operation that strips the Linux native bindings and breaks CI and the Docker build. Both it and `CONTRIBUTING.md` now use `npm ci` and explain the hazard, including why pnpm and yarn cause the same damage. |

**Batch 7, marketing surface.**

| Finding | Severity | What changed |
|---|---|---|
| `AUDIT-014#mkt-01` | high | The demo hardcoded `window.location.origin`, so no visitor could ever scan their own site, while ~780 SEO pages funnelled their only CTA there, `/tools/api-scanner` promised "just paste the URL" with no field, and the demo's own copy said "Try yours." next to a signup form. Added a URL input. The endpoint already enforced a scheme allowlist, the blocklist, per-IP limits and the full SSRF guard, so it needed no new protection. |
| `AUDIT-014#seo-01` | high | `robots.txt` disallowed `/shared/` and `/host/` for all agents, and preview fetchers honour that, so every shared report unfurled as a bare link. Added a `PREVIEW_CRAWLERS` group. Verified first that both routes already carry `noIndex: true` via `privatePageMetadata`, so the meta tag is what keeps them out of search: the Disallow was only blocking the preview fetch and cost nothing to lift. |
| `AUDIT-014#mkt-06` | medium | The landing FAQ answered "Do I need to install anything?" with "there is no browser extension", **and emitted that as `FAQPage` structured data**, while the extension is live on two stores. Both it and the feature list now say nothing needs installing and an extension is optional. |

**Batch 8b, a second flake that turned out to be a real defect.**

`password-strength.test.ts` asserted that one generated password rates "Very
Strong". Rather than assume randomness and loosen the test, the rate was
measured: **50,000 samples showed 0.542% came back only "Strong"**, about 1 in
185. The examples all carried repeated-character runs (`QQ`, `ooo`, `NNN`,
`ccc`) which `analyzePassword` penalises. So the product could hand a user a
suggested password that its own meter then marked down.

`generateStrongPassword` now rejects and redraws against its own analyzer,
which enforces the promised property without hand-tuning character rules that
would bias the distribution. At 99.46% acceptance it costs ~1.005 attempts,
with a retry cap so a future analyzer change degrades rather than loops.
Re-measured after the fix: **100% of 50,000 samples**. The test now draws 500
and asserts none are weaker, so it proves the contract instead of flipping a
coin.

**Batch 8, the test-suite flake** (`AUDIT-013#tq-09`).

`tests/lib/billing/stripe.test.ts` failed intermittently only under a full run.
Root cause found rather than retried: `isStripeEnabled()` reads
`process.env.STRIPE_SECRET_KEY` at **call** time, `process.env` is shared by
every file in the worker, and **three other suites assign that variable**. The
`beforeEach` delete left a window in which one of them could set it again
before the assertion. Fixed by setting the required value inside the loader
immediately before the module is imported, closing the window. This mattered
beyond tidiness: an intermittently red suite made every verification in this
work ambiguous.

---

## Batches 9 to 11 — closed

**Batch 9, silent failures.** All the same shape: a mutation fails and the
user sees nothing.

| Finding | Severity | What changed |
|---|---|---|
| `AUDIT-014#qolf-04` | high | `revokeShare` and `togglePubliclyListed` had `if (res.ok)` with no else, so a failed revoke stopped the spinner and left the row untouched. On a control whose purpose is *withdrawing access to a security report*, looking like it worked is the worst outcome. Both now report failure through the existing (previously near-unused) toast system. |
| `AUDIT-014#state-05` | high | The profile page's ten-way `Promise.all` substituted `[]` for every failed sub-request, so a failed keys fetch rendered as "you have no API keys". Worse, the two privacy defaults fell back to *public*. Now names what failed and warns the section may show a default rather than the real setting. |
| `AUDIT-014#state-04` | high | Two loaders in `repo-detail.tsx` returned out of the `try` on the non-ok branch, skipping `setLoading(false)`: permanent skeleton, and the component's own error state unreachable. Moved into `finally`. |
| `AUDIT-014#qolf-06` | high | Admin "Run Cleanup Now" permanently deleted rows database-wide on one click, while resetting a single reversible setting opened a dialog. Confirmation moved to the action that cannot be undone. |

**Batch 10, the scanning page** (`AUDIT-014#scanui-01`). The brief said to
remove the timer regardless, and it is gone. Deleting only the readout would
have left the 500ms interval and the fabricated progress bar behind, so the
interval is now gated on `hasRealProgress` (it exists solely to drive the
pre-first-poll fallback) and the dead `formatElapsed` helper is removed. In its
place the card reports server-supplied checks completed, which is real work and
cannot undersell the engine by counting time spent waiting.

**Batch 11, the incomplete-run guard** (`AUDIT-013#tq-09`, second half).

The forks pool intermittently fails to start a worker; vitest then reports only
the files that ran and **exits 0**. Observed across this session: 356, 353, 352,
351 and 349 files, every one "passing". A suite that quietly shrinks is worse
than one that fails, because the lost coverage is invisible and every
conclusion drawn from the run is unsound. It was also actively obstructing
verification of this remediation work.

`scripts/vitest-completeness-reporter.mjs` now compares files-run against
files-on-disk and fails the run on a shortfall. Two things had to be got right:
the vitest 4 hook is `onTestRunEnd`, not `onFinished` (the first attempt loaded
but never fired), and **vitest assigns its own exit code after reporters run**,
so setting `process.exitCode` printed the warning above an `exited with code 0`.
Forcing it from a `process.once("exit")` listener is what actually gates CI.
Verified on both sides: a complete run is silent and exits 0, a short run
prints and exits 1, and filtered runs (`vitest run <path>`) are exempt.

---

**Batch 5 (done) — accessibility and contrast.** `AUDIT-014#dsn-01`/`#a11y-01`: light
and dark share one value per accent token, medium severity badge at 1.66:1
against a published WCAG AA claim, and `--ring` is byte-identical to `--primary`
so focus is invisible on every primary button.

**Batch 6 — documentation truth.** `AUDIT-014#apidoc-01` (the `probes` field was
deleted from the API and is still the headline doc example; its replacement
`portScan` is documented nowhere), `#doc-01` (four docs pages tell a
self-hoster to run SQL that demotes their own admin account), `#doc-04`
(`SUPPORT.md` tells bug reporters to run the exact lockfile operation that breaks
CI).

**Batch 7 — marketing surface.** `AUDIT-014#mkt-01` (no visitor can scan their
own URL; the demo hardcodes `window.location.origin` while ~780 SEO pages funnel
their only CTA into it), `#seo-01` (robots.txt blocks social crawlers from
`/shared/`, so shared reports unfurl with no preview), `#mkt-06` (the landing FAQ
tells visitors there is no browser extension, as `FAQPage` structured data, while
the extension is live on two stores).

Then the long tail: 154 high, 364 medium, 228 low.

---

## Cannot be fixed from this repo

`AUDIT-014#ci-02` (high): `main` has `protected: false`,
`required_status_checks.enforcement_level: "off"`, empty contexts and zero
rulesets, so **not one CI job is a required check** and every "must block
merges" comment in `ci.yml` is currently false. CODEOWNERS is decorative for the
same reason. This is a GitHub repository setting, not code, so it cannot be
changed from here: it needs someone with admin on the repo to enable branch
protection on `main` and mark `lint`, `typecheck`, `test`, `build` and the new
`selfhost` job as required.

Until that is done, the new `selfhost` job will run and report, but nothing
stops a red build being merged. `AUDIT-014#ci-03` (dependabot auto-merge into an
unprotected main) is a direct consequence and closes with it.

---

## Standing notes

- `.claude/worktrees/agent-ad8a7d09dcde23fcc/` is a stale duplicate checkout and
  should be deleted. Five audits have now recorded it.
- `AUDIT-014#doc-02` (origin IP in `SECURITY-POSTURE.md`) was resolved in HEAD at
  the owner's direction by substituting an RFC 5737 documentation address. The
  real value remains in git history; the durable fix is firewalling the origin to
  Cloudflare's published ranges.
- Legacy audits (001-010) carry a `status` field. 41 findings are already marked
  fixed or accepted and are excluded from the 802. Some legacy findings without a
  status were verified fixed by later audits (for example `AUDIT-001#ssrf-01`,
  redirect re-validation, confirmed present by AUDIT-012), so a legacy finding
  needs re-checking before it is worked, not blind fixing.
