/**
 * The staff reply box keeps one draft per ticket (lib/support/reply-drafts.ts).
 *
 * The inbox used to hold a single string, so text typed for one customer was
 * still in the box after opening another customer's ticket. A pure store keyed
 * by ticket id is the whole fix, which is why it needs no DOM to prove.
 */
import { describe, it, expect } from "vitest";
import {
  NO_DRAFTS,
  hasUnsentDraft,
  readDraft,
  replyForTicket,
  writeDraft,
} from "@/lib/support/reply-drafts";

describe("a draft belongs to the ticket it was written on", () => {
  it("reads back empty on another ticket", () => {
    const drafts = writeDraft(NO_DRAFTS, 1, "secret");
    expect(readDraft(drafts, 1)).toBe("secret");
    expect(readDraft(drafts, 2)).toBe("");
  });

  it("is still there when the staff member comes back", () => {
    let drafts = writeDraft(NO_DRAFTS, 1, "first customer");
    drafts = writeDraft(drafts, 2, "second customer");
    expect(readDraft(drafts, 1)).toBe("first customer");
    expect(readDraft(drafts, 2)).toBe("second customer");
  });

  it("reads empty when no ticket is open", () => {
    expect(readDraft(writeDraft(NO_DRAFTS, 1, "x"), null)).toBe("");
  });

  it("does not change the map it was handed", () => {
    const before = writeDraft(NO_DRAFTS, 1, "a");
    const after = writeDraft(before, 1, "ab");
    expect(readDraft(before, 1)).toBe("a");
    expect(readDraft(after, 1)).toBe("ab");
    expect(NO_DRAFTS.size).toBe(0);
  });

  it("drops the entry when the box is emptied", () => {
    const drafts = writeDraft(writeDraft(NO_DRAFTS, 1, "x"), 1, "");
    expect(drafts.has(1)).toBe(false);
    expect(hasUnsentDraft(drafts)).toBe(false);
  });
});

describe("hasUnsentDraft", () => {
  it("is true while any ticket holds text", () => {
    const drafts = writeDraft(NO_DRAFTS, 7, "half a reply");
    expect(hasUnsentDraft(drafts)).toBe(true);
  });

  it("ignores a draft that is only whitespace", () => {
    expect(hasUnsentDraft(writeDraft(NO_DRAFTS, 7, "  \n "))).toBe(false);
  });

  it("is false with nothing written", () => {
    expect(hasUnsentDraft(NO_DRAFTS)).toBe(false);
  });
});

describe("replyForTicket", () => {
  it("addresses only the open ticket, with that ticket's own text", () => {
    let drafts = writeDraft(NO_DRAFTS, 1, "meant for customer one");
    drafts = writeDraft(drafts, 2, "meant for customer two");

    expect(replyForTicket(drafts, 2)).toEqual({
      ticketId: 2,
      message: "meant for customer two",
    });
  });

  it("carries nothing to a ticket that has no draft", () => {
    const drafts = writeDraft(NO_DRAFTS, 1, "secret");
    expect(replyForTicket(drafts, 2)).toEqual({ ticketId: 2, message: "" });
  });
});
