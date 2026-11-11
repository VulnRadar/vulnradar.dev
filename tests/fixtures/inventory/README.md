# Software inventory fixtures

One directory per response a server really sent (or one built by hand to prove
a rule). The fingerprint tables under `lib/scanner/inventory/` are tested
against these, so adding a product means a table entry plus a fixture here, not
a new regular expression in a code path.

```
tests/fixtures/inventory/<slug>/
  headers.txt   the final-hop response: status line, then Name: value; Set-Cookie repeated
  body.html     the reduced body
  expect.json   what the engine must and must not find
```

`expect.json`:

```json
{
  "kind": "real",
  "capturedAt": "2026-10-31",
  "url": "https://example.test/login",
  "must": [
    { "name": "Laravel", "minConfidence": 95 },
    {
      "name": "PHP",
      "minConfidence": 90,
      "version": "8.4.27",
      "versionKind": "exact"
    }
  ],
  "mustNot": ["WordPress"]
}
```

- `kind` is `real` for a capture and `synthetic` for a hand-built page. A rule
  with provenance `vendor-docs` (written from documentation, no capture behind
  it) needs a `synthetic` fixture so a reviewer can see which rules are
  unproven.
- `url` is the page's address with the host replaced by `example.test`. It is
  the base the engine resolves relative links against, so same-origin and
  cross-origin links keep their shape.
- `must` entries need a `name`; `minConfidence`, `version` and `versionKind` are
  optional. An implied product (PHP from Laravel) needs no table entry of its
  own to appear here.
- `mustNot` is for false positives the table has to keep avoiding: a Redmine
  page that must not become Laravel, a page with only an `XSRF-TOKEN` cookie.

Name a fixture after the stack (`laravel-livewire-billing-portal`), never after
a customer's domain. The one exception is a product's own public demo
(`paymenter-default`, `pterodactyl-panel`).

## Making one

```
node scripts/maintenance/sanitize-inventory-fixture.mjs \
  --headers raw-headers.txt --body raw-body.html \
  --url https://real.host/login --slug laravel-livewire-billing-portal \
  --must Laravel:95 --must-not WordPress
```

The script (`scripts/maintenance/sanitize-inventory-fixture.mjs`) does the
mechanical part of the capture rules:

- keeps only the final hop of a redirect chain;
- replaces the scanned host with `example.test`, other subdomains of the same
  registered domain with `<sub>.example.test`, and the bare domain with
  `apex.example.test`;
- keeps cookie and header NAMES, and replaces every cookie value and CSRF token
  with `x` of the same length, keeping a fingerprint-bearing prefix
  (`eyJpdiI6`, the start of Laravel's encrypted payload);
- flattens `cf-ray` to `0000000000000000-XXX` and drops `Report-To`, `NEL`,
  `Authorization` and `Cookie`;
- masks token-looking meta tags, hidden inputs, nonces, JWTs, bearer tokens and
  JSON values under keys such as `password`, `token` and `apiKey`, and empties
  the `config` object in `window.SiteConfiguration` (the Pterodactyl demo page
  inlines demo logins there);
- replaces emails and IP addresses;
- reduces the body to the whole `<head>`, every script, link, meta, hidden input
  and form tag, and the first 2 KB of `<body>`.

Then read both files before committing. Two things the script cannot know:

- Cookie names are kept on purpose, because they are what rules match, and
  renaming `paymenter_session` would break the fixture. If a name carries a
  customer's name (`acme-llc-session`), decide whether to rename it to
  something with the same shape (`example-llc-session`).
- A page title, an `og:site_name` or a footer can name the customer in plain
  text.

A hand-built page needs no sanitizing: write `headers.txt`, `body.html` and
`expect.json` directly, with `"kind": "synthetic"`.

## Writing rules that pass the safety gate

Every regular expression in a table runs against attacker-controlled markup of
up to 1 MiB in the process that serves every other scan.
`tests/lib/scanner/inventory/perf.test.ts` exports `assertLinear(regex)`, which
runs a pattern against adversarial shapes and its own opening text repeated
5,000 times at 256 KB with a ceiling of 100 ms. A pattern shaped
`<[^>]{1,512}\bwire:` fails it: the 512 is a constant cost at every `<` in the
document. Use an `attr` rule (the tag scanner reads attribute names in one
pass) or an `asset` rule instead of an `html` rule wherever the signal is a
tag, an attribute or a URL.
