import type { AdminTabKey } from "@/components/admin/nav";

/**
 * What each admin tab is for, as the /docs/administration table prints it.
 *
 * Docs-only on purpose. components/admin/nav.ts is the panel's destination
 * table and the sidebar renders from it, so a sentence of documentation added
 * to a nav item would ship in the admin bundle to say something only the docs
 * page reads. The Record is keyed by AdminTabKey and so exhaustive: adding a
 * tab to VALID_TABS is a type error here until it gets a sentence, which is
 * how six of them (the updater, engine feedback, hosts and shares, the scanner
 * queue, notifications and security alerts) went undocumented while the table
 * above only listed their names.
 *
 * Each sentence is read off the panel itself and what it calls, not off the
 * tab's label. The first six are the ones that needed the most explaining.
 */
export const ADMIN_TAB_DESCRIPTIONS: Record<AdminTabKey, string> = {
  updater:
    "Checks GitHub for a newer release and, for the super admin, installs it over a source checkout: checksum and signature verified, dependencies installed, database migrated. You build and restart yourself. On the official Docker image and on Vercel it shows why it is unavailable instead of a button.",
  "engine-feedback":
    "False-positive rate per check, from the feedback users submit on findings, with the worst checks flagged. Also how often each auto-tag rule is dismissed as wrong, the tags the AI suggested that no rule matched, and the rules you promoted from them.",
  content:
    "The public side of what users scan. Hosts lists every host cached at /host/[hostname], and you can purge one to pull it from the directory. Shares lists every scan that has had a share link: unlist it from the directory, or revoke the link for everyone holding it.",
  "queue-status":
    "Pending and running scans right now, with completed and failed counts over a recent window, and a flag when the queue is backed up.",
  notifications:
    "Site notifications: the banners, modals, toasts and bell notifications users see, with start and end dates. Create and manage them here, and watch for ones about to lapse.",
  "security-alerts":
    "Alerts raised by suspicious activity: a session or API key used from a new network, repeated failed sign-ins, a sign-in from a new device. Filter by severity and mark each one resolved.",
  overview:
    "A worst-first health list: scanner queue, failed scans, background workers, backups, logged errors, failed emails, security alerts, tickets and pending staff invites. Each row links to the tab that owns it.",
  "error-logs":
    "Every console.error the app emits, with credentials, API keys, tokens and email addresses scrubbed before storage.",
  "email-logs":
    "Every outbound email attempt, most recent first, with a redacted preview. The status is the mail server's accept or reject, which is not the same as delivered.",
  backup:
    "Runs a database backup on demand and lists the recent local backups. Uses pg_dump when it is installed and a built-in dumper when it is not.",
  users:
    "The user directory. Search matches name, email and user id, and filters and sorting apply across every account. Open an account for its details and the actions your role allows.",
  teams:
    "Every team on the platform, to view and manage. Needs the permission to view all teams, which only admin and super admin hold.",
  admins:
    "The staff directory, with each member's current activity, and staff invites: send one for an email and a role, see the pending ones, revoke one.",
  audit:
    "Every staff action across the platform, filterable. Exporting the whole table as CSV or JSON needs full admin and is itself logged.",
  "support-tickets":
    "The support inbox: user tickets with their reply thread, and a second view for messages sent through the contact form.",
  "ai-chats":
    "Conversations users have had with the AI assistant, for support and moderation. Search and sort apply to the page currently loaded, not the whole table.",
  "access-rules":
    "Whitelist and blacklist rules for IPs (CIDR ranges work) and URLs, with an optional expiry. They decide what can be scanned. One active whitelist rule switches on allowlist mode.",
  "blocked-data":
    "Look up any host or URL and delete the scans stored for it and its subdomains, for data that ended up public and should not have. Also purges the cached public host-reputation row. Admin only.",
  broadcast:
    "Compose and send email to verified accounts: everyone, a plan, all paid users or one address. Saving stores a draft, sending is immediate, and a resend retries the recipients that failed and reaches anyone who joined the audience since.",
  "billing-overview":
    "Plan mix, accounts past due with their failed payments, and AI spend. Everything comes from data already synced into the app, so there are no live Stripe calls behind the page.",
  settings:
    "Every runtime setting from the registry, grouped by tab, with Customized and Default badges, reset and export. The incident switches live under Operations, and the manual database cleanup is in the same tab.",
};
