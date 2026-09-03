import Link from "next/link";

import { APP_NAME } from "@/lib/config/constants";
import { STAFF_ROLES } from "@/lib/config/client-constants";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  DocsTable,
  InlineCode,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "who", label: "Who gets in" },
  { id: "roles", label: "Staff roles" },
  { id: "tabs", label: "What each tab does" },
  { id: "settings", label: "The settings registry" },
  { id: "audit", label: "Audit log" },
  { id: "impersonation", label: "Impersonation" },
  { id: "access-rules", label: "Access rules and blocked data" },
  { id: "backups", label: "Backups and restore" },
  { id: "broadcasts", label: "Broadcast email" },
  { id: "cleanup", label: "Cleanup and retention" },
];

export default function AdministrationPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="Running your own"
        title="Administration"
        description={`The operator's side of ${APP_NAME}: who can reach the admin panel, what each tab is for, how a runtime setting resolves, and how the operations you would otherwise reach for a shell to do (backups, blocklists, retention, mass email) work from inside the app.`}
        stats={[
          {
            // Every role except `user`, counted from the role table itself so
            // adding a role does not leave this number behind.
            value: String(
              Object.values(STAFF_ROLES).filter((role) => role !== "user")
                .length,
            ),
            label: "Staff roles",
          },
          { value: "21", label: "Admin destinations" },
          { value: "Every change", label: "Written to the audit log" },
        ]}
      />

      <DocsSection id="who" title="Who gets in">
        <p className="text-sm leading-relaxed text-muted-foreground">
          The very first account created on a fresh instance becomes the super
          admin. That role cannot be granted through the panel afterwards, which
          is what stops an escalation path existing at all: there is exactly one
          way to become super admin, and it is being first.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Everyone else is invited. An admin sends a staff invite for a specific
          email and a specific role; the link expires in seven days, the token
          is stored hashed rather than in plain text, and a pending invite can
          be revoked by deleting it. Sending an invite requires re-entering your
          password, as do the other seventeen destructive admin actions.
        </p>
        <DocsCallout variant="warning" title="Turn on 2FA enforcement">
          <p>
            <InlineCode>ENFORCE_STAFF_2FA</InlineCode> is off by default so that
            enabling the feature does not instantly lock out existing staff.
            Turn it on once your staff have set up 2FA. It gates every
            admin-panel route, not just the login. Someone locked out can still
            reach the 2FA setup endpoint to enrol and get back in, so it is a
            recoverable setting rather than a one-way door.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="roles" title="Staff roles">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Roles are not a single ladder. Four of them sit at the same rank as
          each other and differ only in what they are for, so you can give
          someone billing access without giving them session and 2FA controls.
        </p>
        <DocsTable
          caption="Every staff role and what it is for"
          columns={[
            { key: "role", header: "Role", className: "font-mono" },
            { key: "scope", header: "Scope", className: "w-full" },
          ]}
          data={[
            {
              role: "support",
              scope:
                "Read-only. The user directory, scans, reports and subscriptions, plus the support ticket inbox. No audit log and no mutations.",
            },
            {
              role: "billing",
              scope:
                "Plans, subscriptions and the billing overview. Cannot see sessions, the audit log or error logs.",
            },
            {
              role: "security_analyst",
              scope:
                "Sessions, 2FA resets, moderation, reports and the audit log. No billing, settings or backups.",
            },
            {
              role: "content_manager",
              scope:
                "Moderation, reports, announcements and notifications. No sessions and no audit log.",
            },
            {
              role: "ops",
              scope:
                "System stats, error logs, scans, engine feedback and cache control. Deliberately has no access to the user directory.",
            },
            {
              role: "moderator",
              scope:
                "Everything the specialists cover for user management: edit, disable, sessions, 2FA reset, delete any scan, audit log. Not impersonation, not settings, not backups, not deleting users.",
            },
            {
              role: "admin",
              scope:
                "Everything except the super-admin-only reserve. Settings, backups, broadcasts, invites, impersonation.",
            },
            {
              role: "super_admin",
              scope:
                "Everything, plus the sole ability to apply an in-place update. Cannot be modified by anyone else.",
            },
          ]}
        />
        <DocsCallout
          variant="info"
          title="An admin cannot act on another admin"
        >
          <p>
            Every action on a user account requires the target to be strictly
            lower-ranked than you, with the super admin the only exception and
            your own account exempt for benign actions. That is what stops one
            admin disabling, demoting or deleting a peer. It also means two
            same-rank specialists cannot act on each other, which is
            intentional.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="tabs" title="What each tab does">
        <p className="text-sm leading-relaxed text-muted-foreground">
          The panel has 21 destinations in seven groups, and each one is
          filtered by your role, so what you see depends on what you hold. The
          Overview tab is the one to check first: it is a worst-first health
          list covering the scanner queue, failed scans in the last day, when
          the last backup ran, errors logged in the last hour, failed emails,
          unresolved security alerts, tickets waiting on staff, and pending
          staff invites.
        </p>
        <DocsTable
          caption="The admin panel's groups and what lives in each"
          columns={[
            { key: "group", header: "Group" },
            { key: "tabs", header: "Tabs", className: "w-full" },
          ]}
          data={[
            { group: "Operations", tabs: "Overview" },
            { group: "User Management", tabs: "Users, Teams, Active Staff" },
            {
              group: "Security",
              tabs: "Access Rules, Blocked Data, Alerts, Audit Log",
            },
            {
              group: "Communications",
              tabs: "Broadcast, Notifications, AI Chats, Support",
            },
            { group: "Content", tabs: "Hosts & Shares" },
            { group: "Billing", tabs: "Billing Overview" },
            {
              group: "System",
              tabs: "Settings, Updater, Backups, Scanner Queue, Error Logs, Email Logs, Engine Feedback",
            },
          ]}
        />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Two are worth knowing about before you need them.{" "}
          <strong className="text-foreground">Error Logs</strong> captures every{" "}
          <InlineCode>console.error</InlineCode> the application emits, with
          credentials, API keys, tokens and email addresses scrubbed before
          storage, so you can diagnose a production failure without shell
          access. <strong className="text-foreground">Email Logs</strong>{" "}
          records every outbound send attempt with a redacted preview that never
          contains a working link or code; its status is the mail server&rsquo;s
          accept or reject, which is not the same as delivered.
        </p>
      </DocsSection>

      <DocsSection id="settings" title="The settings registry">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Almost everything configurable is a typed entry in one registry rather
          than an environment variable you have to redeploy to change. Each
          entry declares its type, its bounds, the group it belongs to, and help
          text, and its default is the same constant the code ships with, so the
          form cannot drift from what the application actually does.
        </p>

        <DocsSubSection title="How a value resolves">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Database value, then environment variable, then the shipped default.
            The database wins because that is the layer the admin panel edits.
            Values are cached for 30 seconds, and saving invalidates the cache
            for the process handling the save, so you see your own change
            immediately while other processes converge within the window.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            If the database is unreachable, resolution{" "}
            <strong className="text-foreground">fails open</strong>: every key
            falls back to its environment or shipped value rather than
            everything reading as off. A database outage should not also flip
            every feature flag.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Runtime settings and build settings">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Most settings take effect within the cache window. A minority are
            marked as build-tier, meaning the running application reads the
            value compiled into the build: saving one records your intent but
            does not change behaviour until the next build. The panel labels
            these, and it is the single most common source of &ldquo;I changed
            it and nothing happened&rdquo;.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Resetting a setting deletes its row rather than writing the current
            default back into it. That matters on upgrade: a reset key keeps
            following the shipped default, while a key you explicitly set stays
            pinned to your value across releases.
          </p>
        </DocsSubSection>

        <DocsCallout
          variant="info"
          title="Some values are deliberately not editable"
        >
          <p>
            A separate list names the constants that are intentionally never
            exposed, each with a reason: cookie names, connection-pool sizing,
            interval timers that are read once when the timer is registered, and
            security constants where a wrong value is a vulnerability rather
            than a preference. Several keys were also removed from the registry
            because nothing read them, on the principle that an editable field
            that does nothing is worse than no field at all.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="audit" title="Audit log">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Every staff action writes a row: who did it, to whom, what, from which
          address, and when. That includes settings changes and resets, user
          actions, broadcasts, blocked-data operations, backups, staff invites
          and revocations, impersonation start and stop, and exporting the audit
          log itself.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Email addresses in the free-text detail are masked before the row is
          written, so a log kept for a year does not become a store of addresses
          belonging to deleted accounts. Reading the log needs the audit
          permission, which the security analyst role has; exporting the whole
          table as CSV or JSON requires full admin, and the export is itself
          logged.
        </p>
        <DocsCallout
          variant="success"
          title="Rows are archived, not just deleted"
        >
          <p>
            Audit rows are purged after their retention window, but the cleanup
            copies the about-to-be-deleted rows into an archive table in the
            same transaction as the delete. A purge cannot run without the rows
            landing in the archive first, so the retention setting bounds what
            is queryable rather than destroying the record.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="impersonation" title="Impersonation">
        <p className="text-sm leading-relaxed text-muted-foreground">
          An admin or super admin can sign in as a user to reproduce a problem.
          It is deliberately narrow: only plain user accounts can be targeted,
          never staff; it requires re-entering your password; the impersonated
          session is capped at one hour regardless of your normal session
          length; and a banner is visible across the whole application for the
          entire time.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your own session is held in a separate cookie and restored when you
          stop. Both the start and the stop are written to the audit log, and
          the stop is attributed to you rather than to the account you were
          inside. If your original session expired while you were impersonating,
          stopping ends the impersonated session anyway and asks you to log in
          again, so you cannot get stranded inside someone else&rsquo;s account.
        </p>
      </DocsSection>

      <DocsSection id="access-rules" title="Access rules and blocked data">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Access rules control{" "}
          <strong className="text-foreground">what can be scanned</strong>, not
          who can use the site. A rule is a blacklist or whitelist entry for
          either an IP (CIDR ranges work) or a URL, optionally with an expiry.
          URL rules match the host and all of its subdomains.
        </p>
        <ul className="list-disc space-y-2 pl-6 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">
              Blacklist beats whitelist.
            </strong>{" "}
            A target matching both is refused.
          </li>
          <li>
            <strong className="text-foreground">
              One whitelist rule turns on allowlist mode.
            </strong>{" "}
            As soon as any active whitelist rule exists, a target must match one
            of them or it is refused. That is the switch for a locked-down
            internal deployment, and it is easy to trigger by accident with a
            single test rule.
          </li>
          <li>
            <strong className="text-foreground">It fails closed.</strong> If the
            rules cannot be read, scans are refused rather than allowed. A
            database problem must not silently disable the blocklist.
          </li>
          <li>
            Decisions are cached for 30 seconds per host, but hit counts still
            increment on a cached decision, so the panel&rsquo;s counters stay
            honest.
          </li>
        </ul>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Blocked Data</strong> is the
          cleanup half, and it is admin-only because it deletes across every
          user&rsquo;s account. It finds scans for a domain and its subdomains,
          deletes them in bulk, and purges the cached public host-reputation row
          for a host. That last one is the takedown escape hatch: normal
          retention and user-initiated deletion never touch that table.
        </p>
      </DocsSection>

      <DocsSection id="backups" title="Backups and restore">
        <p className="text-sm leading-relaxed text-muted-foreground">
          The Backups tab runs the same script you would run by hand, so a
          scheduled run and a button press show up in one history. Only one
          backup runs at a time; a second request while one is in progress is
          refused rather than queued.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A backup is a full logical dump of the database, gzipped and then{" "}
          <strong className="text-foreground">encrypted by default</strong> with
          AES-256-GCM. Old files are pruned past the retention window, and an
          optional pre-signed upload URL sends each one offsite without the
          application ever holding long-lived cloud credentials.
        </p>
        <DocsTable
          caption="Backup environment variables"
          columns={[
            { key: "name", header: "Variable", className: "font-mono" },
            { key: "meaning", header: "What it does", className: "w-full" },
          ]}
          data={[
            {
              name: "BACKUP_DIR",
              meaning: "Where backups are written. Defaults to ./backups.",
            },
            {
              name: "BACKUP_RETENTION_DAYS",
              meaning:
                "How long to keep files. Default 14. Set 0 to keep everything.",
            },
            {
              name: "BACKUP_ENCRYPTION_KEY",
              meaning:
                "64 hex characters. Falls back to the API key encryption key so backups are never silently plaintext. Deliberately env-only: storing the key that decrypts the database's backups inside that database solves nothing.",
            },
            {
              name: "BACKUP_OFFSITE_UPLOAD_URL",
              meaning:
                "A pre-signed PUT endpoint. Works with any S3-compatible or plain HTTP receiver.",
            },
          ]}
        />
        <DocsCallout variant="warning" title="Keep the sidecar file">
          <p>
            An encrypted backup is written alongside a small{" "}
            <InlineCode>.json</InlineCode> file holding the values needed to
            decrypt it. Without that sidecar the backup cannot be restored, so
            copy it wherever you copy the backup, and check the upload of both
            if you are sending them offsite.
          </p>
        </DocsCallout>
        <DocsSubSection title="Restoring">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Restore is a command-line operation and it is destructive, so it
            refuses to do anything without an explicit confirmation flag and
            refuses to restore into a database that already has tables unless
            you force it. An encrypted file is fully decrypted and its
            authentication tag verified before a single byte reaches the
            database. Afterwards it prints row counts for the main tables so you
            have evidence the restore actually landed rather than a silent
            zero-row success.
          </p>
        </DocsSubSection>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Scheduled backups are off by default and run daily when enabled. Note
          that a database dump does not include anything stored outside the
          database, so back up your uploads directory and environment file
          separately.
        </p>
      </DocsSection>

      <DocsSection id="broadcasts" title="Broadcast email">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Broadcasts go to verified accounts only, never to unverified ones. You
          can target everyone, a specific plan, all paid users, or a single
          address, and optionally narrow further to people who have a given
          notification preference switched on.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Delivery walks the user list in pages with a small number of sends in
          flight at a time, and each recipient is claimed atomically before
          their email is sent. A double-click on Send, or a resend racing an
          in-flight send, cannot deliver twice. Failed recipients are recorded
          as failed so a later resend picks up exactly those.
        </p>
        <DocsCallout
          variant="warning"
          title="Sending happens in-process, not in a durable queue"
        >
          <p>
            If the process restarts mid-send the broadcast stays a draft and
            needs re-triggering. Already-delivered recipients are not re-mailed
            when you do, but the send does not resume on its own. Avoid starting
            a large broadcast immediately before a deploy.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="cleanup" title="Cleanup and retention">
        <p className="text-sm leading-relaxed text-muted-foreground">
          A cleanup job runs automatically every few minutes, pruning expired
          sessions, spent tokens, expired invites and each table past its
          retention window. Retention is a setting per table: API usage, revoked
          API keys, data requests, audit log, security alerts, error logs, email
          logs, finding feedback, notifications and cache tables each have their
          own.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The Settings tab also has a manual trigger behind a confirmation
          dialog. It is admin-only and it is not undoable: it permanently
          deletes scan history, audit rows, sessions and tokens that are past
          their windows. Use it when you have just lowered a retention value and
          want the effect now rather than at the next tick.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          For the deployment side of running an instance, see{" "}
          <Link
            href="/docs/self-hosting"
            className="text-primary underline-offset-2 hover:underline"
          >
            Self-Hosting
          </Link>
          , and for the values themselves,{" "}
          <Link
            href="/docs/config"
            className="text-primary underline-offset-2 hover:underline"
          >
            Configuration
          </Link>
          .
        </p>
      </DocsSection>
    </div>
  );
}
