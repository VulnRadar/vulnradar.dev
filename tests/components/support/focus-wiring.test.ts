/**
 * The support screens hand focus on when a view swaps, keep the composer
 * mounted while a thread reloads, announce a sent reply, and tag a message with
 * the language it was written in.
 *
 * Source-text assertions, since this config runs plain node with no DOM to
 * render into. The decisions themselves (which target wins, when an intent is
 * used up) are tested directly in use-focus-intent.test.ts and
 * translatable-message-utils.test.ts; these pin that the components still call
 * them, in the places the audit found focus being dropped.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const CUSTOMER = read("components/contact/support-tickets.tsx");
const INBOX = read("components/admin/features/support-inbox.tsx");
const MESSAGE = read("components/support/translatable-message.tsx");

describe.each([
  ["the customer's ticket screen", CUSTOMER],
  ["the staff inbox", INBOX],
])("%s", (_name, src) => {
  it("records where focus goes, through the shared hook", () => {
    expect(src).toContain("useFocusIntent(rootRef)");
    expect(src).toContain("ref={rootRef}");
  });

  it("lands on the thread heading when a ticket is opened, and only then", () => {
    expect(src).toContain('focusOn("thread-heading")');
    expect(src).toContain("opts.moveFocus");
    expect(src).toContain("moveFocus: true");
    // The heading is focusable by script and not a tab stop.
    expect(src).toContain('data-focus-id="thread-heading"');
    expect(src).toContain("tabIndex={-1}");
  });

  it("gives the originating row its focus back", () => {
    expect(src).toContain("data-focus-id={`ticket-row-${");
    expect(src).toMatch(/focusOn\([\s\S]{0,120}ticket-row-/);
  });

  it("keeps the thread, and so the reply box, mounted while it reloads", () => {
    // The thread branch has to come before the loading branch. With loading
    // first, a reload after a reply swapped the pane for a spinner and the
    // textarea (and what had focus in it) went with it.
    const thread = src.indexOf("{thread ? (");
    const inline = src.indexOf(") : thread ? (");
    const first = thread !== -1 ? thread : inline;
    const loading = src.indexOf(") : threadLoading ? (");
    expect(first).toBeGreaterThan(-1);
    expect(loading).toBeGreaterThan(first);
    expect(src).not.toContain("{threadLoading ? (");
  });

  it("returns focus to the composer after a reply, and says it was sent", () => {
    expect(src).toContain('focusOn("reply")');
    expect(src).toContain('data-focus-id="reply"');
    expect(src).toContain('setAnnouncement("Reply sent.")');
  });

  it("announces through a status region that is mounted from the first render", () => {
    // A live region that appears already holding its text is not announced, so
    // it must sit outside every conditional.
    expect(src).toMatch(
      /<p role="status" className="sr-only">\s*\{announcement\}/,
    );
    const region = src.indexOf('<p role="status" className="sr-only">');
    expect(region).toBeGreaterThan(-1);
    const firstConditional = src.indexOf("{error &&");
    expect(region).toBeLessThan(firstConditional);
  });

  it("clears the announcement when the next attempt starts, so a repeat is heard again", () => {
    expect(src).toContain('setAnnouncement("")');
  });
});

describe("the customer's ticket screen", () => {
  it("moves into the form when New ticket removes the button that had focus", () => {
    expect(CUSTOMER).toContain('data-focus-id="new-ticket"');
    expect(CUSTOMER).toContain('focusOn("ticket-subject")');
    expect(CUSTOMER).toContain('data-focus-id="ticket-subject"');
  });

  it("goes back to that button when the form is cancelled", () => {
    expect(CUSTOMER).toContain('focusOn("new-ticket")');
  });

  it("hands focus on when resolve, close and reopen remove their own button", () => {
    expect(CUSTOMER).toContain("focusHeading: true");
  });

  it("opens the deep link from an email without taking focus on page load", () => {
    const deepLink = CUSTOMER.slice(
      CUSTOMER.indexOf('getQueryParamInt("ticket")'),
    );
    expect(deepLink.slice(0, 300)).toContain("void openThread(id)");
    expect(deepLink.slice(0, 300)).not.toContain("moveFocus");
  });
});

describe("the staff inbox", () => {
  it("keeps focus on the assign control, which swaps in place", () => {
    expect(INBOX).toContain('focus: "assign-toggle"');
    expect(INBOX.match(/data-focus-id="assign-toggle"/g)).toHaveLength(2);
  });

  it("drops a different ticket's thread before loading this one, but keeps the same ticket's", () => {
    expect(INBOX).toContain(
      "setThread((prev) => (prev && prev.ticket.id === id ? prev : null))",
    );
  });
});

describe("a support message", () => {
  it("tags the author's own words with their language", () => {
    expect(MESSAGE).toContain(
      "lang={originalTextLang(bodyLocale, readingTranslation)}",
    );
  });

  it("keeps its status region mounted, outside the translate button's condition", () => {
    expect(MESSAGE).toContain(
      '<span role="status">{translateStatusText(failed)}</span>',
    );
    // The row holding it is not itself conditional on there being a button.
    expect(MESSAGE).not.toMatch(/\{canTranslate && \(\s*<div/);
  });

  it("keeps the translate button after a failure, so focus is not dropped with it", () => {
    expect(MESSAGE).toContain("const canTranslate = Boolean(bodyLocale);");
    expect(MESSAGE).toContain('"Try again"');
  });
});
