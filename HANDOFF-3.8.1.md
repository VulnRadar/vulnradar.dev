# 3.8.1 handoff

Tree is clean, typecheck passes, everything below is committed on `main`.
Nothing is pushed yet.

## Start here tomorrow

1. `git push origin main` (13 commits ahead), wait for CI.
2. Tag `v3.8.1` and let the release run. The arm64 image follows on its own
   workflow a few minutes after the release, which is expected now.
3. Then the live-scan findings below.

## Live scan of vulnradar.dev, 2026-09-04

10 findings: 0 critical, 0 high, 2 medium, 1 low, 7 info. Three are ours to
fix in code; the rest are Cloudflare or DNS settings you change in a dashboard,
not in this repo.

### Fix in code

**`Disallow: /admin` in robots.txt** (MEDIUM, `app/robots.ts`)
Publishing the admin path in a file designed to be world-readable hands over a
target for free, and the Disallow was never the access control. Note the file
has deliberate Disallow entries for `/shared/` and `/host/` with comments
explaining why, so read those before editing: the fix is to stop naming
`/admin`, not to empty the file.

**COEP sent twice** (INFO, but a genuine bug)
The scan saw `Cross-Origin-Embedder-Policy: unsafe-none, unsafe-none`. Two
sources are emitting it. The changelog records this being fixed once already,
so either the fix regressed or there is a second source. I was midway through
`git grep -rn "Embedder-Policy" -- middleware.ts next.config.mjs` when the
session ended. Worth checking `next.config.mjs`'s `headers()` against
`middleware.ts`, which the config file's own comment calls the single source of
truth for these.

**3 elements with inline `style=`** (INFO)
Only worth doing if you want `style-src` without `'unsafe-inline'` eventually.
Low value on its own.

### Not code: Cloudflare dashboard

- **TLS 1.0/1.1 still accepted** (MEDIUM). SSL/TLS -> Edge Certificates ->
  Minimum TLS Version -> 1.2. This is the highest-value item in the whole scan
  and it is one dropdown.
- **OCSP stapling disabled** (INFO). Same section.
- **NSEC zone walking** (LOW). Switch the zone to NSEC3. Judgement call: your
  zone is all public names, so enumeration resistance buys little.
- **CAA has no iodef** (INFO). Add
  `vulnradar.dev. IN CAA 0 iodef "mailto:security@vulnradar.dev"`. Cheap, and
  it is the only channel that tells you someone tried to get a certificate for
  your domain from an unauthorised CA.
- **TLSA/DANE missing** (INFO). Optional, and only meaningful with DNSSEC.
- **All nameservers at Cloudflare** (INFO). Working as intended for you.

### Informational, no action

`csp-framework-required` is Next.js needing `style-src 'unsafe-inline'`, which
is expected and already explained in the finding.

## Still open from tonight

- **The async check branch was never run against vulnradar.dev.** It needs a
  database and I would not point one at production. Most of the ~98 new checks
  live there, so they are unverified against your own domain. The live scan you
  ran does cover them, which is why DNS and TLS findings appear above.
- **The FP retuning was reasoned from code, not from the feedback rows.** No
  non-production database was available. Now that the admin page surfaces
  `finding_url` and `notes`, re-check those checks against the real evidence.
- **Browser viewer and assistant panel need a human eye.** Both were rebuilt
  without the extension connected, so nothing was rendered. Specifically:
  whether thin letterbox bands survive on the viewer, and both surfaces in
  light theme.
- **`/auth/update` still claims an email address before it is verified**, so an
  address nobody has registered can be squatted. Deliberately out of scope: it
  needs a pending-change column and token flow.
- **Graphify has not been regenerated** since 2026-08-16. Several agents added
  files tonight. Worth one run now the tree is settled.

## What landed tonight

895 checks (up from 797). Three CRITICAL engine DoS bugs, all reproduced with
measurements before fixing. Three HIGH security findings including an
authenticated scan that could render as clean without finishing. The self-host
lockout, where following our own README made the first login impossible
forever. Operational kill switches (maintenance, pause signups/logins/scanning)
with all ten scan entry points gated. Engine feedback page rebuilt. All 66
emails redrawn. Evidence excerpts and triage reaching exports. The OG card
cache-busting. Two mobile bugs. `code-xss-template-tag` deleted.

The changelog has all of it.
