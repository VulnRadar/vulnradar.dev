# Admin Runtime Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-form key/value `system-settings-manager.tsx` screen with a
tabbed settings page whose tab list and fields are derived entirely from
`SETTINGS_REGISTRY` (`lib/config/registry.ts`), backed by two new actions on
`app/api/v3/admin/features/route.ts` (`effective`, `reset`).

**Architecture:** A pure, DOM-free derivation module
(`components/admin/features/settings-registry-utils.ts`) computes the tab
list, per-tab field list, destructive-toggle detection, and value formatting
from `SETTINGS_REGISTRY`, this is the part that gets unit tests, since the
project has no jsdom/RTL setup and `vitest` runs in `environment: "node"`.
The React component (`system-settings-manager.tsx`) is a thin consumer of
that module plus two new API actions. A single `changes` state object spans
all tabs (not reset per tab) so switching tabs never discards an edit; each
tab's Save button only submits the subset of `changes` whose registry key
belongs to that tab.

**Tech Stack:** Next.js 15 App Router, TypeScript, Zod (via registry.ts),
Radix Tabs/Select/Switch (`components/ui/*`), existing
`SaveConfirmationModal` / `ConfirmDialog`, Vitest (node environment, no DOM).

## Global Constraints

- Do not modify `lib/config/registry.ts` or `lib/config/runtime-config.ts`.
- No em dashes in any user-facing copy or comments.
- No `git`, no `npm run build` / `npm run dev`.
- Verify with `npx tsc --noEmit`, `npx eslint <changed files>`, the new/changed
  test suites, and `npx prettier --write <changed files>`.
- Tests mirror source path under `tests/`, mocked at the DB boundary (see
  `tests/README.md`).
- New testable source files get an entry in `vitest.config.ts`'s
  `coverage.thresholds` (per-file, a few points below measured).
- The tab list, and every field on every tab, must be computed from
  `SETTINGS_REGISTRY` at runtime, no hardcoded group name list, no
  hardcoded per-field JSX beyond a `type`-keyed switch.

---

### Task 1: Effective-value and reset actions on the admin features route

**Files:**

- Modify: `app/api/v3/admin/features/route.ts` (inside the existing
  `if (section === "system_settings")` block, alongside `get`/`set`/`list`)
- Test: `tests/app/api/v3/admin/features/route.test.ts` (existing file, add
  `describe` blocks)

**Interfaces:**

- Consumes: `getSettings` (new import from `@/lib/config/runtime-config`,
  already exports it), `SETTINGS_REGISTRY`, `SettingKey` (new imports from
  `@/lib/config/registry`, already exports both).
- Produces: `POST { section: "system_settings", action: "effective" }` →
  `{ effective: Record<SettingKey, string | number | boolean>, overridden: SettingKey[] }`.
  `POST { section: "system_settings", action: "reset", key }` → `{ success: true, default }`
  on a known registry key, `400 { error }` on an unknown key. Both call
  `invalidateSettingsCache()` is only relevant for `reset` (it deletes a row);
  `effective` is read-only.

Add, inside the `system_settings` section:

```ts
if (action === "effective") {
  const keys = Object.keys(SETTINGS_REGISTRY) as SettingKey[];
  const [effective, overriddenResult] = await Promise.all([
    getSettings(keys),
    pool.query<{ key: string }>(
      `SELECT key FROM system_settings WHERE key = ANY($1)`,
      [keys],
    ),
  ]);
  return NextResponse.json({
    effective,
    overridden: overriddenResult.rows.map((r) => r.key),
  });
}

if (action === "reset") {
  const { key } = body;
  if (typeof key !== "string" || !isSettingKey(key)) {
    return NextResponse.json({ error: "Unknown setting key" }, { status: 400 });
  }
  const oldResult = await pool.query(
    `SELECT value FROM system_settings WHERE key = $1`,
    [key],
  );
  const oldValue = oldResult.rows[0]?.value;
  await pool.query(`DELETE FROM system_settings WHERE key = $1`, [key]);
  invalidateSettingsCache();
  await logAction(
    user.id,
    null,
    "system_setting_reset",
    `Reset "${key}" to its default (was "${oldValue ?? "(not set)"}")`,
    ip,
  );
  return NextResponse.json({
    success: true,
    default: SETTINGS_REGISTRY[key].default,
  });
}
```

Update the top-of-file import lines:

```ts
import {
  isSettingKey,
  validateSettingValue,
  SETTINGS_REGISTRY,
  type SettingKey,
} from "@/lib/config/registry";
import {
  invalidateSettingsCache,
  getSettings,
} from "@/lib/config/runtime-config";
```

- [ ] Step 1: Add tests to `tests/app/api/v3/admin/features/route.test.ts`
      covering: `effective` returns the resolver's values and only the keys with
      a DB row in `overridden`; `reset` issues a `DELETE` (not an `UPDATE`/`INSERT`
      with the default value) and audit-logs it; `reset` on an unknown key 400s
      without touching the database; `reset` on a legacy non-registry key 400s.
      Also extend the existing lockout coverage: loop every `RATE_LIMIT_LOGIN_*`,
      `RATE_LIMIT_SIGNUP_*`, `RATE_LIMIT_FORGOT_PASSWORD_*` key and assert `set`
      to `0` 400s for all of them, not just `RATE_LIMIT_LOGIN_ATTEMPTS` (already
      covered once; broaden it here at the route level to match the guard-rail
      requirement to test this directly).
- [ ] Step 2: Run `npx vitest run tests/app/api/v3/admin/features/route.test.ts`.
      Expect failures (new actions do not exist yet).
- [ ] Step 3: Implement the route changes above.
- [ ] Step 4: Re-run the suite. Expect pass.
- [ ] Step 5: Add a `vitest.config.ts` `coverage.thresholds` entry for
      `app/api/v3/admin/features/route.ts` once `npm run test:coverage` reports a
      number (this file previously had a test suite but no threshold entry).

---

### Task 2: Pure registry-derivation utilities

**Files:**

- Create: `components/admin/features/settings-registry-utils.ts`
- Test: `tests/components/admin/features/settings-registry-utils.test.ts`
- Modify: `vitest.config.ts` (add `"components/**/*.ts"` to `coverage.include`,
  plus a threshold entry for this new file)

**Interfaces:**

- Consumes: `SETTINGS_REGISTRY`, `SettingDefinition`, `SettingKey`,
  `SettingGroup` from `@/lib/config/registry` (read-only).
- Produces (consumed by Task 3's component and by this task's tests):
  - `type FieldValue = string | number | boolean`
  - `SETTINGS_TABS: string[]`, deduplicated `group` values in first-seen
    registry order.
  - `FIELDS_BY_GROUP: Record<string, [SettingKey, SettingDefinition][]>`
  - `tabHasBuildTierFields(group: string): boolean`
  - `formatFieldValue(value: FieldValue): string` (boolean → "Yes"/"No", else `String(value)`)
  - `isDestructiveToggle(key: string, newValue: FieldValue): boolean`, true
    when `newValue === false` and (`key === "BILLING_ENABLED"` or `key.startsWith("FEATURE_")`)
  - `looksLikeEmail(value: string): boolean`, `looksLikeUrl(value: string): boolean`
    (basic client-side hints only, not a replacement for server validation)
  - `effectiveValueFor(key: SettingKey, effective: Partial<Record<SettingKey, FieldValue>>): FieldValue`
    , `effective[key] ?? SETTINGS_REGISTRY[key].default`

- [ ] Step 1: Write the failing test file exercising every export above,
      including: `SETTINGS_TABS` has no duplicates and its order matches the
      order groups first appear in `Object.values(SETTINGS_REGISTRY)`; every
      registry key appears in exactly one `FIELDS_BY_GROUP` bucket and the union
      of all buckets' keys equals `Object.keys(SETTINGS_REGISTRY)`;
      `tabHasBuildTierFields("Branding")` is `true` and
      `tabHasBuildTierFields("Rate Limits")` is `false`; `isDestructiveToggle`
      is true for `("BILLING_ENABLED", false)` and `("FEATURE_TEAMS", false)`,
      false for `("BILLING_ENABLED", true)` and false for
      `("SCAN_AUTH_ENABLED", false)` (bool, but not billing/feature-prefixed).
- [ ] Step 2: Run `npx vitest run tests/components/admin/features/settings-registry-utils.test.ts`.
      Expect FAIL (module does not exist).
- [ ] Step 3: Implement `settings-registry-utils.ts`.
- [ ] Step 4: Re-run. Expect PASS.
- [ ] Step 5: Run `npm run test:coverage`, read the file's line percentage,
      add a `vitest.config.ts` threshold entry a few points below it, and add
      `"components/**/*.ts"` to `coverage.include`.

---

### Task 3: `beforeunload` unsaved-changes hook

**Files:**

- Create: `components/admin/shared/use-unsaved-changes-warning.ts`
- Test: `tests/components/admin/shared/use-unsaved-changes-warning.test.ts`
- Modify: `components/admin/shared/index.ts` (barrel export)

**Interfaces:**

- Produces: `attachBeforeUnloadWarning(target: { addEventListener; removeEventListener }, shouldWarn: () => boolean): () => void`
  (pure, DOM-injectable, testable in node) and
  `useUnsavedChangesWarning(hasUnsavedChanges: boolean): void` (thin
  `useEffect` wrapper calling the above against `window`, not itself tested ,
  no jsdom in this project's Vitest setup).

- [ ] Step 1: Write the failing test: registering attaches one
      `beforeunload` listener; invoking the captured handler with
      `shouldWarn` returning `true` calls `event.preventDefault()` and sets
      `event.returnValue`; invoking it with `shouldWarn` returning `false` does
      neither; the returned cleanup calls `removeEventListener` with the exact
      handler reference that was added.
- [ ] Step 2: Run the suite. Expect FAIL.
- [ ] Step 3: Implement the file.
- [ ] Step 4: Re-run. Expect PASS. Add the coverage threshold entry.

---

### Task 4: Rebuild `system-settings-manager.tsx`

**Files:**

- Modify: `components/admin/features/system-settings-manager.tsx`
  (structural rebuild; keep the `Database Cleanup` card as-is; drop the
  dead `maintenance_mode` / `maintenance_message` free-form toggle, which is
  not in `SETTINGS_REGISTRY`, is read nowhere in the app per the plan doc's
  own grep, and contradicts the point of this rebuild if kept as a fake
  control)
- Create: `components/admin/features/settings-field.tsx` (one field row:
  label, help, type-driven control, Customized/Default badge, reset button)

Not unit tested (no rendering harness in this project; consistent with every
other `.tsx` under `components/admin/`). Behavior to implement, derived from
Tasks 1-3:

- Radix `Tabs` with `TabsList` built from `SETTINGS_TABS`; each `TabsContent`
  renders `FIELDS_BY_GROUP[group]` through `SettingField`.
- On mount, POST `{ section: "system_settings", action: "effective" }`, store
  `effective` and `overridden` (as a `Set`).
- Single `changes: Partial<Record<SettingKey, FieldValue>>` state spanning
  every tab. A tab's displayed pending count = number of its fields present
  in `changes`. Save/Discard for a tab only touch that tab's subset.
- Tier-2 tabs (`tabHasBuildTierFields`) render one persistent banner at the
  top of the tab content: changes save immediately to the database but only
  take visual effect on the next build/deploy.
- Save opens `SaveConfirmationModal` with `changes` built from the active
  tab's pending subset (`oldValue` = `effectiveValueFor`, `newValue` = the
  pending value). If any pending change in the tab is
  `isDestructiveToggle`, pass `variant="destructive"` and set `description`
  to the changed field(s)' own `def.help` text (already written as the "real
  consequence" copy; no new hardcoded copy).
- On confirm, `POST action: "set"` once per changed key in the tab
  (sequential is fine; the admin's own action, no need for a batch
  endpoint), collect failures, apply the successes optimistically (`effective`,
  `overridden`, clear from `changes`), and show unresolved failures inline
  (this component has no `showToast` prop today and I am not adding one;
  keep it self-contained, matching its current signature of taking no props).
- Reset button appears per field when `overridden.has(key)`. Opens
  `ConfirmDialog` ("Reset to default", description names the field's label
  and its shipped default via `formatFieldValue`). On confirm, `POST action:
"reset"`; on success, clear `overridden` membership, set `effective[key]`
  to the registry default, and drop any pending `changes[key]`.
- Export button (header row, next to Refresh): builds
  `Object.fromEntries([...overridden].map((k) => [k, effective[k]]))` and
  downloads it as `vulnradar-settings-export.json` via a `Blob` + temporary
  `<a>`. No new endpoint; the data is already loaded client-side.
- `useUnsavedChangesWarning(Object.keys(changes).length > 0)` at the top of
  the component.
- Every number input gets `min`/`max` from the registry when present; every
  email/url input shows a small inline hint (not a blocker) when
  `looksLikeEmail`/`looksLikeUrl` returns false and the field is non-empty.

- [ ] Step 1: Implement `settings-field.tsx`.
- [ ] Step 2: Implement the rebuilt `system-settings-manager.tsx`.
- [ ] Step 3: `npx tsc --noEmit` and `npx eslint` the two files; fix.

---

### Task 5: Documentation

**Files:**

- Modify: `app/docs/config/page.tsx`, new `DocsSection` ("Admin Settings
  Page") covering: runtime vs. build tier, `database ?? env ?? default`
  resolution order, ~30s cache TTL propagation, reset-to-default deletes the
  row rather than writing the default. Include a `DocsTable` generated by
  mapping `Object.entries(SETTINGS_REGISTRY)` (imported directly, it is
  already proven safe to import client-side, see Task 2) grouped by `group`,
  columns: Setting / Tier / Type / Default / Description.
- Modify: `app/docs/self-hosting/page.tsx`, short addition to the existing
  `id="admin"` ("First Admin User") section: after promoting the account,
  sign in, open `/admin`, go to Settings, and configure limits/flags there
  instead of editing `config-values.ts` directly.
- Modify: `AGENTS.md`, add a line under a `# Configuration` (new) heading:
  a new configurable value is a new `SETTINGS_REGISTRY` entry in
  `lib/config/registry.ts`, not a bare `CONFIG_*` constant.

- [ ] Step 1: Add the AGENTS.md rule.
- [ ] Step 2: Add the self-hosting note.
- [ ] Step 3: Add the config page section with the generated table.
- [ ] Step 4: `npx tsc --noEmit` and `npx eslint` the two page files.

---

### Task 6: Final verification

- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npx eslint` on every file touched in Tasks 1-5.
- [ ] Run `npx vitest run tests/app/api/v3/admin/features/route.test.ts tests/components/admin/features/settings-registry-utils.test.ts tests/components/admin/shared/use-unsaved-changes-warning.test.ts`.
- [ ] Run `npx prettier --write` on every file touched.
- [ ] Run the full `npm test` once to confirm nothing else regressed.
