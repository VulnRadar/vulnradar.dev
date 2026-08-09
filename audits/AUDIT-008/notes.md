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
  is functionally identical to the Walmart bug: an near-universal, expected
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
