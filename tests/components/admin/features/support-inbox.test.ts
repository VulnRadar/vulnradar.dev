/**
 * Structure checks for the staff support inbox and its contact-form view.
 *
 * Source-text assertions, as with the other component suites: this config runs
 * plain node with no DOM. They pin the contract other work relies on (the
 * contact inbox is /admin?tab=support-tickets&view=contact) and the rules a
 * refactor would quietly undo.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const INBOX = read("components/admin/features/support-inbox.tsx");
const CONTACT = read("components/admin/features/contact-submissions-view.tsx");
const ADMIN_PAGE = read("app/admin/page.tsx");
const ADMIN_NAV = read("components/admin/nav.ts");

describe("the support inbox views", () => {
  it("reads ?view= and shows the contact form's messages for view=contact", () => {
    expect(INBOX).toMatch(/useQueryParam<[^>]*>\(\s*"view",\s*"tickets"/);
    expect(INBOX).toContain('view === "contact" ? "contact" : "tickets"');
    expect(INBOX).toContain("<ContactSubmissionsView />");
  });

  it("lives under the support-tickets tab, the id a link to ?view=contact has to name", () => {
    // The admin page falls back to Overview for a tab id it does not know, so a
    // link built with any other id (there is no "support" tab) opens the wrong
    // page and the view parameter is never read.
    expect(ADMIN_NAV).toContain('"support-tickets"');
    expect(ADMIN_PAGE).toContain(
      'activeTab === "support-tickets" && <SupportInbox />',
    );
  });

  it("keeps the default view out of the URL", () => {
    // /admin?tab=support-tickets stays the ticket queue, with no ?view=tickets
    // for a bookmark to carry.
    expect(INBOX).toContain('setView(v.key === "tickets" ? null : v.key)');
  });

  it("does not treat an unknown ?view= as a third view", () => {
    expect(INBOX).toContain('view === "contact" ? "contact" : "tickets"');
  });
});

describe("the ticket queue", () => {
  it("searches through the shared search input, debounced", () => {
    expect(INBOX).toContain("<ListSearchInput");
    expect(INBOX).toContain("SEARCH_DEBOUNCE_MS");
  });

  it("filters to the viewer's tickets with mine=1 and says it with aria-pressed", () => {
    expect(INBOX).toContain('params.set("mine", "1")');
    expect(INBOX).toMatch(/aria-pressed=\{mine\}/);
  });

  it("asks for older tickets with the cursor the server gave it", () => {
    expect(INBOX).toContain('params.set("before", nextCursor)');
  });

  it("discards an answer to a request that a newer one has replaced", () => {
    expect(INBOX).toContain("inboxRequest.current");
    expect(INBOX).toContain("request !== inboxRequest.current");
  });

  it("assigns through the ticket route with the two targets it accepts", () => {
    expect(INBOX).toContain('assign("me")');
    expect(INBOX).toContain('assign("none")');
  });

  it("uses the API map and not a literal path", () => {
    expect(INBOX).toContain("API.ADMIN_SUPPORT_TICKETS");
    expect(INBOX).not.toMatch(/["'`]\/api\/v3\//);
  });
});

describe("the contact form view", () => {
  it("reads from the contact submissions route through the API map", () => {
    expect(CONTACT).toContain("API.ADMIN_CONTACT_SUBMISSIONS");
    expect(CONTACT).not.toMatch(/["'`]\/api\/v3\//);
  });

  it("shows whether the staff email went out, and why it did not", () => {
    expect(CONTACT).toContain("contactEmailState(row)");
    expect(CONTACT).toContain("row.email_error");
  });

  it("offers an Email failed filter, the reason the view exists", () => {
    expect(CONTACT).toContain('{ key: "failed", label: "Email failed" }');
  });

  it("replies through EmailLink, so no address is in the served HTML", () => {
    expect(CONTACT).toContain("<EmailLink");
    expect(CONTACT).not.toMatch(/mailto:(?![?`'"])/);
  });

  it("never asks for the submitter's IP address", () => {
    expect(CONTACT).not.toContain("ip_address");
  });

  it("pages with the id of the last message it showed", () => {
    expect(CONTACT).toContain("nextBefore");
  });

  it("discards an answer to a request that a newer filter has replaced", () => {
    expect(CONTACT).toContain("request !== latest.current");
  });

  it("links a reply only for an address that cannot add fields to the draft", () => {
    expect(CONTACT).toContain("isPlainMailAddress(row.email)");
  });

  it("reports the failed send through the shared alert, not a hand-rolled box", () => {
    expect(CONTACT).toContain('title="Why the staff email failed"');
    expect(CONTACT).toContain("import { InlineAlert }");
    expect(CONTACT).not.toMatch(/rounded-md border border-destructive/);
  });
});

describe("copy", () => {
  it("has no em dashes in either file", () => {
    expect(INBOX).not.toContain("—");
    expect(CONTACT).not.toContain("—");
  });
});
