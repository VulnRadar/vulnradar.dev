# Scanner check accuracy sweep (post-Walmart false-positive report)

**ID:** AUDIT-008
**Created:** 2026-08-09T02:53:57.917Z
**Status:** draft
**Scopes:** scanner

## Summary

_pending_

## Findings

_run `node scripts/audit/add-finding.mjs AUDIT-008 ...` to append findings._

---

## content / client-side / vibe-code / information-disclosure sweep (agent a930df6b39d45efa2)

Scope: lib/scanner/checks/content.ts + checks-data/content.json (137 checks),
client-side.ts + client-side.json (16 checks), vibe-code.ts + vibe-code.json
(31 checks), and a lighter pass over information-disclosure.ts/json (34
checks) after the primary scope was done.

Reviewed every detector in content.ts/client-side.ts/vibe-code.ts side by
side with its JSON metadata entry, plus a targeted read of
information-disclosure.ts's own-category entries (cross-checked against
registry.ts's resolveDetector to confirm which of the many same-named
detector functions across files are actually reachable).

### Confirmed bugs, fixed (see AUDIT-008 findings content-01..09, vibe-01..03,

infodisc-01 for full detail)

- content.json had at least 4 entries whose title/description/evidence text
  was copy-pasted from a DIFFERENT check entirely (form-action-tel-scheme,
  sourcemap-reference, discord-webhook-exposed, exposed-session-id) --
  codeExamples had been fixed to match the right check in a prior pass but
  title/description/evidence/riskImpact were never updated. This is the
  single most damaging bug class found: a real finding shown to a user would
  have a completely wrong explanation of what was actually detected.
- service-worker-scope's regex structurally could never see an explicit
  scope option (it stopped matching at the URL string), so it always
  classified every registration as 'broad scope' and fired at severity
  high under a title about HTTP insecurity it doesn't even check for. This
  is functionally identical to the Walmart bug: a near-universal, expected
  pattern (navigator.serviceWorker.register('/sw.js')) rated as if
  dangerous.
- The entire vibe-code category never excluded <pre>/<code> documentation
  blocks from its pattern matching, unlike several content.ts checks which
  already use stripExampleContent() for exactly this reason (confirmed via
  its own doc comment). Since this product's own /docs/api page renders
  every check's 'Bad (AI-generated)' code sample as literal text, scanning
  vulnradar.dev itself would very likely self-trigger a large chunk of this
  category. Added a narrower stripDocBlocks() helper (keeps <script>
  content, unlike stripExampleContent) and wrapped every vibe-code
  detector with it.
- vibe-http-not-https had no exclusion for the http:// XML/RDF namespace
  URIs used in inline SVG (www.w3.org) and JSON-LD structured data
  (schema.org) -- both are near-ubiquitous on modern pages and neither is
  a network request.
- Three information-disclosure.ts cookie-fingerprint checks
  (django-csrftoken-cookie-exposed, laravel-session-cookie-exposes,
  express-cookie-exposes) were titled/described as detecting a cookie
  'missing security attributes' but the code only ever checked the cookie
  NAME, never the attributes -- confirmed by comparing against the sibling
  rails-cookie-httponly check in the same file, which does this correctly.
- Several severity/type recalibrations for internal consistency:
  graphql-introspection (medium->low, retitled to stop asserting a live
  server behavior it can't verify), bearer-token-exposed (critical->high,
  parity with jwt-in-html; also tightened the regex to stop matching
  ALL-CAPS placeholder tokens like 'Bearer YOUR_ACCESS_TOKEN_HERE'),
  debug-endpoint (high->low, parity with the equivalent-strength
  sensitive-endpoints check), vibe-loose-equality-auth (high->low, since
  this scans client-delivered JS where the pattern is almost always
  harmless UI-gating, not the real server-side auth boundary),
  iframe-srcdoc-no-sandbox (type header->body-pattern, was overstating
  engine confidence at 93% for a body-regex check).
- sensitive-form-no-csrf now skips forms whose action is a cross-origin
  absolute URL (third-party-hosted signup/contact forms) -- CSRF tokens for
  your own backend are meaningless for a submission that never reaches it.

### Flagged for human review, not changed

- open-form-action's third-party allowlist (stripe/paypal/google only) is
  probably too narrow for real marketing pages (Mailchimp, HubSpot,
  Typeform, etc. all missing) but expanding an allowlist is a policy call,
  not a pure bug fix.
- content.ts's postmessage-origin and client-side.ts's
  postmessage-no-origin-check are near-duplicate detectors (same trigger
  condition, same severity, different IDs/categories) that double-count one
  real signal into two findings in the danger score. Didn't merge/retire
  either since that's a design decision, not obviously mine to make
  unilaterally.

### Observed but out of scope / not filed as findings

- information-disclosure.ts contains ~15 detector functions with the same
  names as content.ts checks (sensitive-endpoints, debug-endpoint,
  admin-endpoint, cms-fingerprinting, exposed-error-messages,
  php-error-in-page, etc.) that are confirmed DEAD CODE -- content.json
  owns those ids under category 'content', so registry.ts's
  resolveDetector always picks content.ts's version first (verified via
  find-duplicate-ids.mjs showing zero collisions and registry.test.ts's
  category-owner-wins regression tests). Not a behavior bug, just bloat;
  matches a pattern registry.test.ts's own comments say is project-wide
  ('78 check IDs were defined in more than one checks/*.ts module').
- Did not touch secrets-extended.ts (out of my assigned scope), so did not
  verify whether content.ts's hardcoded-ip-addresses and the
  secrets-extended-implemented internal-ip-exposed (JSON def lives in
  content.json) overlap in practice -- flagging as a possible area for a
  future secrets-extended.ts-focused pass.
- Did not deeply audit every one of information-disclosure.ts's 34 checks
  to the same depth as content.ts (explicitly lower priority per the task);
  the ones reviewed (all 34 own-category entries, cross-referenced against
  their detectors) looked well-calibrated aside from the cookie-attribute
  bug above -- this file already shows heavy prior FP-reduction work
  (extensive 'Removed: fired on every X' comments throughout).

---

## Headers/cookies/configuration sweep (scanner-05..12)

Scope: `lib/scanner/checks/{headers,cookies,configuration}.ts` +
matching `checks-data/*.json` (126 + 24 + 18 = 168 checks reviewed).
`lib/scanner/safety-rating.ts` was read for the exploitable/hardening/
info tiering philosophy but not touched (owned by a parallel agent).

Method: rather than eyeballing 168 entries one at a time, cross-checked
detector implementation vs. JSON title/severity/description for every
id, plus two automated passes: (1) grouped detectors by which headers
they read (`h(headers, "...")`/`hasHeader(...)` calls) to surface
functional overlaps regardless of naming, which is how the
duplicate/overlapping-check findings (scanner-05, part of scanner-08)
were found; (2) for headers.json specifically, several entries'
templated `"evidence"` field embeds a `headers-<slug>` string that
doesn't match the entry's own `"id"` — a leftover fingerprint from
whatever process re-pointed a stale/renamed id at an existing detector
without updating the rest of the metadata (scanner-06). Cross-checking
those two systematic signals against the actual `.ts` logic, rather
than trusting titles at face value, is what surfaced most of the real
bugs here — several checks (`coop-missing`, `charset-meta-missing`,
`cors-null-origin-allowed`) had titles/descriptions/fix-steps that
were about a _completely different, unrelated concept_ than what the
code actually detected.

Biggest real-world false-positive contributors found (would very
plausibly have contributed to the same kind of Walmart-style inflated
score/finding-count as the four scanner-01..04 bugs):

- `x-xss-protection-block` (scanner-12) fired a "finding" on every HTML
  page that correctly omits the deprecated X-XSS-Protection header —
  its own evidence text said "that's correct" while still being
  reported. This is likely the single highest-volume false-positive of
  everything reviewed in this audit wave (fires once per HTML page on
  every well-run site in existence).
- `content-disposition-inline` (scanner-11) matched image/audio/video
  MIME types in its "no Content-Disposition" branch, so it recommended
  forcing a download on ordinary `<img>`/`<video>` assets — i.e. fired
  on nearly every image on every page.
- `sri-missing` at severity `high` (scanner-07) fires on any external
  script without SRI, but SRI is structurally impractical for
  continuously-updated third-party vendor scripts (GA, GTM, payment
  SDKs) that virtually every production site loads — this would have
  fired at "high" against almost the entire web, GitHub/Cloudflare
  included.
- `cookie-third-party-no-samesite-none-secure` (scanner-08, `high`)
  conflated "has an explicit cookie Domain= attribute" with "is a
  third-party/cross-site cookie" — completely ordinary at any company
  with subdomain SSO — and told developers to add `SameSite=None`,
  which is _worse_ advice for a first-party cookie, not better.

Judgment calls flagged but NOT changed (recorded as findings for human
review, no code changed):

- `ratelimit-policy-missing`'s remaining premise (absence of
  RateLimit-* headers on an `api.*` host implies absence of rate
  limiting) is still a heuristic that can't be verified passively —
  fixed the concrete header-name gap (scanner-10) but the underlying
  design tradeoff (can't confirm rate limiting without active testing)
  is a reasonable, common scanner design choice, not a bug to unilaterally
  downgrade further.
- The 24 `permissions-policy-*-blocked` per-feature checks overlap with
  `excessive-permissions` for the 5 features both cover (camera,
  microphone, geolocation, payment, usb) when the old bare-wildcard
  Permissions-Policy syntax (`camera=*`) is used. Left alone: this is a
  summary-check + itemized-detail pattern also used elsewhere in this
  codebase (CSP has the same shape), and the bare-wildcard syntax this
  overlap depends on is rare in modern deployments (structured
  `camera=()`/`camera=(self)` syntax is explicitly excluded by the
  `ppAllowsFeature` helper already).

Did not find evidence of additional issues in `configuration.json`'s
Vary-header family (`vary-header-cookie`, `vary-header-missing`,
`vary-cookie-on-static-resource`, `vary-origin-missing-cors`) or the
CDN-cache-header disclosure checks (`x-amz-cf-id`, `x-vercel-cache`,
`x-nextjs-cache`, `x-netlify-cache`, `x-cache-hits`,
`x-cache-status-cloudflare`) — all correctly scoped to `info`/`low` and
their code matches their documented behavior.
