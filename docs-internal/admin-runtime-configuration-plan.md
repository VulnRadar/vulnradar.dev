# Plan: Admin-Configurable Runtime Settings

**Status:** Not started. This is a design document, not a description of
existing behaviour.

**Goal:** A self-hoster deploys VulnRadar, signs in as admin, and can change
every setting that is safe to change at runtime from an admin page. The values
we ship stay the defaults. A value edited in the admin panel wins over the
default. Nothing requires a rebuild or a redeploy.

---

## Where things stand today

`lib/config/config-values.ts` exports **108** `CONFIG_*` constants.
`lib/config/constants.ts` re-exports **103** of them under friendlier names.
**82** server files and **75** client components import from that module.

The `system_settings` table already exists (`key`, `value`, `description`,
`setting_type`, `updated_by`, `updated_at`) and the admin UI at
`components/admin/features/system-settings-manager.tsx` can list and set rows
through `POST /api/v3/admin/features` with `section: "system_settings"`.

**Nothing in the application ever reads that table.** Grep for `system_settings`
outside the admin component and the admin route and there are no hits. Rows can
be written and listed, and they change nothing. That is the whole reason the
settings page appears not to work: it is a functioning CRUD screen attached to
nothing.

So the work is not "build a settings page." The page exists. The work is
building the resolution layer underneath it and then pointing the code at that
layer instead of at the constants.

---

## The constraint that shapes everything

Next.js resolves `export const metadata` **at build time** for statically
generated pages. The last production build emitted **124 static pages**, and
**30** files export metadata.

If `APP_NAME` is read from the database, every page whose title contains the app
name stops being static. It becomes a per-request server render, or it needs
ISR with a revalidation window. Either way the site gets slower, and page speed
is a ranking signal, so making SEO metadata database-driven would work against
the SEO work it is meant to support.

This is not a reason to abandon the idea. It is the reason the config surface
has to be split into tiers rather than moved wholesale.

The same constraint applies to client components in a different form. A client
component imports `APP_NAME` at module scope, and the bundler inlines the value
into the JavaScript bundle. There is no synchronous way to make that read a
database. 36 client components reference `APP_NAME`, 22 reference `ROUTES`.
Those either stay build-time or move to a context provider fed by the server.

---

## Three tiers

Every `CONFIG_*` constant gets classified into exactly one tier. The tier
decides whether it appears in the admin UI and how it is read.

### Tier 1: Runtime configurable (the admin panel's job)

Read through the resolver on every use. Changing one takes effect within the
cache TTL with no deploy. These are values consumed on the server, at request
time, where a database read is already happening anyway.

Roughly 60 of the 108 constants, including:

| Group          | Examples                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Rate limits    | `RATE_LIMIT_LOGIN_ATTEMPTS`, `RATE_LIMIT_SIGNUP_*`, `RATE_LIMIT_API_*`, `RATE_LIMIT_SCAN_*`, `RATE_LIMIT_BULK_SCAN_*` |
| Scanning       | `MAX_URL_LENGTH`, `MAX_URLS_BULK`, `SCAN_TIMEOUT_SECONDS`, `BULK_SCAN_TIMEOUT_SECONDS`, `DEFAULT_SEVERITY_THRESHOLD`  |
| Billing        | `BILLING_ENABLED`, all four plan limits, all four retention values, `BILLING_UNLIMITED_MODE_LIMIT`                    |
| Feature flags  | `FEATURE_DEMO_MODE`, `FEATURE_TEAMS`, `FEATURE_API_KEYS`, `FEATURE_WEBHOOKS`, `FEATURE_SCHEDULED_SCANS`, and the rest |
| Auth windows   | `SESSION_TIMEOUT_DAYS`, `PASSWORD_RESET_HOURS`, `EMAIL_VERIFICATION_HOURS`, `DEVICE_TRUST_DAYS`                       |
| AI             | `AI_CHAT_MAX_TOKENS`, `AI_CHAT_HISTORY_DAYS`, `AI_CHAT_MAX_INPUT_LENGTH`, all four `AI_VERIFY_*`                      |
| Demo           | `DEMO_SCAN_LIMIT`, `DEMO_WINDOW_HOURS`                                                                                |
| Limits         | `MAX_EMAIL_LENGTH`, `MAX_NAME_LENGTH`, `MAX_TAGS_PER_SCAN`, pagination defaults                                       |
| Browserbase    | `BROWSERBASE_MAX_TTL_SECONDS`, `BROWSERBASE_DEFAULT_TTL_SECONDS`                                                      |
| Beta banner    | `BETA_ENABLED`, `BETA_BANNER_MESSAGE`                                                                                 |
| Contact emails | `SUPPORT_EMAIL`, `LEGAL_EMAIL`, `SECURITY_EMAIL`, `ENTERPRISE_EMAIL`, `NOREPLY_EMAIL`                                 |

### Tier 2: Build-time (editable in admin, applies on next build)

Baked into static HTML. Show them in the admin UI so a self-hoster has one
place to look, but label them clearly and surface a "rebuild required" notice
after saving. Writing them updates the database, and the build reads the
database when generating pages.

- `APP_NAME`, `APP_SLUG`, `APP_DESCRIPTION`, `APP_URL`, `TOTAL_CHECKS_LABEL`
- Every `SEO_*` value: tagline, keywords, OG image and dimensions, locale,
  language, verification tokens, social handles, founding year, license
- `LOGO_URL`, `PRIMARY_COLOR`, `BACKGROUND_COLOR_DARK`, `BACKGROUND_COLOR_LIGHT`,
  `FOOTER_TEXT`
- `TERMS_UPDATED_AT`, `APP_REPO`, `DISCORD_INVITE_URL`

There is a middle option worth considering for a few of these: keep the page
static but render the value client-side from the config context, accepting a
flash of the build-time value. Probably not worth it for the app name. Possibly
worth it for the beta banner, which is Tier 1 anyway.

### Tier 3: Never runtime configurable

Do not expose these. Some are code-coupled, some break live sessions, some are
secrets.

| Constant                                                                                            | Why                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `APP_VERSION`, `ENGINE_VERSION`, `MIN_SCHEMA_VERSION`                                               | Describe the running code. Editing them makes the app lie about itself.  |
| `SESSION_COOKIE_NAME`, `DEVICE_TRUST_COOKIE_NAME`, `2FA_PENDING_COOKIE_NAME`, `VERSION_COOKIE_NAME` | Changing a cookie name signs out every user instantly and orphans rows.  |
| `API_KEY_PREFIX`                                                                                    | Existing keys carry the old prefix. Changing it invalidates lookups.     |
| `API_CURRENT_VERSION`, `API_SUPPORTED_VERSIONS`                                                     | Routes exist on disk. A value pointing at a non-existent version 404s.   |
| `TOTP_VALIDITY_SECONDS`                                                                             | RFC 6238 interoperability. Authenticator apps assume 30.                 |
| `CLEANUP_INTERVAL_MS`                                                                               | Read once at module load. A runtime change would not take effect anyway. |
| Anything in `.env`                                                                                  | Secrets do not belong in a table admins can read.                        |

---

## Resolution order

```
resolve(key) = database value  ??  environment override  ??  shipped default
```

Database first, because that is the layer the admin edits and the whole point
is that the admin panel wins.

Environment second, so a container can pin a value without a database write.

The shipped `CONFIG_*` constant last, so a fresh install behaves exactly as it
does today with an empty `system_settings` table. This also means the migration
is safe: before anyone touches the admin panel, every resolve returns the same
value the constant returns now.

Secrets stay env-only and never enter this chain.

---

## Caching

A resolve on every use cannot hit Postgres each time. `checkRateLimit` alone
would add several queries per request.

**Load the whole table at once, not key by key.** It is on the order of 60 rows.
One query gets everything.

```ts
// lib/config/runtime-config.ts (sketch, not final)
let cache: { values: Map<string, string>; loadedAt: number } | null = null;
const TTL_MS = 30_000;

async function load(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.values;
  const { rows } = await pool.query("SELECT key, value FROM system_settings");
  cache = {
    values: new Map(rows.map((r) => [r.key, r.value])),
    loadedAt: Date.now(),
  };
  return cache.values;
}
```

Three properties this needs:

1. **Bounded staleness.** A 30 second TTL means a change propagates to every
   instance within 30 seconds without any coordination. That is fine for rate
   limits and feature flags. It is the simplest thing that works across
   multiple server processes.

2. **Immediate invalidation in the writing process.** The admin route clears the
   cache after a successful write, so the admin sees their own change reflected
   at once rather than waiting out the TTL. Other instances converge via TTL.

3. **Fail open to defaults.** If the query throws, return the shipped defaults
   and log. A database blip must not take the site down or silently disable
   billing. This matters: a failed read that returned an empty map would make
   every feature flag false.

If 30 seconds turns out to be too slow, the upgrade path is a
`settings_version` integer bumped on write, with a cheap `SELECT version` check
gating the full reload. Do not build that until the simple version proves
insufficient.

For values read many times inside one request, wrap the loader in React's
`cache()` so a single request does at most one lookup regardless of TTL.

---

## The client component problem

75 client components import constants at module scope. Three options, in order
of preference:

1. **Leave them build-time.** Most of what client components read is Tier 2
   anyway: `APP_NAME` (36 files), `ROUTES` (22 files). Routes are code paths and
   should never be runtime-editable. This is the cheapest correct answer for
   most of the 75.

2. **A `ConfigProvider`.** The root server layout resolves the public runtime
   config once and passes it to a client context, the same shape as the existing
   `AuthProvider`. Client components that genuinely need a runtime value read it
   through `useConfig()`. Applies to `BILLING_ENABLED` (6 client files), which is
   a real feature flag an admin would want to toggle live.

3. **Server components.** Where a component only needs the value for initial
   render, move that read to a server parent and pass it down as a prop.

Only migrate a client component when its value is genuinely Tier 1. Do not
convert all 75.

---

## Typed schema instead of loose strings

The existing table stores `value TEXT` with a `setting_type` column that nothing
enforces. An admin who types `"yes"` into a boolean, or `-5` into a rate limit,
should be rejected at the API rather than discovered at runtime.

Define one registry that drives the resolver, the validation, and the admin UI:

```ts
// lib/config/registry.ts (sketch)
export const SETTINGS_REGISTRY = {
  RATE_LIMIT_LOGIN_ATTEMPTS: {
    tier: "runtime",
    type: "int",
    min: 1,
    max: 100,
    default: CONFIG_RATE_LIMIT_LOGIN_ATTEMPTS,
    group: "Rate Limits",
    label: "Login attempts per window",
    help: "Failed logins allowed from one IP before lockout.",
  },
  // ...
} as const satisfies Record<string, SettingDefinition>;
```

Everything derives from this one object: the admin form fields and their
grouping, server-side validation on write, the resolver's fallback, and the
generated documentation page. Adding a setting means adding one entry, which is
the same property the SEO route table has.

Zod already ships in this project, so the validators can be real schemas rather
than hand-rolled checks.

---

## Admin UI shape

One page, tabs across the top, one tab per registry `group`. Not a single
scrolling list: there are 60+ Tier 1 fields and a flat page makes finding
anything hopeless and makes an accidental edit easy.

Tabs, matching the `group` values in the registry:

| Tab            | Contents                                                                        |
| -------------- | ------------------------------------------------------------------------------- |
| General        | App name, description, URL, contact emails, footer text                         |
| Branding       | Logo, primary colour, background colours (Tier 2, rebuild notice)               |
| SEO            | Tagline, keywords, OG image, verification tokens, locale (Tier 2)               |
| Features       | Every `FEATURE_*` flag as a switch                                              |
| Billing        | `BILLING_ENABLED`, the four plan limits, the four retention values              |
| Rate Limits    | Login, signup, forgot-password, API, scan, bulk scan                            |
| Scanning       | URL length, bulk URL cap, scan timeouts, default severity threshold             |
| Authentication | Session timeout, password reset window, email verification window, device trust |
| AI             | Chat token budget, history retention, input cap, the four verify timeouts       |
| Demo           | Demo scan limit and window                                                      |
| Advanced       | Pagination, field length caps, Browserbase TTLs, beta banner                    |

Rules for the page:

- The tab list is **derived from the registry**, never hardcoded. Adding a
  setting with a new `group` creates its tab automatically. This is the same
  property `lib/seo/routes.ts` has, and it is the reason the registry exists.
- Each tab saves independently, so a mistake in one tab cannot be submitted
  alongside unrelated edits.
- A tab shows a dot or count when it holds unsaved changes, so switching tabs
  mid-edit does not silently lose work. Warn before navigating away with
  pending changes.
- Fields overridden from their default get a visible marker plus the "reset to
  default" control, so an admin can tell at a glance what this instance has
  changed versus what it inherited.
- Tier 2 tabs (Branding, SEO) carry a persistent banner explaining that changes
  apply on the next build, rather than a per-field note repeated 20 times.
- Follow the existing admin styling and `SaveConfirmationModal`, which
  `system-settings-manager.tsx` already uses, so this does not become a second
  visual language inside the admin area.

## Documentation

This is not done until it is documented. Two places, both required:

1. **`/docs/config`** already exists as the configuration reference and
   currently describes the two-layer file and env model. It needs a third
   section covering the admin settings page: which settings are runtime versus
   rebuild-required, the database-over-env-over-default resolution order, the
   propagation delay from the cache TTL, and the reset-to-default behaviour.
   Ideally the per-setting table on that page is **generated from the registry**
   so it cannot drift from the code the way the README numbers did.

2. **`/docs/self-hosting`** needs a short "first run" section: after
   `db:create`, sign in as admin, open Settings, and adjust limits and feature
   flags from there rather than editing `config-values.ts`. This is the workflow
   the whole feature exists to enable, and a self-hoster will not discover it on
   their own.

Also update `AGENTS.md` with the rule that a new configurable value means a new
registry entry, not a new bare constant.

## Guard rails

A settings panel that can break the deployment is worse than no panel.

- **Nothing can lock out the admin.** Never allow a value that disables admin
  login or sets a rate limit to zero on the auth routes. Enforce minimums in
  the registry.
- **Audit every write.** `logAction` is already called by the existing handler.
  Keep that, and record old and new values, which it already does.
- **Confirmation on destructive toggles.** Turning off `BILLING_ENABLED` or
  `FEATURE_TEAMS` on a live instance changes what paying users can reach.
- **Reset to default.** Every field needs a one-click revert that deletes the
  row rather than writing the default value, so the shipped default keeps
  applying if we change it in a later release.
- **Export and import.** A JSON dump of non-default settings makes support and
  environment cloning tractable.

---

## Phasing

Each phase ships on its own and leaves the app working.

**Phase 1: Resolver and registry.** Build `lib/config/registry.ts` and
`lib/config/runtime-config.ts` with the cache. Classify all 108 constants into
tiers. Nothing consumes the resolver yet. Tests cover resolution order, TTL
expiry, invalidation on write, and fail-open on a database error.

**Phase 2: One vertical slice.** Move rate limits only. They are server-only,
already adjacent to a database call, and easy to verify. Point
`lib/rate-limiting/rate-limit.ts` at the resolver. Prove the whole path works
end to end before touching anything else.

**Phase 3: Admin UI rebuild.** Replace the current free-form key/value screen
with a **tabbed** settings page generated from the registry. One flat list of
60+ fields is unusable, so each registry `group` becomes its own tab and the
form for that tab renders only its own fields. See "Admin UI shape" below.

**Phase 4: Remaining Tier 1 groups.** Feature flags, billing limits, scan
limits, AI settings, auth windows, demo limits, contact emails. One group per
commit.

**Phase 5: `ConfigProvider` for client components.** Only for values that are
genuinely Tier 1 and genuinely needed client-side. Start with
`BILLING_ENABLED`.

**Phase 6: Tier 2 at build time.** Make the build read `system_settings` when
generating metadata, and add the "rebuild required" notice in the admin UI.
This phase is optional and can be dropped if it proves fragile: editing
`config-values.ts` and redeploying is a legitimate workflow for values that only
change when someone forks the project.

---

## Honest assessment

Phases 1 through 4 are clearly worth doing. They cover the settings a self-hoster
actually wants to change (limits, flags, retention, timeouts), they are all
server-side where a database read is free, and the resolver is maybe 150 lines
plus a registry.

Phase 5 is worth doing narrowly and not worth doing broadly. Converting 75
client components to a context to make the app name editable at runtime is a
large diff for a value that changes once per fork.

Phase 6 is the one to be sceptical about. It trades static generation, which the
SEO work depends on, for the ability to edit a tagline without a deploy. If it
gets built, it must keep pages static and read the database at build time only.
A per-request database read for a page title would be a clear regression.

The single highest-value change is smaller than any of this: make
`system_settings` actually be read by something. Today it is a table the admin
can write to that has no effect anywhere, which is worse than not having the
screen, because it implies a capability that does not exist.
