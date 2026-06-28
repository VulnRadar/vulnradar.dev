# VulnRadar Audit System

Lightweight internal audit framework. Replaces the old date-named
`audits/YYYY-MM-DD-<slug>.md` convention that broke down as soon as
more than one audit per day was needed.

## Naming

Every audit is identified by **`AUDIT-NNN`** — zero-padded sequential
ID. The ID is allocated at creation time and never reused. The date
the audit was created lives in `manifest.json`, not in the ID.

```
audits/
├── README.md
├── registry.json
├── AUDIT-001/
│   ├── manifest.json     # id, title, scopes, status, summary
│   ├── findings.json     # list of Finding objects
│   └── notes.md          # free-form notes
├── AUDIT-002/
│   └── ...
```

## Finding IDs

Each audit's findings are scoped to that audit. Format: `<scope>-NN`
(`auth-01`, `crypto-02`, `rate-limit-01`, ...). Code comments reference
findings as `ref: AUDIT-001#auth-01`.

## CLI

```bash
# Create a new audit. Allocates the next ID.
node scripts/audit/new.mjs "<title>" --scope auth,crypto

# Append a finding.
node scripts/audit/add-finding.mjs AUDIT-001 auth-01 critical ssrf \
  "safeFetch follows redirects without re-validation" \
  "Cloud metadata exfil via 302" \
  "Manual redirect loop with per-hop validateScanTarget" \
  "lib/scanner/safe-fetch.ts"

# List audits.
node scripts/audit/list.mjs

# Show one audit + its findings.
node scripts/audit/show.mjs AUDIT-001

# Close / ship an audit.
node scripts/audit/close.mjs AUDIT-001 --status shipped --commit bcc9e86
```

## Why not dates?

Date-based filenames can't disambiguate two audits on the same day.
Sequential IDs always can. The date is still recorded in `manifest.json`
for ordering and filtering — it's metadata, not identity.

## Why not full docs in each audit folder?

The audit report lives in the commit message + the manifest's `summary`
field. Long-form prose belongs in `docs/` or `app/changelog/`. The
audit folder holds structured data only — finding IDs are stable,
parseable, and referenceable from code comments.

## Adding a new finding

Findings get appended, never rewritten. The `id` field is the join
key: a code comment says `ref: AUDIT-001#auth-01`, the corresponding
JSON entry in `audits/AUDIT-001/findings.json` has `"id": "auth-01"`.
That makes the audit traceable from code back to the original report.

## Scope tags

`auth`, `session`, `crypto`, `ssrf`, `csrf`, `headers`, `rate-limit`,
`db`, `secrets`, `scanner`, `api`, `infra`, `i18n`, `perf`, `a11y`,
`deps`, `build`, `ci`, `misc`. Used for filtering and grouping;
not load-bearing.
