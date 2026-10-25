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
  ALWAYS_ON_COLUMNS,
  type NotificationPrefs,
  type PrefKey,
} from "@/lib/notifications/columns";

// Declared once in lib/notifications/columns.ts, which has no server imports,
// so this page and the routes it talks to cannot disagree about what exists.
// Re-exported under the names the page already uses.
export type { PrefKey } from "@/lib/notifications/columns";
export type EmailPrefs = NotificationPrefs;

export type PrefRow = {
  key: PrefKey;
  label: string;
  description: string;
};

export type PrefGroup = {
  label: string;
  rows: PrefRow[];
};

/**
 * Preference columns the server refuses to switch off.
 *
 * Both writers force email_security true whatever they are sent, and both
 * still answer 200 because the other columns write fine. So the switch moved,
 * the page said it had saved, and the mail kept arriving until a reload put
 * the switch back: a control that reported success and did nothing. On the
 * unsubscribe page that is the worse of the two places for it, because that
 * page is the one a recipient reaches from the footer of an email.
 *
 * The same set the routes read (lib/notifications/columns.ts), so the screen
 * and the server cannot disagree about it.
 */
export const ALWAYS_ON_PREFS = ALWAYS_ON_COLUMNS;

export const PREF_GROUPS: PrefGroup[] = [
  {
    label: "Security",
    rows: [
      {
        key: "email_security",
        label: "Security Alerts",
        description:
          "Critical account security events and compromise warnings. This one cannot be switched off.",
      },
      {
        key: "email_new_login",
        label: "Login Alerts",
        description: "When someone signs in from a new device or location.",
      },
      {
        key: "email_password_change",
        label: "Password Changes",
        description: "When your password is changed or a reset is requested.",
      },
      {
        key: "email_2fa_change",
        label: "2FA Changes",
        description: "When two-factor authentication is enabled or disabled.",
      },
      {
        key: "email_session_revoked",
        label: "Session Alerts",
        description: "When active sessions are revoked.",
      },
    ],
  },
  {
    label: "Scanning",
    rows: [
      {
        key: "email_scan_complete",
        label: "Scan Completed",
        description: "When a vulnerability scan finishes.",
      },
      {
        key: "email_critical_findings",
        label: "Critical Issues Found",
        description:
          "Immediate alert when critical vulnerabilities are detected.",
      },
      {
        key: "email_regression_alert",
        label: "Regression Alerts",
        description: "When new issues appear in a previously clean scan.",
      },
      {
        key: "email_schedules",
        label: "Scheduled Scans",
        description: "When your scheduled scans finish.",
      },
      {
        key: "email_posture_digest",
        label: "Posture Digest",
        description:
          "A weekly roll-up of what changed across every site you scan.",
      },
    ],
  },
  {
    label: "API & Integrations",
    rows: [
      {
        key: "email_api_keys",
        label: "API Key Activity",
        description: "When API keys are created or revoked.",
      },
      {
        key: "email_api_limit_warning",
        label: "API Limit Warnings",
        description: "When your API usage nears rate limits or quotas.",
      },
      {
        key: "email_webhooks",
        label: "Webhook Events",
        description: "When webhooks are created, modified, or disabled.",
      },
      {
        key: "email_webhook_failure",
        label: "Webhook Failures",
        description: "When webhook deliveries fail repeatedly.",
      },
    ],
  },
  {
    label: "Account",
    rows: [
      {
        key: "email_data_requests",
        label: "Data Export Updates",
        description: "When your data export is ready for download.",
      },
      {
        key: "email_account_deletion",
        label: "Account Deletion",
        description: "Confirmations when account deletion is requested.",
      },
      {
        key: "email_team_invite",
        label: "Team Invites",
        description: "When you are invited to join a team.",
      },
      {
        key: "email_team_changes",
        label: "Team Changes",
        description: "Membership changes and role updates in your teams.",
      },
    ],
  },
  {
    label: "Product",
    rows: [
      {
        key: "email_product_updates",
        label: "Product Updates",
        description: "New features, improvements, and release notes.",
      },
      {
        key: "email_tips_guides",
        label: "Tips & Guides",
        description: "Tips on getting the most out of VulnRadar.",
      },
    ],
  },
];
