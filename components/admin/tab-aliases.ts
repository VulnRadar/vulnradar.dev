import type { AdminTabKey } from "@/components/admin/nav";

/**
 * Tab ids that links in the wild still use, mapped to the id the panel routes
 * on today.
 *
 * `support` is the one that exists: the contact-form alert email linked to
 * /admin?tab=support&view=contact for as long as that email has existed, and
 * the admin page only knows `support-tickets`, so every copy already sitting in
 * a staff inbox opened Overview. The email now names the real id; this keeps
 * the old ones working. Type-only import of nav.ts, so the icon table does not
 * come along.
 */
export const ADMIN_TAB_ALIASES: Readonly<Record<string, AdminTabKey>> = {
  support: "support-tickets",
};

/** The id to route on for whatever `?tab=` held; anything unknown is returned as it came. */
export function resolveAdminTab(tab: string | undefined): string | undefined {
  if (tab === undefined) return undefined;
  return Object.hasOwn(ADMIN_TAB_ALIASES, tab) ? ADMIN_TAB_ALIASES[tab] : tab;
}
