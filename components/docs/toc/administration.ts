import type { TocItem } from "../docs-types";

/** The sections of /docs/administration, in page order. */
export const toc: TocItem[] = [
  { id: "who", label: "Who gets in" },
  { id: "roles", label: "Staff roles" },
  { id: "tabs", label: "What each tab does" },
  { id: "settings", label: "The settings registry" },
  { id: "incident-switches", label: "Incident switches" },
  { id: "audit", label: "Audit log" },
  { id: "impersonation", label: "Impersonation" },
  { id: "staff-sso", label: "Staff SSO" },
  { id: "access-rules", label: "Access rules and blocked data" },
  { id: "backups", label: "Backups and restore" },
  { id: "broadcasts", label: "Broadcast email" },
  { id: "cleanup", label: "Cleanup and retention" },
];
