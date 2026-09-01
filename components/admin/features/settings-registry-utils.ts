// SETTINGS REGISTRY UI UTILITIES
//
// Pure, DOM-free derivation from SETTINGS_REGISTRY (lib/config/registry.ts)
// for the admin settings page. Nothing here talks to the network or the
// DOM, so it is unit-tested directly (this project's Vitest runs in a plain
// node environment, with no jsdom/React-Testing-Library set up for the
// .tsx components themselves).
//
// system-settings-manager.tsx and settings-field.tsx are the only
// consumers. Every tab, and every field on every tab, comes from the
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

/**
 * True when any field on this tab is build-tier, meaning the running app
 * reads the compiled constant rather than the saved row. Not "applies on the
 * next deploy": no build step reads system_settings at all.
 */
export function tabHasBuildTierFields(group: string): boolean {
  return (FIELDS_BY_GROUP[group] ?? []).some(([, def]) => def.tier === "build");
}

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
export function isDestructiveToggle(
  key: string,
  newValue: FieldValue,
): boolean {
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
  "FOOTER_TEXT",
]);

export function isMultilineSetting(key: string): boolean {
  return MULTILINE_SETTING_KEYS.has(key);
}

// ---------------------------------------------------------------------
// Related-settings clustering
// ---------------------------------------------------------------------

export interface SettingCluster {
  /** null renders the keys inline with no subheading, e.g. a lone field
   *  that shares no naming prefix with any sibling on its tab. */
  label: string | null;
  keys: SettingKey[];
}

const ACRONYMS = new Set([
  "IP",
  "API",
  "URL",
  "URLS",
  "SEO",
  "AI",
  "PDF",
  "TTL",
  "ID",
  "HTML",
  "JSON",
  "CSS",
  "OG",
  "TOTP",
  "JWT",
  "CORS",
  "CSRF",
  "2FA",
  "TLS",
  "SSL",
  "DNS",
  "CDN",
  "MS",
]);

function humanizeToken(token: string): string {
  if (ACRONYMS.has(token.toUpperCase())) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function tokensOf(key: string): string[] {
  return key.split("_");
}

/**
 * Length of the shared leading-token run across every token list given.
 * Only ever called with 2+ non-empty lists (a just-formed multi-member
 * cluster), so there is no empty-input case to guard against.
 */
function commonPrefixLength(tokenLists: string[][]): number {
  let i = 0;
  outer: while (true) {
    const candidate = tokenLists[0][i];
    if (candidate === undefined) break;
    for (const tokens of tokenLists) {
      if (tokens[i] !== candidate) break outer;
    }
    i++;
  }
  return i;
}

function bucketByDepth(
  keys: SettingKey[],
  depth: number,
): Map<string, SettingKey[]> {
  const map = new Map<string, SettingKey[]>();
  for (const key of keys) {
    const tokens = tokensOf(key);
    const bucketKey = tokens.slice(0, Math.min(depth, tokens.length)).join("_");
    const bucket = map.get(bucketKey);
    if (bucket) bucket.push(key);
    else map.set(bucketKey, [key]);
  }
  return map;
}

/** A bucket this large relative to its tab is really just restating the
 *  tab's own domain word (e.g. "RATE_LIMIT" covers nearly every Rate
 *  Limits field) rather than telling two fields apart. Worth trying one
 *  more name segment before accepting it as a single cluster. */
const DOMINANCE_RATIO = 0.7;

/**
 * Splits one settings tab's fields into small related clusters purely from
 * their key names, e.g. every RATE_LIMIT_LOGIN_* key becomes a "Rate Limit
 * Login" group, every SEO_OG_IMAGE* key becomes an "SEO OG Image" group. A
 * field with no sibling sharing its first two name segments keeps
 * `label: null` and renders flat, exactly like before this existed.
 *
 * This is a naming-convention heuristic, not registry metadata (the
 * registry has no concept of sub-groups), so it is deliberately
 * conservative: it only clusters, never reorders across a dominance split
 * in a way that loses fields, and a tab where nothing shares a prefix
 * behaves exactly as it did before (everything flat, in registry order).
 */
export function clusterSettingKeys(keys: SettingKey[]): SettingCluster[] {
  const initial = bucketByDepth(keys, 2);
  const clusters: SettingCluster[] = [];

  for (const members of initial.values()) {
    if (members.length === 1) {
      clusters.push({ label: null, keys: members });
      continue;
    }

    let groups = [members];
    if (members.length / keys.length >= DOMINANCE_RATIO) {
      const deeper = Array.from(bucketByDepth(members, 3).values());
      // Only accept the deeper split if it actually found sub-structure
      // (at least one multi-member group). Otherwise every member is
      // unique past this point and splitting would just shatter a
      // perfectly good cluster into meaningless singletons.
      if (deeper.some((group) => group.length >= 2)) {
        groups = deeper;
      }
    }

    for (const group of groups) {
      if (group.length === 1) {
        clusters.push({ label: null, keys: group });
        continue;
      }
      const lcp = commonPrefixLength(group.map(tokensOf));
      const label = tokensOf(group[0])
        .slice(0, lcp)
        .map(humanizeToken)
        .join(" ");
      clusters.push({ label, keys: group });
    }
  }

  return clusters;
}
