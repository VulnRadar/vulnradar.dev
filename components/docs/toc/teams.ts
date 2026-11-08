import type { TocItem } from "../docs-types";

/** The sections of /docs/teams, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "creating", label: "Creating a Team" },
  { id: "plan-limits", label: "Plan Limits" },
  { id: "roles", label: "Roles and Permissions" },
  { id: "role-ceiling", label: "Role ceiling", level: 2 },
  { id: "invitations", label: "Invitations" },
  { id: "accepting", label: "Accepting an Invite", level: 2 },
  { id: "sharing", label: "Sharing Scans" },
  { id: "team-resources", label: "Webhooks and Domains" },
  { id: "endpoints", label: "API Endpoints" },
];
