// SETTINGS REGISTRY UI UTILITIES
//
// Pure, DOM-free derivation from SETTINGS_REGISTRY (lib/config/registry.ts)
// for the admin settings page. Nothing here talks to the network or the
// DOM, so it is unit-tested directly (this project's Vitest runs in a plain
// node environment, with no jsdom/React-Testing-Library set up for the
// .tsx components themselves).
//
// system-settings-manager.tsx, settings-field.tsx and settings-blocks.tsx
// are the only consumers. Every tab, and every field on every tab, comes from the
// exports below rather than a hardcoded list, so a new SETTINGS_REGISTRY
// entry (even one with a brand new `group`) appears with zero UI changes.

import {
  SETTINGS_REGISTRY,
  type SettingDefinition,
  type SettingKey,
} from "@/lib/config/registry";

export type FieldValue = string | number | boolean;

const REGISTRY_ENTRIES = Object.entries(SETTINGS_REGISTRY) as [
  SettingKey,
  SettingDefinition,
][];

/**
 * Deduplicated `group` values in the order they first appear in the
 * registry. This is the tab list: adding an entry with a new `group`
 * inserts a new tab here automatically.
 */
export const SETTINGS_TABS: string[] = (() => {
  const seen: string[] = [];
  for (const [, def] of REGISTRY_ENTRIES) {
    if (!seen.includes(def.group)) seen.push(def.group);
  }
  return seen;
})();

/** Every registry entry, bucketed by its `group`. */
export const FIELDS_BY_GROUP: Record<
  string,
  [SettingKey, SettingDefinition][]
> = (() => {
  const buckets: Record<string, [SettingKey, SettingDefinition][]> = {};
  for (const entry of REGISTRY_ENTRIES) {
    const [, def] = entry;
    (buckets[def.group] ??= []).push(entry);
  }
  return buckets;
})();

/** Human display of a resolved value: booleans read as Yes/No, else String(). */
export function formatFieldValue(value: FieldValue): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * The plan's guard rail: turning off billing or a feature flag on a live
 * instance changes what paying/existing users can reach, so the save
 * confirmation for these needs copy that names the real consequence
 * (the field's own `help` text already says it) instead of the generic
 * "Save Changes" summary. Deliberately narrow: only BILLING_ENABLED and the
 * FEATURE_* flags carry that consequence, not every boolean in the
 * registry (SCAN_AUTH_ENABLED and the IP-binding toggles are
 * real settings but do not gate access for existing users the same way).
 */
const OPERATIONAL_SWITCHES: ReadonlySet<string> = new Set([
  "MAINTENANCE_MODE",
  "PAUSE_SIGNUPS",
  "PAUSE_LOGINS",
  "PAUSE_SCANNING",
]);

export function isDestructiveToggle(
  key: string,
  newValue: FieldValue,
): boolean {
  // The operational switches are the mirror image of the flags below: the
  // consequential direction is turning one ON, not off. Ticking
  // MAINTENANCE_MODE takes the product away from every non-staff user in
  // under 30 seconds, so it gets the same "name the consequence"
  // confirmation rather than the generic save summary.
  if (newValue === true && OPERATIONAL_SWITCHES.has(key)) return true;
  return (
    newValue === false &&
    (key === "BILLING_ENABLED" || key.startsWith("FEATURE_"))
  );
}

const EMAIL_HINT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Basic client-side format hinting only. The server is the real gate. */
export function looksLikeEmail(value: string): boolean {
  if (value.trim() === "") return true;
  return EMAIL_HINT_PATTERN.test(value.trim());
}

/** Basic client-side format hinting only. The server is the real gate. */
export function looksLikeUrl(value: string): boolean {
  if (value.trim() === "") return true;
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * The value a field is showing right now: a pending local edit's already
 * handled by the caller before this is reached, this is the "at rest"
 * value: what the API's `effective` action returned, or the shipped
 * default if that key was never in the response (e.g. the fetch has not
 * completed yet).
 */
export function effectiveValueFor(
  key: SettingKey,
  effective: Partial<Record<SettingKey, FieldValue>>,
): FieldValue {
  const resolved = effective[key];
  return resolved !== undefined ? resolved : SETTINGS_REGISTRY[key].default;
}

// ---------------------------------------------------------------------
// List/keyword-shaped settings
// ---------------------------------------------------------------------

/**
 * Settings that are really a comma-separated list stored as one "string"
 * value, because the registry (lib/config/registry.ts) has no dedicated
 * list type. Add a key here to give it a tag/chip editor instead of a bare
 * text input; the stored representation does not change, still one
 * comma-separated string round-tripped through the same "set" API action.
 */
const LIST_SETTING_KEYS: ReadonlySet<string> = new Set(["SEO_KEYWORDS"]);

export function isListSetting(key: string): boolean {
  return LIST_SETTING_KEYS.has(key);
}

// ---------------------------------------------------------------------
// Prose-shaped settings
// ---------------------------------------------------------------------

/**
 * Settings whose value is a sentence or two of real prose, not a single
 * token like a URL or a slug, even when both happen to allow a similar
 * character count. These get a multi-row Textarea instead of a one-line
 * Input so the admin can actually see what they're writing/editing.
 */
const MULTILINE_SETTING_KEYS: ReadonlySet<string> = new Set([
  "APP_DESCRIPTION",
  "SEO_TAGLINE",
  "TERMS_CHANGE_SUMMARY",
]);

export function isMultilineSetting(key: string): boolean {
  return MULTILINE_SETTING_KEYS.has(key);
}

// ---------------------------------------------------------------------
// Read-only (compiled) settings
// ---------------------------------------------------------------------

/**
 * Where a compiled value actually comes from, for the read-only row that
 * replaces an input nothing would read. Every build-tier entry's default is
 * the CONFIG_ constant of the same name (registry.test.ts holds the registry
 * to that), and `env` is the build-time override when there is one.
 */
export function compiledSourceFor(key: SettingKey): {
  constant: string;
  env: string | null;
} {
  return {
    constant: `CONFIG_${key}`,
    env: (SETTINGS_REGISTRY[key] as SettingDefinition).env ?? null,
  };
}

// ---------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------

/**
 * Case-insensitive match on the label, the key and the help text, every word
 * of the query required. Two hundred and ninety settings across thirteen
 * tabs is past the point where anyone finds "session lifetime" by guessing
 * which tab it lives on.
 */
export function settingMatchesQuery(key: SettingKey, query: string): boolean {
  const words = query.toLowerCase().split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const def = SETTINGS_REGISTRY[key] as SettingDefinition;
  const haystack =
    `${def.label} ${key} ${key.replaceAll("_", " ")} ${def.help}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

// ---------------------------------------------------------------------
// Layout blocks: plan matrix, rate-limit pairs, single fields
// ---------------------------------------------------------------------

/** Registry key token for each plan, in the order plans are sold. */
export const PLAN_KEY_TOKENS = [
  "FREE",
  "CORE_SUPPORTER",
  "PRO_SUPPORTER",
  "ELITE_SUPPORTER",
] as const;
export type PlanKeyToken = (typeof PLAN_KEY_TOKENS)[number];

const PLAN_KEY_PATTERN = new RegExp(
  `^BILLING_(${PLAN_KEY_TOKENS.join("|")})_(.+)$`,
);

export interface PlanMetric {
  /** The shared suffix, e.g. "LIMIT" or "API_KEYS". */
  metric: string;
  /** "Daily scans", from the free plan's label without its plan prefix. */
  label: string;
  /** The free plan's help, reworded to describe any plan. */
  help: string;
  keys: Record<PlanKeyToken, SettingKey>;
}

/**
 * The free plan's help text, reworded so it reads for every column. The
 * per-plan wording differs only in which plan it names plus the occasional
 * aside, and the full per-plan text stays on each input for assistive tech.
 */
export function generalizePlanHelp(help: string): string {
  return help
    .replaceAll("a free-plan user", "a user on this plan")
    .replaceAll("free-plan user", "user on this plan")
    .replaceAll("on the free plan", "on this plan")
    .replaceAll("the free plan", "this plan");
}

export type SettingBlock =
  | { kind: "field"; key: SettingKey }
  | { kind: "plans"; metrics: PlanMetric[] }
  | { kind: "rate"; limit: SettingKey; window: SettingKey };

/**
 * Turns one tab's keys into what the page renders, in registry order.
 *
 * - Per-plan billing limits, BILLING_<PLAN>_<METRIC> for all four plans,
 *   become one matrix: fifteen rows with a column per plan instead of sixty
 *   rows reading "Free plan daily scans", "Core supporter daily scans"...
 * - A rate limit's count and its window (RATE_LIMIT_X_ATTEMPTS or _REQUESTS
 *   beside RATE_LIMIT_X_WINDOW_MINUTES) become one row, "10 per 15 minutes",
 *   since neither number means anything without the other.
 * - Everything else is a single field.
 *
 * A metric missing any plan, or a count with no window, falls back to single
 * fields, so a partial registry change degrades to the plain list rather than
 * losing a setting.
 */
export function buildSettingBlocks(keys: SettingKey[]): SettingBlock[] {
  const keySet = new Set(keys);
  const consumed = new Set<SettingKey>();
  const blocks: SettingBlock[] = [];
  let planBlock: { kind: "plans"; metrics: PlanMetric[] } | null = null;

  for (const key of keys) {
    if (consumed.has(key)) continue;

    const planMatch = PLAN_KEY_PATTERN.exec(key);
    if (planMatch) {
      const metric = planMatch[2];
      const planKeys = Object.fromEntries(
        PLAN_KEY_TOKENS.map((plan) => [plan, `BILLING_${plan}_${metric}`]),
      ) as Record<PlanKeyToken, SettingKey>;
      if (Object.values(planKeys).every((k) => keySet.has(k))) {
        const free = SETTINGS_REGISTRY[planKeys.FREE] as SettingDefinition;
        const bare = free.label.replace(/^Free plan /, "");
        const metricEntry: PlanMetric = {
          metric,
          label: bare.charAt(0).toUpperCase() + bare.slice(1),
          help: generalizePlanHelp(free.help),
          keys: planKeys,
        };
        for (const k of Object.values(planKeys)) consumed.add(k);
        if (!planBlock) {
          planBlock = { kind: "plans", metrics: [] };
          blocks.push(planBlock);
        }
        planBlock.metrics.push(metricEntry);
        continue;
      }
    }

    const rateMatch = /^(RATE_LIMIT_.+)_(ATTEMPTS|REQUESTS)$/.exec(key);
    if (rateMatch) {
      const window = `${rateMatch[1]}_WINDOW_MINUTES` as SettingKey;
      if (keySet.has(window) && !consumed.has(window)) {
        consumed.add(key);
        consumed.add(window);
        blocks.push({ kind: "rate", limit: key, window });
        continue;
      }
    }

    consumed.add(key);
    blocks.push({ kind: "field", key });
  }

  return blocks;
}

/** Every setting key a block renders, for counting and filtering. */
export function blockKeys(block: SettingBlock): SettingKey[] {
  if (block.kind === "field") return [block.key];
  if (block.kind === "rate") return [block.limit, block.window];
  return block.metrics.flatMap((m) => Object.values(m.keys));
}
