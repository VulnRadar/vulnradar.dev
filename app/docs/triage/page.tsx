import Link from "next/link";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  DocsTable,
  EndpointCard,
  CodeBlock,
  InlineCode,
  type Endpoint,
} from "@/components/docs";
import {
  REMEDIATION_STATUSES,
  REMEDIATION_LABELS,
  type RemediationStatus,
} from "@/lib/scanner/remediation";
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  type TicketStatus,
} from "@/lib/support/ticket-constants";

/** Per-status prose for the remediation table, matching the list-badge and
 *  dimming behaviour in components/scanner/results-list.tsx. */
const STATUS_NOTES: Record<RemediationStatus, string> = {
  open: "No badge. Open is the implicit default, so no row is stored: setting a finding back to Open deletes any row it had.",
  in_progress:
    "Brand-coloured badge. Counts as active work, so the row keeps full opacity in the list.",
  fixed:
    "Success-coloured badge. The row dims slightly so still-open findings stand out.",
  accepted_risk:
    "Muted badge (shown as Accepted). Dims in the list like Fixed.",
  wont_fix: "Muted badge. Dims in the list like Fixed.",
};

/** Meaning per ticket status, from the state machine in
 *  app/api/v3/support-tickets/[id]/route.ts and lib/support/ticket-constants.ts. */
const TICKET_STATUS_NOTES: Record<TicketStatus, string> = {
  open: "Brand new, no staff reply yet.",
  awaiting_staff: "You (or a shared teammate) replied. The ball is with staff.",
  awaiting_user: "Staff replied. The ball is with you.",
  resolved:
    "Marked done by you or staff. Replying reopens it as awaiting staff.",
  closed:
    "No further replies accepted. A reply returns 409; open a new ticket to continue.",
};

const remediationEndpoint: Endpoint = {
  id: "remediation-post",
  method: "POST",
  path: "/scan/remediation",
  title: "Set a finding's remediation status",
  description:
    "Record what you have done about one finding: its status, plus an optional note, assignee, and due date. Upserts on (user_id, finding_id, finding_url), so calling it again for the same finding updates the row rather than duplicating it. This is the owner's private tracking, separate from the accuracy feedback that feeds the global confidence model.",
  requestBody: `{
  "findingId": "hsts-missing--9f2c1a",
  "findingUrl": "https://example.com",
  "status": "in_progress",
  "note": "patched in release 4.2, ticket VR-118",
  "assignee": "alex",
  "dueAt": "2026-09-01"
}`,
  responseExample: `{
  "ok": true,
  "remediation": {
    "status": "in_progress",
    "note": "patched in release 4.2, ticket VR-118",
    "assignee": "alex",
    "due_at": "2026-09-01",
    "updated_at": "2026-08-24T12:00:00.000Z"
  }
}`,
  notes: [
    "Session-gated on the signed-in user's cookie. There is no Bearer-key equivalent: this is a UI-facing owner action, not part of the public API surface.",
    "Owner-scoped by construction. Every row is keyed on (user_id, finding_id, finding_url) and every query filters on your own user id, so you can only ever read or write your own remediation state.",
    'status "open" is special: it deletes the row instead of storing one, because Open is the absence of a record. DELETE /scan/remediation?url=...&findingId=... does the same thing.',
    "note (max 2000), assignee (max 120), and dueAt are all optional. dueAt takes a date-input value like 2026-09-01 or a full ISO datetime; an unparseable value is stored as null rather than erroring.",
  ],
  errors: [
    { code: 400, description: "Invalid JSON, or a body that fails validation" },
    { code: 401, description: "No session cookie" },
    {
      code: 503,
      description:
        "finding_remediation table not migrated yet (run the migration)",
    },
  ],
};

const ticketEndpoint: Endpoint = {
  id: "ticket-post",
  method: "POST",
  path: "/support-tickets",
  title: "Open a support ticket",
  description:
    "Create a tracked ticket and its first message. Available on every plan, including free. The only gate is a signed-in session (plus Cloudflare Turnstile when it is configured). The response is the new ticket row; the UI then opens its thread.",
  requestBody: `{
  "subject": "Scan times out on staging",
  "category": "scanning",
  "message": "Every scan of https://staging.example.com stalls at 90%."
}`,
  responseExample: `{
  "ticket": {
    "id": 128,
    "subject": "Scan times out on staging",
    "category": "scanning",
    "status": "open",
    "created_at": "2026-08-24T12:00:00.000Z",
    "last_message_at": "2026-08-24T12:00:00.000Z"
  }
}`,
  notes: [
    "category is one of billing, scanning, account, other. subject is capped at 200 characters and the message at 5000.",
    "Turnstile is verified the same way the public contact form does it, and is a no-op when Turnstile is not configured for the deployment.",
    "You can hold at most 20 open tickets at once (open, awaiting staff, or awaiting your reply). Resolved and closed tickets do not count toward that.",
  ],
  errors: [
    {
      code: 400,
      description:
        "Missing subject or message, bad category, or a failed captcha",
    },
    { code: 401, description: "Not signed in" },
    { code: 429, description: "Too many open tickets" },
  ],
};

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "remediation", label: "Remediation tracking" },
  { id: "statuses", label: "Statuses", level: 2 },
  { id: "tracking-fields", label: "Assignee, note, due date", level: 2 },
  { id: "rescans", label: "Surviving rescans", level: 2 },
  { id: "bulk", label: "Bulk actions", level: 2 },
  { id: "remediation-api", label: "Remediation API", level: 2 },
  { id: "tickets", label: "Support tickets" },
  { id: "open-ticket", label: "Opening a ticket", level: 2 },
  { id: "categories-statuses", label: "Categories and statuses", level: 2 },
  { id: "sharing", label: "Sharing a ticket", level: 2 },
  { id: "notifications", label: "Replies and notifications", level: 2 },
  { id: "tickets-api", label: "Support ticket API", level: 2 },
];

export default function TriageDocsPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="Workflow"
        title="Triage & Remediation"
        description={`A scan tells you what is wrong. This is what happens next: you triage each finding, and when you need a human, you talk to us. Remediation tracking gives every finding a status, an assignee, and a due date that carry over to the next rescan of the same target. Support tickets open a threaded conversation with staff from the Contact page, on any plan including free.`}
        stats={[
          { value: "5", label: "Remediation statuses" },
          { value: "200", label: "Findings per bulk update" },
          { value: "Free", label: "Plan can open a ticket" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <div className="max-w-[68ch] space-y-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          <p>
            {APP_NAME} splits the after-scan workflow into two things a scan
            report cannot do for you. The first is deciding what to do about
            each finding and remembering that decision:{" "}
            <strong className="text-foreground">remediation tracking</strong>.
            The second is asking a human when a scan alone is not enough:{" "}
            <strong className="text-foreground">support tickets</strong>. Both
            are private to you: remediation is per-user and never appears on a
            shared or public view of a scan, and a ticket is visible only to
            you, staff, and any teammate you explicitly loop in.
          </p>
          <p>
            Remediation tracking is separate from the accuracy feedback on a
            finding (confirmed, false positive, not applicable). That feedback
            tunes the global detection confidence model; remediation records
            what <em>you</em> have done about the finding and nothing else. The
            two controls sit next to each other on an open finding but never
            touch the same data.
          </p>
          <p>
            The HTTP endpoints below live under{" "}
            <InlineCode>{APP_URL}/api/v3/</InlineCode>, the same base as the
            rest of the app. The support ticket UI lives on the{" "}
            <Link
              href="/contact"
              className="text-primary underline-offset-2 hover:underline"
            >
              Contact page
            </Link>{" "}
            under the Support Ticket option.
          </p>
        </div>
      </DocsSection>

      <DocsSection id="remediation" title="Remediation tracking">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Open any finding on your own scan and you get a{" "}
          <strong className="text-foreground">Your remediation tracking</strong>{" "}
          control: a status, and once the status leaves Open, a note, an
          assignee, and a due date. It is stored per finding, per user, and it
          is remembered the next time you scan the same target.
        </p>

        <DocsSubSection id="statuses" title="Statuses">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Five states, in the order they appear in the control. Open is the
            default and is never stored as a row; the other four persist.
          </p>
          <DocsTable
            caption="Remediation statuses, from lib/scanner/remediation.ts"
            columns={[
              { key: "value", header: "Stored value", className: "font-mono" },
              { key: "label", header: "Control label" },
              { key: "note", header: "In the list", className: "w-full" },
            ]}
            data={REMEDIATION_STATUSES.map((s) => ({
              value: s,
              label: REMEDIATION_LABELS[s],
              note: STATUS_NOTES[s],
            }))}
          />
        </DocsSubSection>

        <DocsSubSection
          id="tracking-fields"
          title="Assignee, note, and due date"
        >
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Once a finding is anything other than Open, three optional fields
            appear:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Note</strong> (max 2000
              chars): free text, for a release number or an internal ticket
              reference.
            </li>
            <li>
              <strong className="text-foreground">Assignee</strong> (max 120
              chars): a free-text field with a datalist that suggests people you
              share a team with. Solo users just type a name; the field never
              forces a real account.
            </li>
            <li>
              <strong className="text-foreground">Due date</strong>: a target or
              SLA date. When it is in the past{" "}
              <em>and the finding is still open work</em> (not Fixed, Accepted
              risk, or Won&apos;t fix), the finding shows an{" "}
              <InlineCode>Overdue</InlineCode> badge. A due date on a finding
              you have already closed out never nags.
            </li>
          </ul>
          <DocsCallout variant="info" title="The freshest value wins">
            <p>
              The control seeds from the status the server attached to the
              finding, then re-confirms against the API on open, so a change
              made in another tab or session shows up rather than being silently
              overwritten.
            </p>
          </DocsCallout>
        </DocsSubSection>

        <DocsSubSection id="rescans" title="Surviving rescans">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            This is the part that makes tracking worth doing. A remediation row
            is keyed on the finding, not on the scan that surfaced it. The
            finding id is deterministic: the same check firing against the same
            URL always produces the same id, which is the same identity the
            compare, diff, and regression-alert features already rely on.
          </p>
          <CodeBlock
            language="text"
            code={`finding_id = <checkId>--<fnvHash(scannedUrl)>

// Deterministic: the same check against the same URL always
// yields the same id, so a remediation row is keyed on the
// finding, not on the scan_history row that surfaced it.
remediation key = (user_id, finding_id, finding_url)`}
          />
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            So a finding you marked <InlineCode>fixed</InlineCode> on Monday
            still reads <InlineCode>fixed</InlineCode> when you rescan the same
            host on Friday, even though that is a brand new scan row. The status
            is attached only on the owner&apos;s own result-load paths (scan
            status and history); the public{" "}
            <InlineCode>/shared/[token]</InlineCode> and{" "}
            <InlineCode>/host/[hostname]</InlineCode> views never read it, so
            your private tracking never leaks onto a link you share. If the
            underlying table has not been migrated yet, the read fails soft to
            an empty map and the result page still loads.
          </p>
        </DocsSubSection>

        <DocsSubSection id="bulk" title="Bulk actions">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Setting one finding at a time is fine for a couple of them, but a
            fresh scan can surface dozens. The findings list on your own scan
            has an opt-in <strong className="text-foreground">Select</strong>{" "}
            mode: the list stays clean (no checkboxes) until you turn it on, and
            only then do row checkboxes and a sticky bulk bar appear. Pick a
            status, optionally an assignee and a due date, and apply it to
            everything you selected, up to 200 findings per request.
          </p>
          <CodeBlock
            language="json"
            code={`// POST /api/v3/scan/remediation/bulk
{
  "items": [
    { "findingId": "hsts-missing--9f2c1a", "findingUrl": "https://example.com" },
    { "findingId": "csp-missing--9f2c1a",  "findingUrl": "https://example.com" }
  ],
  "status": "in_progress",
  "assignee": "alex"
}`}
          />
          <DocsCallout
            variant="warning"
            title="Bulk is deliberately conservative"
          >
            <p>
              Status is always applied. Assignee and due date are applied only
              when you actually set them in the bar, so a bulk &quot;mark
              fixed&quot; does not wipe assignees or dates you set on individual
              findings. The per-finding note is never touched by a bulk action.
              Setting the bulk status to Open clears each selected row, exactly
              like the single-finding control.
            </p>
          </DocsCallout>
        </DocsSubSection>

        <DocsSubSection id="remediation-api" title="Remediation API">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            One route handles the single-finding lifecycle, plus a bulk variant.
            All of it is session-gated and owner-scoped: there is no way to read
            or write another user&apos;s remediation state.
          </p>
          <DocsTable
            caption="Remediation endpoints under /api/v3"
            columns={[
              { key: "method", header: "Method", className: "font-mono" },
              { key: "endpoint", header: "Endpoint", className: "font-mono" },
              { key: "what", header: "What it does", className: "w-full" },
            ]}
            data={[
              {
                method: "POST",
                endpoint: "/scan/remediation",
                what: 'Set or update one finding\'s status, note, assignee, and due date. status "open" clears the row.',
              },
              {
                method: "GET",
                endpoint: "/scan/remediation",
                what: "List your remediation rows, optionally filtered by ?url= and/or ?findingId=. Up to 500, newest first.",
              },
              {
                method: "DELETE",
                endpoint: "/scan/remediation",
                what: "Clear one finding's remediation (back to Open). Requires ?url= and ?findingId=.",
              },
              {
                method: "POST",
                endpoint: "/scan/remediation/bulk",
                what: "Apply one status, plus an optional assignee and due date, to up to 200 findings at once.",
              },
            ]}
          />
          <EndpointCard {...remediationEndpoint} />
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="tickets" title="Support tickets">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          When a finding needs a person rather than a fix step, open a ticket.
          It is a tracked, two-way thread with our team, not a fire-and-forget
          email form. It lives on the{" "}
          <Link
            href="/contact"
            className="text-primary underline-offset-2 hover:underline"
          >
            Contact page
          </Link>{" "}
          under the Support Ticket option, and it is available on{" "}
          <strong className="text-foreground">
            every plan, including free
          </strong>
          .
        </p>

        <DocsSubSection id="open-ticket" title="Opening a ticket">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Sign in, pick the Support Ticket option on the Contact page, and
            fill in a subject, a category, and a first message. The thread opens
            immediately and staff reply into the same thread. There is one guard
            rail: you can hold at most 20 open tickets at a time, so you cannot
            stockpile them, and a captcha protects creation when Turnstile is
            configured.
          </p>
        </DocsSubSection>

        <DocsSubSection
          id="categories-statuses"
          title="Categories and statuses"
        >
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Four categories, chosen when you open the ticket:{" "}
            {TICKET_CATEGORIES.map((c) => TICKET_CATEGORY_LABELS[c]).join(", ")}
            . The status then tracks whose turn it is:
          </p>
          <DocsTable
            caption="Ticket statuses, from lib/support/ticket-constants.ts"
            columns={[
              { key: "value", header: "Stored value", className: "font-mono" },
              { key: "label", header: "Label" },
              { key: "note", header: "What it means", className: "w-full" },
            ]}
            data={TICKET_STATUSES.map((s) => ({
              value: s,
              label: TICKET_STATUS_LABELS[s],
              note: TICKET_STATUS_NOTES[s],
            }))}
          />
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The flow is automatic: a new ticket is Open, your reply flips it to
            awaiting staff, a staff reply flips it to awaiting your reply. You
            can resolve or close your own ticket; staff can move it to any
            state, including reopening. In a thread, you see your own messages
            as &quot;You&quot; and staff replies as &quot;Support&quot;: a
            staffer&apos;s real name is never exposed to a non-staff viewer, and
            your identity is exposed only to staff.
          </p>
        </DocsSubSection>

        <DocsSubSection id="sharing" title="Sharing a ticket with a teammate">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            A ticket can be shared, but narrowly on purpose. Only the owner can
            share it, only with a specific{" "}
            <strong className="text-foreground">teammate</strong> (someone who
            shares a team with you), and one person at a time. There is no
            share-with-the-whole-team button and no way to share with an
            arbitrary account: the picker only lists people you already share a
            team with.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              A shared teammate can read the thread and reply, but cannot
              resolve, close, reopen, or manage sharing. Those stay with the
              owner and staff.
            </li>
            <li>
              The teammate sees the ticket in their own list, flagged{" "}
              <InlineCode>Shared with you</InlineCode> and labelled with who
              opened it.
            </li>
            <li>
              The owner can revoke a share at any time, which removes that
              teammate&apos;s access to the thread.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="notifications" title="Replies and notifications">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            A staff reply reaches you two ways at once: an in-app bell
            notification and an email. Both are transactional (you opened the
            ticket), so they are sent directly and are not subject to marketing
            notification preferences, and both link straight back to the thread
            via <InlineCode>/contact?ticket=&#123;id&#125;</InlineCode>. In the
            other direction, a new ticket or a user reply emails the staff
            support inbox.
          </p>
          <DocsCallout variant="info" title="Per-user reply rate limit">
            <p>
              Because every reply emails the other party, replies are rate
              limited per user (not per IP, since a reply is always
              authenticated) on the standard API budget. Hit it and the reply
              returns a 429 telling you how long to wait. Opening tickets is
              bounded separately by the 20-open-tickets cap.
            </p>
          </DocsCallout>
        </DocsSubSection>

        <DocsSubSection id="tickets-api" title="Support ticket API">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            The same routes the Contact page UI calls. Every one is
            session-gated; access to a specific ticket resolves to owner, staff,
            or a shared teammate.
          </p>
          <DocsTable
            caption="Support ticket endpoints under /api/v3"
            columns={[
              { key: "method", header: "Method", className: "font-mono" },
              { key: "endpoint", header: "Endpoint", className: "font-mono" },
              { key: "what", header: "What it does", className: "w-full" },
            ]}
            data={[
              {
                method: "GET",
                endpoint: "/support-tickets",
                what: "List your own tickets plus any shared with you, newest first.",
              },
              {
                method: "POST",
                endpoint: "/support-tickets",
                what: "Open a new ticket (subject, category, message). Any plan.",
              },
              {
                method: "GET",
                endpoint: "/support-tickets/{id}",
                what: "Fetch a ticket and its full message thread.",
              },
              {
                method: "POST",
                endpoint: "/support-tickets/{id}",
                what: "Add a reply to the thread.",
              },
              {
                method: "PATCH",
                endpoint: "/support-tickets/{id}",
                what: "Change status: resolve, close, or (staff) reopen.",
              },
              {
                method: "GET",
                endpoint: "/support-tickets/{id}/shares",
                what: "List current shares and the teammates eligible to add.",
              },
              {
                method: "POST",
                endpoint: "/support-tickets/{id}/shares",
                what: "Share the ticket with a teammate ({ userId }). Owner only.",
              },
              {
                method: "DELETE",
                endpoint: "/support-tickets/{id}/shares",
                what: "Stop sharing with a teammate (?userId=N). Owner only.",
              },
            ]}
          />
          <EndpointCard {...ticketEndpoint} />
        </DocsSubSection>
      </DocsSection>
    </div>
  );
}
