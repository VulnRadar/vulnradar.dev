# Scanner engine audit

Date: 2026-08-04. Scope: `lib/scanner/**`, `app/api/v3/scan/**`.

Every number below was measured, not estimated. The measurements come from
running the real registry against fixture responses and from static analysis of
the detector modules. The method is described at the end so anyone can
reproduce it.

## Headline

The marketing claim is "650+ checks across 16 categories". There are 652 check
definitions across 16 categories, so the number is literally true and
substantively misleading.

Of those 652:

- **601 can execute.** The other 51 (every `tls`, `dns` and `email` entry) have
  no detector at all. Their three modules are placeholder files where every
  entry is `() => null`, and the async engine that really does DNS and TLS work
  emits its findings under entirely different IDs. No scan has ever produced a
  finding whose ID is one of those 51.
- **A typical HTTPS site produces 30 findings from those 601 checks**, and 21 of
  the 30 come from one category. The 112-check `code` category, the 51-check
  `secrets-extended` category, the 34-check `information-disclosure` category
  and the 32-check `api` category produced **zero** findings between them.
- **464 of the 601 fired on none of four probe responses**, including one
  deliberately built to be as bad as a page can be.
- **78 check IDs have two or three competing implementations in different
  files.** The registry builds a flat `{id -> fn}` map, so the last module in
  `BUNDLES` wins and 81 implementations are dead code. In all 78 cases the
  surviving implementation is the one in a module that does not own the check
  definition, and in at least one case the version that survives is the one a
  comment in the other file says was replaced because it false-positived on
  every authenticated web app.
- **106 checks report 90% or higher confidence while their detector is a regex
  over the response body.** Confidence is derived entirely from a `type` string
  in the JSON that has drifted away from what the code does.

The engine detects little because it is, in substance, a header linter with a
large regex appendix. That is defensible as a product; describing it as 650+
checks is not.

---

## 1. How many checks actually run on a typical HTTPS scan

`app/api/v3/scan/route.ts:628-645` runs every executable check against one
response. There is no gating by relevance, so all 601 are _invoked_. What
matters is how many can _conclude_ anything.

Measured against a fixture representing an ordinary modern site (HTTPS,
Cloudflare, HSTS, `nosniff`, a CSP with `unsafe-inline`, one CDN script, one
POST form):

| Outcome                            | Count |
| ---------------------------------- | ----- |
| Check definitions registered       | 652   |
| Executable (definition + detector) | 601   |
| Findings produced                  | 30    |

By category, on that same response:

| Category               | Checks registered | Findings produced |
| ---------------------- | ----------------- | ----------------- |
| headers                | 123               | 21                |
| content                | 137               | 2                 |
| code                   | 112               | 0                 |
| secrets-extended       | 51                | 0                 |
| information-disclosure | 34                | 0                 |
| api                    | 32                | 0                 |
| cookies                | 24                | 0                 |
| configuration          | 18                | 2                 |
| vibe-code              | 31                | 1                 |
| client-side            | 16                | 2                 |
| supply-chain           | 8                 | 1                 |
| ssl                    | 8                 | 1                 |
| host-validation        | 7                 | 0                 |
| tls / dns / email      | 51                | 0 (cannot fire)   |

Twenty-one of the thirty findings are `headers`, and of those twenty-one,
seventeen are "this header or CSP directive is absent". The user's experience
that "real scans surface very little" is accurate, and the little that surfaces
is nearly all one kind of thing.

Broadening the fixture does not change the shape. Across four probes (typical
site, fully hardened site, deliberately terrible page, JSON API response),
**464 of the 601 executable checks never fired once**. Some of those are
legitimately conditional, but the list includes whole families that will
essentially never fire in production:

- The 22 `permissions-policy-*-blocked` checks (`lib/scanner/checks/headers.ts:1023-1088`)
  all funnel into `ppAllowsFeature` (`headers.ts:1200-1229`). Trace it: absent
  header returns null, feature not mentioned returns null, `self` returns null,
  any parenthesised allow-list returns null, and the final statement is
  `return null`. The only inputs that fire are the literal `feature=*` and
  `feature=src`. Twenty-two registered checks share one reachable branch that
  real sites do not hit.
- 42 detectors are hard-disabled with an unconditional `return null` and a
  comment explaining they were too noisy or duplicated. 21 of them are in
  `lib/scanner/checks/code.ts` alone (`eval-usage:99`, `settimeout-string:113`,
  `ssrf-indicators:331`, `xxe-vulnerability:359`, `regex-dos-pattern:787`, and
  16 more). They still count toward 652.
- 37 detector functions have no matching definition, so `buildCheck`
  (`registry.ts:233-236`) returns null and they are never wrapped into a check.
  Several are detections the product would want: `stack-trace-exposed`,
  `source-maps`, `private-key-in-source`, `graphql-endpoint-exposed`,
  `open-redirect-params`, `connection-string-exposed`, `local-storage-sensitive`,
  `external-script-no-sri`. They are written, tested by the smoke harness, and
  unreachable.

**Honest executable count today: 601 registered, of which roughly 137 have ever
been observed to fire, and 22 of the 123 header checks share a single
unreachable-in-practice branch.**

## 2. What input the engine actually looks at

`CheckFn` is `(url, headers, body) => Vulnerability | null` (`registry.ts:70-74`),
where `body` is the raw response text capped at 1 MB.

| Input              | Inspected?  | How                                                                            |
| ------------------ | ----------- | ------------------------------------------------------------------------------ |
| Response headers   | Yes         | `Headers.get`, thoroughly                                                      |
| Response body      | As a string | Regex and `includes` over raw text                                             |
| HTML structure     | No          | No parser exists anywhere in the repo                                          |
| Inline JavaScript  | Partially   | Two ad-hoc regex `<script>` extractors                                         |
| Linked JavaScript  | No          | Never fetched                                                                  |
| Forms and inputs   | As text     | Regex over `<form`, `<input` substrings                                        |
| Cookies            | Yes         | Per `Set-Cookie`, named correctly (`checks/cookies.ts`)                        |
| TLS certificate    | Yes         | `checkTLSCert`, `async-checks.ts:860`                                          |
| DNS records        | Yes         | SPF, DMARC, DKIM, DNSSEC, CAA, MX, NS, dangling CNAME                          |
| Well-known paths   | Yes         | 23 file probes, robots.txt, security.txt                                       |
| Active HTTP probes | Yes         | CORS reflection, method enumeration, `X-Forwarded-Host`, GraphQL introspection |

Of 652 definitions, **396 detectors read the body and 256 never touch it**. The
396 that do read it treat HTML as a flat string. No dependency in
`package.json` can parse HTML, and none of `parse5`, `cheerio`, `jsdom` or
`node-html-parser` is present in `node_modules` either.

The consequences are not theoretical:

- Markup inside a JavaScript string literal is indistinguishable from real
  markup. `var t = '<form action="http://x">'` fires `form-action-http`
  (`headers.ts:657`).
- Three separate, copy-pasted "strip the non-content regions" helpers exist and
  none of them is the one in `_helpers.ts`. `stripNonHtml` (`_helpers.ts:101`)
  is exported and unused by `content.ts`, `code.ts` and `secrets-extended.ts`.
  `content.ts:17` defines `stripExampleContent`. `code.ts:13` defines
  `inlineScriptContent`. `secrets-extended.ts` pastes the same two-line strip
  inline four times (lines 15, 35, 102, 228).
- `redactSecret` (`_helpers.ts:175`) exists and is reimplemented inline in both
  `code.ts:719` and `secrets-extended.ts:367`.
- `matchCookie` (`_helpers.ts:140`) was added, per its own comment, to replace a
  hand-rolled loop "that was producing false positives across multiple cookie
  detectors". Nothing calls it. Every cookie detector still hand-rolls the loop,
  and `headers.ts` reimplements `getSetCookies` inline twice (lines 698 and 987)
  rather than importing it.
- There is no entropy scoring anywhere, across roughly 90 secret detectors. Every
  secret check is a fixed pattern, which is why the pattern list keeps growing
  one vendor at a time.

## 3. Does it fetch more than one page

**The default scan fetches exactly one URL.** `route.ts:513-521` issues a single
`safeFetch` against the submitted URL and every synchronous check sees only that
response.

The async layer does make additional requests, and this is the strongest part of
the engine: `checkLiveFetch` (`async-checks.ts:2208-2259`) fans out to 23
well-known file probes, robots.txt, security.txt, an active CORS reflection
test, HTTP method enumeration, an `X-Forwarded-Host` injection test and a
GraphQL introspection probe. That is real work.

Crawling exists but is a **separate opt-in endpoint**,
`app/api/v3/scan/crawl/route.ts`, capped at `MAX_PAGES = 15` (line 35). Its
results do not feed the default scan. Nothing links discovered pages back into a
single result. A user who scans `https://example.com` and sees thirty findings
is seeing the analysis of one HTML document.

Two consequences worth naming:

- `checkExposedFiles` and the other active probes call bare `fetch`
  (`async-checks.ts:1755`, `1795`, `1861`, `1956`), not `safeFetch`. They guard
  with `isPrivateHostname` on the initial hostname, but a redirect to a private
  address is not re-validated. `safeFetch` is owned by another agent; flagging
  only.
- The whole async bundle is raced against a single 15-second timeout that
  resolves to `[]` (`route.ts:619-624`). One slow DNS lookup discards **every**
  async finding: certificate expiry, exposed `.env`, subdomain takeover, all of
  it. The user is told nothing. `engineConfidence` drops from 97 to 94.

## 4. Where the false positives are

### 4a. A perfectly hardened site still reports four findings, and all four are wrong

Fixture: `default-src 'none'`, `script-src 'self'`, `frame-ancestors 'none'`,
`object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, HSTS with preload,
`nosniff`, `X-Frame-Options: DENY`, full COOP/COEP/CORP, `Cache-Control: no-store`,
a five-line HTML document with no scripts.

| Finding                    | Why it is wrong                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `csp-script-src-self-only` | Fires **because** `script-src` is `'self'`. Best practice reported as a finding. `headers.ts:811`          |
| `csp-frame-src-missing`    | `default-src 'none'` already covers `frame-src`. The check never consults the fallback. `headers.ts:792`   |
| `expect-ct-missing`        | `Expect-CT` was removed from Chrome in 2021 and is obsolete                                                |
| `x-xss-protection-block`   | The evidence string literally says "that's correct (deprecated)". A finding that reports correct behaviour |

Four findings on a site with nothing wrong is a 100% false-positive rate on the
hardened case.

### 4b. Confidence is decorative

`registry.ts:193-211` derives confidence from `def.type` and nothing else. Two
hardcoded overrides exist (`registry.ts:188-191`). The `type` field has drifted
badly from what the detectors do:

| Situation                                                       | Count   |
| --------------------------------------------------------------- | ------- |
| Checks scored 90 or above whose detector regexes the body       | **106** |
| Checks typed `body-pattern` whose detector never reads the body | 20      |
| Checks typed `combined` whose detector never reads the body     | 31      |

`api-jwt-hs256-weak-secret`, `api-jwt-alg-none`, `api-soap-xxe-enabled` and
`api-rest-mass-assignment-risk` are all typed `header` and therefore reported at
93% confidence, and all four are body regexes.
`api-rest-mass-assignment-risk` (`api.ts:391`) is `/"role"\s*:\s*"admin"/i`
against the body: an admin viewing their own profile JSON produces a 93%
confidence finding.

`lib/scanner/LEARNING.md:28-42` documents a per-check `confidence` field in the
JSON. It appears in **0 of 652 definitions** and no code reads it.

### 4c. Evidence frequently proves nothing

On the deliberately terrible fixture, **80 of 120 findings carried evidence with
no observed value from the target**, a constant sentence restating the check
title. `csp-object-src-missing` returns "CSP exists but no object-src directive."
without quoting the CSP. `coep-missing` returns "Header
'Cross-Origin-Embedder-Policy' is not present." without listing what headers
were present, even though `formatObservedHeaders` (`_helpers.ts:159`) exists for
exactly that and is used by almost nothing.

### 4d. Naive matches that fire on ordinary sites

A representative sample, all verified against the source:

| Check                        | Location                        | Pattern                                         | Fires on                                                     |
| ---------------------------- | ------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| `default-credentials`        | `code.ts:449`                   | `body.includes("admin/admin")`                  | A page advising readers never to use `admin/admin`           |
| `sensitive-meta-tags`        | `content.ts:216`                | any `<meta>` whose name contains `csrf`/`token` | The standard Rails/Laravel `<meta name="csrf-token">` tag    |
| `secret-auth0-client-secret` | `secrets-extended.ts:900`       | `/auth0[_-]?client[_-]?secret/i`                | Any page naming the env var, with no secret present          |
| `config-file-leaked`         | `content.ts:1014`               | mentions of `.env`, `config.json`               | Any docs page saying "add this to your `.env`"               |
| `sensitive-files`            | `content.ts:1043`               | `href` ending `.git`                            | A footer link to a GitHub clone URL                          |
| `autocomplete-sensitive`     | `content.ts:111`                | unbounded `cc` in a field name                  | `id="ccpaConsent"`, the CCPA consent checkbox                |
| `dom-clobbering-vulnerable`  | `content.ts:1353`               | `id="form"`, `id="config"`                      | Generic template mount points                                |
| `clipboard-access`           | `content.ts:821`                | `navigator.clipboard` anywhere                  | A docs page with a "copy code" button                        |
| `hardcoded-credentials`      | `code.ts:434`                   | `/(admin\|root)\s*[:=]\s*"..."/`                | An i18n string `"admin": "Admin Panel"`                      |
| `vibe-weak-random`           | `vibe-code.ts:73`               | `Math.random().*(token\|...\|id)`               | Unbounded `.*` plus bare `id`, so "avoid", "provide", "grid" |
| `vibe-generic-error-message` | `vibe-code.ts:20`               | `"Something went wrong"`                        | Every well-written app                                       |
| `phishing-lookalike-domain`  | `content.ts:1029`               | `xn--`                                          | Any legitimate internationalised domain                      |
| `email-enumeration`          | `information-disclosure.ts:327` | `/email.*(already exists\|invalid)/`            | Unbounded `.*`; matches "Your email is invalid"              |
| `cdn-fallback-missing`       | `content.ts:338`                | a CDN script and no `onerror=` on the page      | Almost every site using one CDN library                      |

### 4e. Duplicate IDs silently shadow each other, and the wrong version wins

This is the most serious structural defect. `registry.ts:174-179` flattens all
module detector maps into one `Record<id, fn>`:

```ts
for (const bundle of BUNDLES) {
  for (const [id, fn] of Object.entries(bundle.detectors)) {
    detectorMap[id] = fn as EvidenceFn;
  }
}
```

Measured: **78 IDs are defined in two or three modules, shadowing 81
implementations.** In every one of the 78 cases the survivor is not the module
that owns the definition, because `BUNDLES` order decides, not category
ownership.

Where the two implementations differ, the behaviour is a coin flip decided by
array order:

- `open-redirect`: `content.ts:961` requires the redirect parameter to start
  with an absolute URL, a fix its own comment says was made "to avoid false
  positives on virtually every authenticated web app". `code.ts:517` is the
  older unrestricted version. `code` loads after `content`, so **the naive
  version wins and the fix is dead code**.
- `email-enumeration`, `verbose-error-messages`, `outdated-js-libs`,
  `cms-fingerprinting`: same pattern. The tightened version in `content.ts`
  loses to the original in `information-disclosure.ts`.
- `etag-inode` / `etag-inode-leak`: `configuration.ts` disables the first and
  keeps the second; `headers.ts` does the exact opposite. Two files made
  opposite decisions about which ID is canonical and neither is aware of the
  other.
- `server-timing-exposure`: `headers.ts:593` only fires on sensitive metric
  names; `configuration.ts:141` fires on any `dur=`. The broad one wins.

Seventeen IDs are byte-identical duplicates between `content.ts` and `code.ts`
(`dom-xss-sinks`, `dangerous-inline-js`, `inline-event-handlers`,
`postmessage-origin`, `storage-api-usage`, and thirteen more). Those are waste
rather than bugs.

### 4f. The same issue reported many times

Independently of ID collisions, one underlying problem is reported under many
IDs, because nothing deduplicates:

| Issue                          | Distinct IDs | Examples                                                                                                                                                          |
| ------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing SRI                    | 5            | `sri-missing`, `external-script-no-sri`, `third-party-script-no-sri`, `supply-chain-sri-external-script`, `sri-stylesheet-missing`                                |
| Sensitive data in localStorage | 6            | `storage-api-usage`, `local-storage-sensitive`, `localstorage-sensitive`, `sessionstorage-tokens`, `code-local-storage-pii`, `code-auth-sessionstorage-passwords` |
| `document.write`               | 5            | `document-write-usage`, `document-write-sink`, `dangerous-inline-js`, `dom-xss-sinks`, `code-xss-documentwrite-jsonparse`                                         |
| AWS access key                 | 5            | `aws-credentials-exposed`, `hardcoded-secrets` (twice), `secret-aws-access-key-id`, `secret-aws-secret-key`                                                       |
| PEM private key                | 4            | `private-key-exposed`, `private-key-in-source`, `secret-private-key-pem`, `hardcoded-secrets`                                                                     |
| `eval()`                       | 4            | `eval-in-scripts`, `dangerous-inline-js`, `dom-xss-sinks`, `code-deser-base64-eval`                                                                               |
| `postMessage(*)`               | 3            | `postmessage-star-origin` (twice), `postmessage-wildcard`                                                                                                         |

On the typical-site fixture this is visible directly: one CDN script without
`integrity` produced **three** separate findings (`sri-missing`,
`third-party-script-no-sri`, `supply-chain-sri-external-script`), and one POST
form without a token produced **two** (`sensitive-form-no-csrf`,
`vibe-missing-csrf`). Five of thirty findings on an ordinary page are
restatements. This is a large part of why the results feel noisy while the
coverage feels thin.

## 5. How modular a check really is

Adding a detection today means touching **at least three files**, and the
interface has drifted between categories.

To add one check:

1. Add a definition object to `lib/scanner/checks-data/<category>.json`.
2. Add a detector to `lib/scanner/checks/<category>.ts`.
3. If the category is new, add an import and a `BUNDLES` entry in `registry.ts`.
4. Run `node scripts/find-duplicate-ids.mjs`, which only checks the JSON and
   **will not catch a duplicate detector ID**, the exact failure mode that
   produced the 78 collisions above.
5. Add a fixture to `tests/lib/scanner/checks/<category>.test.ts`.

The declared type is consistent (`EvidenceFn` in `_helpers.ts:85-89`, imported
by every module), but everything around it has drifted:

- Structural typing lets detectors declare fewer parameters, and many do.
  `ssl.ts:32`, `ssl.ts:81` and `host-validation.ts:87` take only `(url)`. All 69
  entries in `dns.ts`, `email.ts` and `tls.ts` take no parameters at all.
- A check cannot say what it needs. `csp-object-src-missing` and
  `permissions-policy-camera-blocked` are invoked on a `Content-Type:
application/json` response the same as on HTML.
- A check cannot return more than one finding, so "three scripts lack SRI"
  becomes one string with a count instead of three verifiable instances.
- A check cannot attach structured evidence, set its own confidence, or mark
  itself as covering the same ground as another check.
- Metadata and logic live in different files with no compile-time link. The 37
  orphan detectors and 51 detector-less definitions are the direct result.
- `checksRun` exists on `ScanResult` (`types.ts:85`) and is never populated by
  any route.

---

## What this justifies

In priority order, and matching what the engine actually needs rather than what
would be nice:

1. **Parse the page.** 396 detectors regex a flat string. A real tokenizer and a
   parsed context turn "does the body contain `<form action=http`" into "is
   there a form with a password field whose resolved action is `http://`".
2. **One check interface that carries its own metadata**, so adding a detection
   is one entry in one file, a check can declare what context it needs, and it
   can return several verifiable instances.
3. **Confidence that means something**, derived from how the detection was
   actually made rather than from a JSON `type` string that has drifted from the
   code in 157 cases.
4. **Evidence on every finding**, with the observed value quoted.
5. **Deduplication**, so one missing `integrity` attribute is one finding.
6. **Per-task timeouts and partial results**, so a slow DNS lookup costs one
   check rather than every async finding in the scan.
7. **Fix the ID collision defect** at the registry level so it cannot recur, and
   extend the duplicate-ID script to cover detectors.

## On the "650+" claim

Do not change `CONFIG_TOTAL_CHECKS_LABEL` to a smaller number in a panic; the
right move is to make the number honest by making the checks real. But the
figures to know are:

- 652 definitions exist.
- 601 can execute.
- 51 can never fire under their advertised ID.
- 42 more are hard-disabled and always return null.
- 81 implementations are shadowed and unreachable.
- 37 written detectors have no definition and are unreachable.

**The defensible count of distinct, reachable, non-disabled checks is
approximately 520**, before deduplicating the families in section 4f, which
would remove roughly another 25. A rounded, honest figure today is "500+".

---

## Method

- Inventory and collision counts: the real `lib/scanner/registry.ts` module was
  imported and its `allCheckDefs` / `allChecks` arrays measured directly, and
  the per-module `detectors` maps were compared for key overlap in `BUNDLES`
  order.
- Firing rates: `allChecks` was executed against four fixture responses
  (typical HTTPS site, fully hardened site, deliberately vulnerable page, JSON
  API response) and the resulting `Vulnerability[]` counted by ID and category.
- Body-versus-header split and the confidence mismatch: each detector's source
  was isolated from its module and tested for whether it references its `body`
  parameter, then joined against the `type` field in its JSON definition.
- Everything else is direct source reading, cited by file and line.
