/**
 * The email preference table, shared by /unsubscribe and its placeholder.
 *
 * It lived inside app/unsubscribe/page.tsx, private to that client module, so
 * UnsubscribeSkeleton could not read it and carried a hand-typed
 * `GROUP_ROW_COUNTS = [5, 4, 4, 4, 2]` instead. Two descriptions of the same
 * list, and only one of them is the one anybody edits when a preference is
 * added: the placeholder would simply have been a row short, and short by
 * exactly the height of a row that then appeared under the reader.
 *
 * Nothing here renders, so it is a plain module both a Server and a Client
 * Component can import.
 */

import {
  PREFERENCE_COPY,
  type NotificationPrefs,
  type PrefKey,
} from "@/lib/notifications/columns";

// Declared once in lib/notifications/columns.ts, which has no server imports,
// so this page and the routes it talks to cannot disagree about what exists.
// Re-exported under the names the page already uses.
export type { PrefKey } from "@/lib/notifications/columns";

/** Only the columns the token can reach, which is not all of them. */
export type EmailPrefs = Partial<NotificationPrefs>;

export type PrefRow = {
  key: PrefKey;
  label: string;
  description: string;
};

export type PrefGroup = {
  label: string;
  rows: PrefRow[];
};

function rows(...keys: PrefKey[]): PrefRow[] {
  return keys.map((key) => ({ key, ...PREFERENCE_COPY[key] }));
}

/**
 * Every preference a recipient can change from a link in an email, which is
 * UNSUBSCRIBABLE_COLUMNS and no more. The security warnings are not listed
 * because the token cannot change them, and a switch the server ignores is a
 * control that reports "Saved." and does nothing. That includes account
 * deletion, which is a security column even though it reads like an account
 * setting. tests/components/auth/unsubscribe-prefs.test.ts holds the two lists
 * together.
 */
export const PREF_GROUPS: PrefGroup[] = [
  {
    label: "Scanning",
    rows: rows(
      "email_scan_complete",
      "email_critical_findings",
      "email_regression_alert",
      "email_schedules",
      "email_posture_digest",
    ),
  },
  {
    label: "API & Integrations",
    rows: rows(
      "email_api_keys",
      "email_api_limit_warning",
      "email_webhooks",
      "email_webhook_failure",
    ),
  },
  {
    label: "Account",
    rows: rows(
      "email_data_requests",
      "email_team_invite",
      "email_team_changes",
    ),
  },
  {
    label: "Product",
    rows: rows("email_product_updates", "email_tips_guides"),
  },
];
