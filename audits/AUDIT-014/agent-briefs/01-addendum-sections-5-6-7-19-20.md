# AUDIT-014 addendum: sections 5, 6, 7, 19, 20

Read `audit-014-context.md` FIRST. Every rule there applies to you: read-only, never
print a secret value, no writing npm commands, exclude the stale worktree and
`node_modules`/`.next`/`coverage`/`graphify-out`, verify at a live file:line, no
speculation, no em dashes, and the exact twelve-key finding schema.

This addendum covers what is different for your five sections.

## Your `section` values

Use the section number your finding truly belongs to: **5, 6, 7, 19, or 20.**
(The other wave of this audit is filing 13, 14, 15 and 18. If you find something that
truly belongs to one of those, still file it with that number and it will merge.)

## These sections are PROPOSAL work, not defect-hunting

Sections 5, 6 and 7 were left PARTIAL by AUDIT-011 because a second wave was cancelled
mid-run. Sections 19 and 20 have never been touched. Unlike the previous three audits,
much of your output is "here is what this should be instead", not "here is a bug".

That changes two things:

1. **`recommendation` carries the weight.** For a design or QOL finding, the
   recommendation must be concrete enough to build from: name the component to reuse,
   the tokens, the layout, the copy. "Improve the hierarchy" is not a finding.
   Describe the improved version specifically.
2. **Severity means user-facing damage, not exploitability.** This is AUDIT-011's
   assumption 6 and it still holds: a page unusable on mobile is `high`; a page that
   is ugly but usable is `low`. A proposal for something that does not exist yet is
   normally `medium` at most unless its absence actively costs the business. Use type
   `opportunity` or `gap` for those rather than inflating severity.

## THE DESIGN LANGUAGE IS ALREADY WRITTEN. USE IT, DO NOT REINVENT IT.

`audits/AUDIT-011/design-language.md` (26 KB) is the extracted spec: colour tokens,
type scale, spacing rhythm, component idioms, layout principles, voice, and a
14-point tell-tale checklist for AI-generated-looking design. **Read it in full before
you write anything.** Measure surfaces against THAT spec, not against generic taste.

Key facts from it you must not contradict:

- **The real brand colour is blue `#60a5fa` (~213 degrees), not the cyan/teal ~190
  that `CLAUDE.md` line 1 claims.** AUDIT-011 filed the doc as the defect
  (`AUDIT-011#design-01`). Audit against the shipped blue.
- The strongest existing work, and therefore the yardstick, is: the landing page, the
  OG image, and the store screenshots in `extension/public/store/`.
- CLAUDE.md's design rules still bind: vary section layouts, no six-identical-icon-card
  grids, no "Everything you need to X" headings, no em dashes in UI copy, specific
  honest copy over SaaS platitudes.

## What AUDIT-011 already filed in sections 5, 6, 7 (extend, do not re-file)

- Section 5 has 6 findings, all fallout from extracting the spec rather than from a
  conformance pass. `design-01` is the wrong brand colour in CLAUDE.md.
  `design-02` covers unused fonts.
- Section 6 has 8 findings. The **latency half is complete**: `scan-01` is the root
  cause (subdomain discovery awaited on the critical path with a hardcoded 15s cap at
  `lib/scanner/execute-scan.ts:793`), and `scan-02`, `scan-03` (a 2000ms poll dead
  time), `scan-04`, `scan-06`, `scan-07` are filed. **Do not re-file any latency
  finding.** What was never done is the UI rebuild.
- Section 7 has 4 findings. The **bulk-action inventory is complete**: all six
  instances found, each with a keep/remove/redesign verdict and a removal line count,
  recorded as `bulk-01` through `bulk-06`. **Do not redo the bulk inventory.** What
  was never done: the `/admin` restructure proposal, the page-by-page information
  hierarchy review, the repetitive-flow and missing-shortcut sweep, the
  feedback/progress/undo review, and the mobile-density review.

Read `audits/AUDIT-011/findings.json` and filter `section` 5, 6, 7 before you start.

## Cross-audit context that matters for sections 19 and 20

- **Cloudflare is blocking AI crawlers at the edge.** "Managed robots.txt" / AI Crawl
  Control overrides the app's own `robots.txt` and disallows GPTBot, ClaudeBot, CCBot
  and Google-Extended. This is a dashboard setting, NOT fixable in code, and it is the
  confirmed reason AI assistants do not know this product. If you file anything about
  AI crawler access, say explicitly that the fix is a Cloudflare toggle, not a code
  change, so nobody wastes a day on it.
- `AUDIT-012#fe-01` found the root layout's `await headers()` forces all 311 routes
  dynamic, so only 5 are prerendered and Cloudflare caches zero HTML. That has direct
  SEO consequences (TTFB, crawl budget). Cite it rather than re-filing it.
- `AUDIT-013` found the npm name `vulnradar` is unclaimed while `/docs/cli` advertises
  `npx vulnradar` (`subdeps-01`). That is both a supply-chain and a discoverability
  fact. Do not re-file it.
- The `/checks` pages are ~750 deliberate SEO pages. They are the main organic
  surface, so they deserve real scrutiny in section 19, but they are NOT dead code and
  must not be recommended for deletion.
- Known product facts: ~50 registered users; GPL-3.0; SaaS plus self-hostable; plans
  are free/core/pro/elite with daily scan caps 25/100/150/500.

## Section 20 specifically: name your comparison set

The brief requires two lists: (a) features competitors have that this product does
not, ranked by how much they would matter to THIS product's users, and (b) things
this product has that they do not, which should be highlighted harder. **Name the
apps you are reasoning about** and say how you know what they offer. You may use
WebSearch and WebFetch to check current competitor feature sets rather than relying
on memory, and you should, because your training data may be stale. Be honest about
confidence: mark anything you could not verify.

Prior work exists and you should extend rather than repeat it. A previous session
recorded seven candidate gaps: compliance reports (SOC2/PCI/HIPAA mapping), Jira
integration, proof-based exploit evidence, CVE and port scanning, SSO/auth-flow
scanning, cloud and container scanning, and an IAST agent. Treat that as a starting
hypothesis to verify, refine and rank, not as the answer. Reasonable comparison set:
Detectify, Intruder.io, Probely, Pentest-Tools.com, Snyk, Semgrep, Astra, Acunetix,
Burp Suite Enterprise, and the free tier of Mozilla Observatory / Security Headers /
SSL Labs for the single-URL-scan shape specifically. Include at least one
open-source self-hostable comparison (OWASP ZAP, Nuclei, Wapiti) because this product
is GPL and self-hostable, which changes who it competes with.

For each gap in list (a) give: what it is, which competitors have it, why this
product's users would want it, roughly what it would take to build here given the
existing architecture, and a rank. For list (b) be specific about where each
advantage is currently under-sold (which page, which copy).
