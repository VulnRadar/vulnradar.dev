/**
 * The staff alert opens its own ticket (?ticket=<id> on the admin inbox).
 *
 * Reading the parameter strictly and falling back to the queue without a word
 * are what keep the link from being a way to probe for ticket ids.
 */
import { describe, it, expect } from "vitest";
import {
  INBOX_TICKET_PARAM,
  deepLinkOutcome,
  parseTicketParam,
} from "@/lib/support/inbox-deep-link";

describe("parseTicketParam", () => {
  it("reads a plain ticket id", () => {
    expect(INBOX_TICKET_PARAM).toBe("ticket");
    expect(parseTicketParam("3182")).toBe(3182);
  });

  it.each([
    null,
    undefined,
    "",
    "0",
    "-4",
    "12abc",
    "1.5",
    "012",
    "2147483648",
  ])("opens the queue for %j", (raw) => {
    expect(parseTicketParam(raw)).toBeNull();
  });
});

describe("deepLinkOutcome", () => {
  it("opens the thread when the route answered", () => {
    expect(deepLinkOutcome({ ok: true })).toBe("thread");
  });

  it("falls back to the queue for a missing ticket or one this person may not see", () => {
    // The route answers 404 for both, and 401 or 403 for a lost session: none
    // of them becomes an error about the ticket.
    expect(deepLinkOutcome({ ok: false })).toBe("queue");
  });
});
