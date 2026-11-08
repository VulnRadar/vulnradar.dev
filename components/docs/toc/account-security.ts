import type { TocItem } from "../docs-types";

/** The sections of /docs/account-security, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "two-factor", label: "Two-step verification" },
  { id: "authenticator-app", label: "Authenticator app", level: 2 },
  { id: "email-codes", label: "Email codes", level: 2 },
  { id: "backup-codes", label: "Backup codes", level: 2 },
  { id: "sessions", label: "Sessions and trusted devices" },
  { id: "active-sessions", label: "Active sessions", level: 2 },
  { id: "trusted-devices", label: "Trusted devices", level: 2 },
  { id: "sign-out-everywhere", label: "Sign out everywhere", level: 2 },
  { id: "oauth", label: "Sign in with Google, GitHub, Discord" },
  { id: "notifications", label: "Notifications and posture digest" },
  { id: "data", label: "Your data and privacy" },
  { id: "export", label: "Export your data", level: 2 },
  { id: "scan-privacy", label: "Scan and share privacy", level: 2 },
  { id: "deletion", label: "Delete your account", level: 2 },
];
